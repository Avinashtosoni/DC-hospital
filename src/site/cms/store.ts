/**
 * Persistence for website content, revisions and media. (Website forms are sent through src/forms/api.ts.)
 *  - Supabase mode: tables `site_content`, `site_content_revisions`, `site_enquiries` + storage bucket `site-media`
 *  - Demo mode:     browser localStorage (same API, so the CMS behaves identically)
 */
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import type { ContentKey } from './types'

export interface ContentRow { key: ContentKey; data: unknown; updated_at: string; updated_by_name?: string | null }
export interface Revision { id: string; key: ContentKey; data: unknown; created_at: string; created_by_name?: string | null }
export interface MediaItem { name: string; url: string; size?: number; created_at?: string }
export type ContentRows = Partial<Record<ContentKey, ContentRow>>

export const MEDIA_BUCKET = 'site-media'

interface CmsStore {
  mode: 'local' | 'supabase'
  fetchAll(): Promise<ContentRows>
  save(key: ContentKey, data: unknown, by?: string): Promise<ContentRow>
  reset(key: ContentKey, by?: string): Promise<void>
  history(key: ContentKey): Promise<Revision[]>
  listMedia(): Promise<MediaItem[]>
  upload(file: File): Promise<MediaItem>
  removeMedia(item: MediaItem): Promise<void>
}

// ------------------------------------------------------------------ image helpers
/** Downscale + re-encode an image in the browser (WebP) so pages stay fast and uploads stay small. */
export async function compressImage(file: File, maxSide = 1600, quality = 0.84): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml' || file.type === 'image/gif') return file
  const bmp = await createImageBitmap(file).catch(() => null)
  if (!bmp) return file
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale)
  canvas.height = Math.round(bmp.height * scale)
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', quality))
  return blob && blob.size < file.size ? blob : file
}
const blobToDataUrl = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(b) })
const safeName = (name: string) => name.toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'image'

// ------------------------------------------------------------------ Supabase
const sb = () => { if (!supabase) throw new Error('Supabase is not configured'); return supabase }

const supabaseStore: CmsStore = {
  mode: 'supabase',
  async fetchAll() {
    const { data, error } = await sb().from('site_content').select('key, data, updated_at, updated_by_name')
    if (error) throw new Error(error.message)
    const out: ContentRows = {}
    for (const r of (data ?? []) as ContentRow[]) out[r.key] = r
    return out
  },
  async save(key, data) {
    const { data: row, error } = await sb().from('site_content').upsert({ key, data }, { onConflict: 'tenant_id,key' }).select('key, data, updated_at, updated_by_name').single()
    if (error) throw new Error(error.message)
    return row as ContentRow
  },
  async reset(key) {
    const { error } = await sb().from('site_content').delete().eq('key', key)
    if (error) throw new Error(error.message)
  },
  async history(key) {
    const { data, error } = await sb().from('site_content_revisions').select('id, key, data, created_at, created_by_name').eq('key', key).order('created_at', { ascending: false }).limit(20)
    if (error) throw new Error(error.message)
    return (data ?? []) as Revision[]
  },
  async listMedia() {
    const { data, error } = await sb().storage.from(MEDIA_BUCKET).list('', { limit: 200, sortBy: { column: 'created_at', order: 'desc' } })
    if (error) throw new Error(error.message)
    return (data ?? []).filter((f) => f.id && !f.name.startsWith('.')).map((f) => ({
      name: f.name, size: (f.metadata as { size?: number } | null)?.size, created_at: f.created_at ?? undefined,
      url: sb().storage.from(MEDIA_BUCKET).getPublicUrl(f.name).data.publicUrl,
    }))
  },
  async upload(file) {
    const blob = await compressImage(file)
    const ext = blob.type === 'image/webp' ? 'webp' : (file.name.split('.').pop() || 'bin').toLowerCase()
    const path = `${Date.now().toString(36)}-${safeName(file.name)}.${ext}`
    const { error } = await sb().storage.from(MEDIA_BUCKET).upload(path, blob, { contentType: blob.type || file.type, cacheControl: '31536000', upsert: false })
    if (error) throw new Error(error.message.includes('Bucket not found') ? 'Storage bucket "site-media" is missing — re-run supabase/master.sql.' : error.message)
    return { name: path, size: blob.size, created_at: new Date().toISOString(), url: sb().storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl }
  },
  async removeMedia(item) {
    const { error } = await sb().storage.from(MEDIA_BUCKET).remove([item.name])
    if (error) throw new Error(error.message)
  },
}

// ------------------------------------------------------------------ localStorage (demo mode)
const K = { content: 'dch:cms:v1', revisions: 'dch:cms-rev:v1', media: 'dch:cms-media:v1' }
const read = <T,>(k: string, fallback: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : fallback } catch { return fallback } }
const write = (k: string, v: unknown) => {
  try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) {
    if (e instanceof DOMException && /quota/i.test(e.name + e.message)) throw new Error('Browser storage is full. In demo mode images are stored in the browser — remove unused media or connect Supabase.')
    throw e
  }
}
const pause = (ms = 220) => new Promise((r) => setTimeout(r, ms))
/** Keeps the version being replaced; a revision is stamped with when/by whom that version was published. */
function pushRevision(key: ContentKey, prev: ContentRow | undefined) {
  if (!prev) return
  const all = read<Revision[]>(K.revisions, [])
  all.unshift({ id: crypto.randomUUID(), key, data: prev.data, created_at: prev.updated_at, created_by_name: prev.updated_by_name ?? null })
  // keep the latest 15 revisions per section
  const counts: Record<string, number> = {}
  write(K.revisions, all.filter((r) => (counts[r.key] = (counts[r.key] ?? 0) + 1) <= 15))
}

const localStore: CmsStore = {
  mode: 'local',
  async fetchAll() { return read<ContentRows>(K.content, {}) },
  async save(key, data, by) {
    await pause()
    const all = read<ContentRows>(K.content, {})
    pushRevision(key, all[key])
    const row: ContentRow = { key, data, updated_at: new Date().toISOString(), updated_by_name: by ?? null }
    all[key] = row
    write(K.content, all)
    return row
  },
  async reset(key) {
    await pause()
    const all = read<ContentRows>(K.content, {})
    pushRevision(key, all[key])
    delete all[key]
    write(K.content, all)
  },
  async history(key) { await pause(120); return read<Revision[]>(K.revisions, []).filter((r) => r.key === key) },
  async listMedia() { return read<MediaItem[]>(K.media, []) },
  async upload(file) {
    const blob = await compressImage(file, 1200, 0.8)
    if (blob.size > 900_000) throw new Error('Image is too large for demo mode (max ~900 KB after compression). Connect Supabase for full-size uploads.')
    const item: MediaItem = { name: `${Date.now().toString(36)}-${safeName(file.name)}`, url: await blobToDataUrl(blob), size: blob.size, created_at: new Date().toISOString() }
    write(K.media, [item, ...read<MediaItem[]>(K.media, [])])
    return item
  },
  async removeMedia(item) { write(K.media, read<MediaItem[]>(K.media, []).filter((m) => m.name !== item.name)) },
}

export const cms: CmsStore = isSupabaseConfigured ? supabaseStore : localStore
