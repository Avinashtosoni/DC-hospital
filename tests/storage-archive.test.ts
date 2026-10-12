import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createStorageExport, restoreStorageExport, verifyStorageExport, type StorageFetch, type StorageArchiveManifest } from '../scripts/storage-archive'

const roots: string[] = []
async function tempDirectory() {
  const dir = await mkdtemp(join(tmpdir(), 'storage-archive-'))
  roots.push(dir)
  return dir
}
afterEach(async () => { await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))) })

const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } })
const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex')
const opaquePath = (bucket: string, name: string) => `objects/${createHash('sha256').update(bucket).update(String.fromCharCode(0)).update(name).digest('hex')}.blob`
async function streamBytes(body: BodyInit | null | undefined) {
  const chunks: Buffer[] = []
  if (body && typeof (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] === 'function') {
    for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk))
  } else if (body instanceof Uint8Array) chunks.push(Buffer.from(body))
  return Buffer.concat(chunks)
}

describe('Supabase Storage backup archive', () => {
  it('recursively paginates buckets, streams files to opaque names, and verifies per-object hashes', async () => {
    const directory = join(await tempDirectory(), 'export')
    const payloads = new Map([
      ['documents/root.txt', Buffer.from('root')],
      ['documents/2026/report.pdf', Buffer.from('pdf')],
    ])
    const listCalls: { bucket: string; prefix: string; offset: number }[] = []
    const requestHeaders: Headers[] = []
    const fetcher: StorageFetch = async (input, init) => {
      requestHeaders.push(new Headers(init?.headers))
      const url = new URL(input)
      if (url.pathname === '/storage/v1/bucket') return json([{ id: 'documents' }, { id: 'empty' }])
      const list = url.pathname.match(/^\/storage\/v1\/object\/list\/([^/]+)$/)
      if (list) {
        const bucket = decodeURIComponent(list[1])
        const body = JSON.parse(String(init?.body)) as { prefix: string; offset: number }
        listCalls.push({ bucket, prefix: body.prefix, offset: body.offset })
        if (bucket === 'empty') return json([])
        if (body.prefix === '' && body.offset === 0) return json([
          { name: '2026', id: null, metadata: null },
          { name: 'root.txt', id: 'root-id', metadata: { size: 4, mimetype: 'text/plain', cacheControl: 'max-age=60' } },
        ])
        if (body.prefix === '' && body.offset === 2) return json([])
        if (body.prefix === '2026') return json([
          { name: 'report.pdf', id: 'report-id', metadata: { size: 3, mimetype: 'application/pdf' }, updated_at: '2026-10-12T00:00:00Z' },
        ])
        return json([])
      }
      const download = url.pathname.match(/^\/storage\/v1\/object\/authenticated\/([^/]+)\/(.+)$/)
      if (download) {
        const bucket = decodeURIComponent(download[1])
        const name = decodeURIComponent(download[2])
        const data = payloads.get(`${bucket}/${name}`)
        if (!data) return new Response('', { status: 404 })
        return new Response(data, { status: 200, headers: { 'Content-Type': name.endsWith('.pdf') ? 'application/pdf' : 'text/plain', 'Cache-Control': 'max-age=60' } })
      }
      return new Response('', { status: 404 })
    }

    const manifest = await createStorageExport({ supabaseUrl: 'https://project.example', storageKey: 'legacy-server-key', directory, fetcher, pageSize: 2 })
    expect(manifest.buckets).toEqual(['documents', 'empty'])
    expect(manifest.objects.map(({ bucket, name }) => [bucket, name])).toEqual([
      ['documents', '2026/report.pdf'], ['documents', 'root.txt'],
    ])
    expect(manifest.objects.every((object) => /^objects\/[a-f0-9]{64}\.blob$/.test(object.file))).toBe(true)
    expect(manifest.objects[0]).toMatchObject({ bytes: 3, sha256: digest(Buffer.from('pdf')), contentType: 'application/pdf' })
    expect(manifest.objects[1]).toMatchObject({ bytes: 4, sha256: digest(Buffer.from('root')), cacheControl: 'max-age=60' })
    expect(await readFile(join(directory, manifest.objects[0].file))).toEqual(Buffer.from('pdf'))
    expect(await verifyStorageExport(directory)).toEqual({ buckets: 2, objects: 2, bytes: 7 })
    expect(listCalls).toContainEqual({ bucket: 'documents', prefix: '', offset: 2 })
    expect(listCalls).toContainEqual({ bucket: 'documents', prefix: '2026', offset: 0 })
    expect(requestHeaders.length).toBeGreaterThan(0)
    expect(requestHeaders.every((headers) => headers.get('apikey') === 'legacy-server-key' && headers.get('authorization') === 'Bearer legacy-server-key')).toBe(true)
  })

  it('sends Supabase secret API keys only as an apikey header', async () => {
    const headers: Headers[] = []
    const fetcher: StorageFetch = async (_input, init) => {
      headers.push(new Headers(init?.headers))
      return json([])
    }
    await createStorageExport({
      supabaseUrl: 'https://project.example', storageKey: 'sb_secret_test-key',
      directory: await tempDirectory(), fetcher,
    })
    expect(headers).toHaveLength(1)
    expect(headers[0].get('apikey')).toBe('sb_secret_test-key')
    expect(headers[0].has('authorization')).toBe(false)
  })

  it('restores only into existing buckets, verifies hashes first, and uses upsert without creating or changing buckets', async () => {
    const directory = await tempDirectory()
    const bytes = Buffer.from('recover me')
    const file = opaquePath('private-files', 'folder/report.pdf')
    await mkdir(join(directory, 'objects'), { recursive: true })
    await writeFile(join(directory, file), bytes)
    const manifest: StorageArchiveManifest = {
      format: 1,
      createdAt: '2026-10-12T00:00:00Z',
      buckets: ['private-files'],
      objects: [{ bucket: 'private-files', name: 'folder/report.pdf', file, bytes: bytes.length, sha256: digest(bytes), contentType: 'application/pdf', cacheControl: 'max-age=120' }],
    }
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest))
    const calls: { path: string; method: string; headers: Headers; body: Buffer }[] = []
    const fetcher: StorageFetch = async (input, init) => {
      const url = new URL(input)
      if (url.pathname === '/storage/v1/bucket') return json([{ id: 'private-files' }])
      if (url.pathname.startsWith('/storage/v1/object/private-files/')) {
        calls.push({ path: url.pathname, method: init?.method ?? 'GET', headers: new Headers(init?.headers), body: await streamBytes(init?.body) })
        return json({ Key: 'ignored' })
      }
      return new Response('', { status: 404 })
    }

    await expect(restoreStorageExport({ supabaseUrl: 'https://project.example', storageKey: 'legacy-server-key', directory, fetcher, confirmTarget: false }))
      .rejects.toThrow(/confirm the target/)
    expect(calls).toHaveLength(0)
    await expect(restoreStorageExport({ supabaseUrl: 'https://project.example', storageKey: 'legacy-server-key', directory, fetcher, confirmTarget: true }))
      .resolves.toEqual({ buckets: 1, objects: 1, bytes: bytes.length })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      path: '/storage/v1/object/private-files/folder/report.pdf',
      method: 'POST',
      body: bytes,
    })
    expect(calls[0].headers.get('x-upsert')).toBe('true')
    expect(calls[0].headers.get('content-type')).toBe('application/pdf')
    expect(calls[0].headers.get('cache-control')).toBe('max-age=120')
  })

  it('fails closed for corrupted archives, missing buckets, and non-HTTPS endpoints before uploading any object', async () => {
    const directory = await tempDirectory()
    const bytes = Buffer.from('expected')
    const file = opaquePath('missing-bucket', 'person-file.txt')
    await mkdir(join(directory, 'objects'), { recursive: true })
    await writeFile(join(directory, file), Buffer.from('tampered'))
    const manifest: StorageArchiveManifest = {
      format: 1, createdAt: '', buckets: ['missing-bucket'],
      objects: [{ bucket: 'missing-bucket', name: 'person-file.txt', file, bytes: bytes.length, sha256: digest(bytes), contentType: 'text/plain' }],
    }
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest))
    let requests = 0
    const fetcher: StorageFetch = async () => { requests++; return json([]) }
    await expect(restoreStorageExport({ supabaseUrl: 'https://project.example', storageKey: 'key', directory, fetcher, confirmTarget: true }))
      .rejects.toThrow(/SHA-256\/size check/)
    expect(requests).toBe(0)
    await expect(createStorageExport({ supabaseUrl: 'http://project.example', storageKey: 'key', directory, fetcher }))
      .rejects.toThrow(/HTTPS/)
    expect(requests).toBe(0)
  })

  it('rejects dot-segment object names from a modified manifest before making target requests', async () => {
    const directory = await tempDirectory()
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({
      format: 1, createdAt: '', buckets: ['private-files'],
      objects: [{ bucket: 'private-files', name: 'folder/../other-bucket/file.txt', file: 'objects/invalid.blob', bytes: 0, sha256: digest(Buffer.alloc(0)), contentType: 'application/octet-stream' }],
    }))
    let requests = 0
    const fetcher: StorageFetch = async () => { requests++; return json([]) }
    await expect(restoreStorageExport({ supabaseUrl: 'https://project.example', storageKey: 'key', directory, fetcher, confirmTarget: true }))
      .rejects.toThrow(/invalid object record/)
    expect(requests).toBe(0)
  })

  it('refuses to write restored objects if a bucket from the backup is absent on the target', async () => {
    const directory = await tempDirectory()
    const bytes = Buffer.from('file')
    const file = opaquePath('original', 'file.txt')
    await mkdir(join(directory, 'objects'), { recursive: true })
    await writeFile(join(directory, file), bytes)
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({
      format: 1, createdAt: '', buckets: ['original'],
      objects: [{ bucket: 'original', name: 'file.txt', file, bytes: bytes.length, sha256: digest(bytes), contentType: 'text/plain' }],
    }))
    let uploaded = false
    const fetcher: StorageFetch = async (input, init) => {
      if (new URL(input).pathname === '/storage/v1/bucket') return json([])
      if (init?.method === 'POST') uploaded = true
      return json([])
    }
    await expect(restoreStorageExport({ supabaseUrl: 'https://project.example', storageKey: 'key', directory, fetcher, confirmTarget: true }))
      .rejects.toThrow(/missing 1 bucket/)
    expect(uploaded).toBe(false)
  })
})
