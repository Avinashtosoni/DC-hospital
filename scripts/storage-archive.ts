import { createHash } from 'node:crypto'
import { createWriteStream, createReadStream } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { dirname, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const PAGE_LIMIT = 1000
const ARCHIVE_FORMAT = 1 as const

type JsonObject = Record<string, unknown>
type FetchInit = RequestInit & { duplex?: 'half' }
export type StorageFetch = (url: string, init?: FetchInit) => Promise<Response>

export interface StorageArchiveObject {
  bucket: string
  name: string
  file: string
  bytes: number
  sha256: string
  contentType: string
  cacheControl?: string
  updatedAt?: string
}

export interface StorageArchiveManifest {
  format: typeof ARCHIVE_FORMAT
  createdAt: string
  buckets: string[]
  objects: StorageArchiveObject[]
}

export interface StorageArchiveOptions {
  supabaseUrl: string
  storageKey: string
  directory: string
  fetcher?: StorageFetch
  pageSize?: number
}

function projectOrigin(raw: string): string {
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('SUPABASE_URL must be a valid HTTPS project URL') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('SUPABASE_URL must be an HTTPS project origin without credentials, path, query, or fragment')
  }
  return url.origin
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

function authHeaders(storageKey: string): Record<string, string> {
  if (!storageKey || hasControlCharacters(storageKey)) throw new Error('SUPABASE_STORAGE_KEY is required and must be a valid HTTP header value')
  const headers: Record<string, string> = { apikey: storageKey }
  // New Supabase secret API keys are authenticated by the apikey header; legacy service-role JWTs also need Bearer.
  if (!storageKey.startsWith('sb_secret_')) headers.Authorization = `Bearer ${storageKey}`
  return headers
}

function validBucketId(value: string): boolean {
  return value.length > 0 && value === value.trim() && value !== '.' && value !== '..'
    && !/[\\/]/.test(value) && !hasControlCharacters(value)
}

function validObjectSegment(value: string): boolean {
  return value.length > 0 && value !== '.' && value !== '..'
    && !/[\\/]/.test(value) && !hasControlCharacters(value)
}

function validObjectName(value: string): boolean {
  return value.length > 0 && value.split('/').every(validObjectSegment)
}

function validHeaderValue(value: string): boolean {
  return !hasControlCharacters(value)
}

async function storageRequest(fetcher: StorageFetch, url: string, init: FetchInit, operation: string): Promise<Response> {
  let response: Response
  try { response = await fetcher(url, { ...init, redirect: 'error' }) } catch { throw new Error(`Supabase Storage ${operation} request failed`) }
  if (!response.ok) throw new Error(`Supabase Storage ${operation} failed (HTTP ${response.status})`)
  return response
}

function asRecord(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null
}

async function jsonResponse(response: Response, operation: string): Promise<unknown> {
  try { return await response.json() } catch { throw new Error(`Supabase Storage returned invalid ${operation} JSON`) }
}

async function listBuckets(origin: string, storageKey: string, fetcher: StorageFetch): Promise<string[]> {
  const response = await storageRequest(fetcher, `${origin}/storage/v1/bucket`, {
    method: 'GET', headers: authHeaders(storageKey),
  }, 'bucket-list')
  const value = await jsonResponse(response, 'bucket-list')
  if (!Array.isArray(value)) throw new Error('Supabase Storage returned an invalid bucket list')
  const buckets = value.map((entry) => {
    const row = asRecord(entry)
    const id = row?.id ?? row?.name
    if (typeof id !== 'string' || !validBucketId(id)) throw new Error('Supabase Storage returned an invalid bucket id')
    return id
  })
  if (new Set(buckets).size !== buckets.length) throw new Error('Supabase Storage returned duplicate bucket ids')
  return buckets.sort()
}

function metadataSize(metadata: JsonObject | null): number | null {
  const raw = metadata?.size
  const size = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN
  return Number.isSafeInteger(size) && size >= 0 ? size : null
}

function textField(row: JsonObject | null, ...keys: string[]): string | undefined {
  for (const key of keys) if (typeof row?.[key] === 'string' && (row[key] as string).length) return row[key] as string
  return undefined
}

function encodeObjectPath(name: string): string {
  return name.split('/').map((part) => encodeURIComponent(part)).join('/')
}

function opaqueFileName(bucket: string, name: string): string {
  const key = createHash('sha256').update(`${bucket}\0${name}`).digest('hex')
  return `objects/${key}.blob`
}

function archivePath(directory: string, relativePath: string): string {
  if (!relativePath || relativePath.includes('\\') || relativePath.startsWith('/')) throw new Error('Storage archive contains an unsafe local file path')
  const root = resolve(directory)
  const file = resolve(root, relativePath)
  if (!file.startsWith(`${root}${sep}`)) throw new Error('Storage archive contains an unsafe local file path')
  return file
}

async function listObjectsInBucket(
  origin: string,
  storageKey: string,
  fetcher: StorageFetch,
  bucket: string,
  pageSize: number,
): Promise<{ name: string; metadata: JsonObject | null; updatedAt?: string }[]> {
  const found: { name: string; metadata: JsonObject | null; updatedAt?: string }[] = []
  const seenKeys = new Set<string>()
  const queuedPrefixes = ['']
  const visitedPrefixes = new Set<string>()

  while (queuedPrefixes.length) {
    const prefix = queuedPrefixes.shift()!
    if (visitedPrefixes.has(prefix)) continue
    visitedPrefixes.add(prefix)
    let offset = 0
    for (;;) {
      const response = await storageRequest(fetcher, `${origin}/storage/v1/object/list/${encodeURIComponent(bucket)}`, {
        method: 'POST',
        headers: { ...authHeaders(storageKey), 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix, limit: pageSize, offset, sortBy: { column: 'name', order: 'asc' } }),
      }, 'object-list')
      const value = await jsonResponse(response, 'object-list')
      if (!Array.isArray(value)) throw new Error('Supabase Storage returned an invalid object list')
      for (const entry of value) {
        const row = asRecord(entry)
        if (typeof row?.name !== 'string' || !validObjectSegment(row.name)) {
          throw new Error('Supabase Storage returned an invalid object name')
        }
        const name = prefix ? `${prefix}/${row.name}` : row.name
        const metadata = asRecord(row.metadata)
        // Supabase list() represents folder entries with null id/metadata. Recurse instead of treating folders as files.
        if ((row.id === null || row.id === undefined) && (row.metadata === null || row.metadata === undefined)) {
          queuedPrefixes.push(name)
          continue
        }
        if (seenKeys.has(name)) continue
        seenKeys.add(name)
        found.push({ name, metadata, updatedAt: textField(row, 'updated_at') })
      }
      if (value.length < pageSize) break
      offset += value.length
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name))
}

function digestingTransform() {
  const hash = createHash('sha256')
  let bytes = 0
  const transform = new Transform({
    transform(chunk: Buffer | string, _encoding, callback) {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      hash.update(data)
      bytes += data.length
      callback(null, data)
    },
  })
  return { transform, result: () => ({ bytes, sha256: hash.digest('hex') }) }
}

async function downloadObject(
  origin: string,
  storageKey: string,
  fetcher: StorageFetch,
  bucket: string,
  object: { name: string; metadata: JsonObject | null; updatedAt?: string },
  file: string,
): Promise<StorageArchiveObject> {
  const url = `${origin}/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${encodeObjectPath(object.name)}`
  const response = await storageRequest(fetcher, url, { method: 'GET', headers: authHeaders(storageKey) }, 'object-download')
  await mkdir(dirname(file), { recursive: true })
  const digest = digestingTransform()
  try {
    if (response.body) await pipeline(Readable.fromWeb(response.body as unknown as Parameters<typeof Readable.fromWeb>[0]), digest.transform, createWriteStream(file, { flags: 'wx' }))
    else await pipeline(Readable.from([Buffer.alloc(0)]), digest.transform, createWriteStream(file, { flags: 'wx' }))
  } catch {
    await rm(file, { force: true }).catch(() => undefined)
    throw new Error('Could not write a downloaded Storage object to the archive')
  }
  const { bytes, sha256 } = digest.result()
  const expectedSize = metadataSize(object.metadata)
  if (expectedSize !== null && expectedSize !== bytes) {
    await rm(file, { force: true }).catch(() => undefined)
    throw new Error('Downloaded Storage object size did not match its listed size')
  }
  const headerType = response.headers.get('content-type')
  const contentType = headerType && headerType !== 'application/octet-stream'
    ? headerType
    : textField(object.metadata, 'mimetype', 'contentType', 'content_type') ?? headerType ?? 'application/octet-stream'
  const cacheControl = response.headers.get('cache-control') ?? textField(object.metadata, 'cacheControl', 'cache_control')
  return {
    bucket,
    name: object.name,
    file: opaqueFileName(bucket, object.name),
    bytes,
    sha256,
    contentType,
    ...(cacheControl ? { cacheControl } : {}),
    ...(object.updatedAt ? { updatedAt: object.updatedAt } : {}),
  }
}

export async function createStorageExport(options: StorageArchiveOptions): Promise<StorageArchiveManifest> {
  const origin = projectOrigin(options.supabaseUrl)
  if (!options.storageKey) throw new Error('SUPABASE_STORAGE_KEY is required for Storage backup')
  const pageSize = options.pageSize ?? PAGE_LIMIT
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > PAGE_LIMIT) throw new Error(`pageSize must be between 1 and ${PAGE_LIMIT}`)
  const fetcher = options.fetcher ?? fetch
  const buckets = await listBuckets(origin, options.storageKey, fetcher)
  const objects: StorageArchiveObject[] = []
  await mkdir(resolve(options.directory, 'objects'), { recursive: true })
  for (const bucket of buckets) {
    const entries = await listObjectsInBucket(origin, options.storageKey, fetcher, bucket, pageSize)
    for (const entry of entries) {
      const file = opaqueFileName(bucket, entry.name)
      const localFile = archivePath(options.directory, file)
      objects.push(await downloadObject(origin, options.storageKey, fetcher, bucket, entry, localFile))
    }
  }
  objects.sort((a, b) => a.bucket.localeCompare(b.bucket) || a.name.localeCompare(b.name))
  const manifest: StorageArchiveManifest = { format: ARCHIVE_FORMAT, createdAt: new Date().toISOString(), buckets, objects }
  await writeFile(archivePath(options.directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
  return manifest
}

function validateManifest(value: unknown): StorageArchiveManifest {
  const raw = asRecord(value)
  if (!raw || raw.format !== ARCHIVE_FORMAT || !Array.isArray(raw.buckets) || !Array.isArray(raw.objects)) {
    throw new Error('Storage archive manifest has an unsupported format')
  }
  const buckets = raw.buckets.map((bucket) => {
    if (typeof bucket !== 'string' || !validBucketId(bucket)) throw new Error('Storage archive manifest has an invalid bucket id')
    return bucket
  })
  if (new Set(buckets).size !== buckets.length) throw new Error('Storage archive manifest contains duplicate buckets')
  const objects = raw.objects.map((entry) => {
    const object = asRecord(entry)
    if (!object || typeof object.bucket !== 'string' || !validBucketId(object.bucket)
      || typeof object.name !== 'string' || !validObjectName(object.name)
      || typeof object.file !== 'string' || object.file !== opaqueFileName(object.bucket, object.name)
      || !Number.isSafeInteger(object.bytes) || (object.bytes as number) < 0
      || typeof object.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(object.sha256)
      || typeof object.contentType !== 'string' || !object.contentType || !validHeaderValue(object.contentType)) {
      throw new Error('Storage archive manifest contains an invalid object record')
    }
    if (!buckets.includes(object.bucket)) throw new Error('Storage archive object references a missing bucket definition')
    if (object.cacheControl !== undefined && (typeof object.cacheControl !== 'string' || !validHeaderValue(object.cacheControl))) throw new Error('Storage archive manifest contains invalid cache-control metadata')
    if (object.updatedAt !== undefined && (typeof object.updatedAt !== 'string' || !validHeaderValue(object.updatedAt))) throw new Error('Storage archive manifest contains invalid update metadata')
    return {
      bucket: object.bucket,
      name: object.name,
      file: object.file,
      bytes: object.bytes as number,
      sha256: object.sha256,
      contentType: object.contentType,
      ...(typeof object.cacheControl === 'string' ? { cacheControl: object.cacheControl } : {}),
      ...(typeof object.updatedAt === 'string' ? { updatedAt: object.updatedAt } : {}),
    }
  })
  const keys = objects.map((object) => `${object.bucket}\0${object.name}`)
  if (new Set(keys).size !== keys.length) throw new Error('Storage archive manifest contains duplicate objects')
  return {
    format: ARCHIVE_FORMAT,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    buckets,
    objects,
  }
}

export async function readStorageExport(directory: string): Promise<StorageArchiveManifest> {
  let parsed: unknown
  try { parsed = JSON.parse(await readFile(archivePath(directory, 'manifest.json'), 'utf8')) as unknown }
  catch { throw new Error('Storage archive manifest is missing or invalid JSON') }
  const manifest = validateManifest(parsed)
  for (const object of manifest.objects) archivePath(directory, object.file)
  return manifest
}

async function hashFile(file: string): Promise<{ bytes: number; sha256: string }> {
  const digest = digestingTransform()
  try { await pipeline(createReadStream(file), digest.transform) }
  catch { throw new Error('Storage archive is missing an object file') }
  return digest.result()
}

export async function verifyStorageExport(directory: string): Promise<{ buckets: number; objects: number; bytes: number }> {
  const manifest = await readStorageExport(directory)
  let bytes = 0
  for (const object of manifest.objects) {
    const actual = await hashFile(archivePath(directory, object.file))
    if (actual.bytes !== object.bytes || actual.sha256 !== object.sha256) {
      throw new Error('Storage archive failed its per-object SHA-256/size check')
    }
    bytes += actual.bytes
  }
  return { buckets: manifest.buckets.length, objects: manifest.objects.length, bytes }
}

export interface RestoreStorageOptions extends StorageArchiveOptions {
  confirmTarget: boolean
}

export async function restoreStorageExport(options: RestoreStorageOptions): Promise<{ buckets: number; objects: number; bytes: number }> {
  if (!options.confirmTarget) throw new Error('Storage restore writes to the configured project; confirm the target before continuing')
  if (!options.storageKey) throw new Error('SUPABASE_STORAGE_KEY is required for Storage restore')
  const verified = await verifyStorageExport(options.directory)
  const manifest = await readStorageExport(options.directory)
  const origin = projectOrigin(options.supabaseUrl)
  const fetcher = options.fetcher ?? fetch
  const currentBuckets = await listBuckets(origin, options.storageKey, fetcher)
  const currentBucketSet = new Set(currentBuckets)
  const missing = manifest.buckets.filter((bucket) => !currentBucketSet.has(bucket))
  if (missing.length) throw new Error(`Storage restore target is missing ${missing.length} bucket(s); restore database/bucket definitions first`)

  const headersBase = authHeaders(options.storageKey)
  for (const object of manifest.objects) {
    const body = createReadStream(archivePath(options.directory, object.file))
    const headers: Record<string, string> = {
      ...headersBase,
      'Content-Type': object.contentType,
      'x-upsert': 'true',
    }
    if (object.cacheControl) headers['cache-control'] = object.cacheControl
    const url = `${origin}/storage/v1/object/${encodeURIComponent(object.bucket)}/${encodeObjectPath(object.name)}`
    try {
      await storageRequest(fetcher, url, {
        method: 'POST',
        headers,
        body: body as unknown as BodyInit,
        duplex: 'half',
      }, 'object-restore')
    } finally {
      body.destroy()
    }
  }
  return verified
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

async function main() {
  const [mode, directoryArg] = process.argv.slice(2)
  const directory = directoryArg ?? (mode === 'backup' ? 'out/storage-export' : './storage-export')
  if (mode === 'backup') {
    const result = await createStorageExport({
      supabaseUrl: requiredEnv('SUPABASE_URL'),
      storageKey: requiredEnv('SUPABASE_STORAGE_KEY'),
      directory,
    })
    const verified = await verifyStorageExport(directory)
    console.log(`Storage export created and verified: ${result.buckets.length} bucket(s), ${result.objects.length} object(s), ${verified.bytes} bytes`)
    return
  }
  if (mode === 'verify') {
    const result = await verifyStorageExport(directory)
    console.log(`Storage export verified: ${result.buckets} bucket(s), ${result.objects} object(s), ${result.bytes} bytes`)
    return
  }
  if (mode === 'restore') {
    if (process.env.STORAGE_RESTORE_CONFIRM !== 'YES') throw new Error('Set STORAGE_RESTORE_CONFIRM=YES only after verifying SUPABASE_URL points to the intended restore project')
    const result = await restoreStorageExport({
      supabaseUrl: requiredEnv('SUPABASE_URL'),
      storageKey: requiredEnv('SUPABASE_STORAGE_KEY'),
      directory,
      confirmTarget: true,
    })
    console.log(`Storage restore finished: ${result.objects} object(s), ${result.bytes} bytes; no buckets were created or changed`)
    return
  }
  throw new Error('Usage: tsx scripts/storage-archive.ts backup|verify|restore [directory]')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    // All API errors are deliberately sanitized; never print request headers or credential values.
    console.error(error instanceof Error ? error.message : 'Storage archive operation failed')
    process.exitCode = 1
  })
}
