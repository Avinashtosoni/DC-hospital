/**
 * Persistence for website content, revisions and media. (Website forms are sent through src/forms/api.ts.)
 * tables `site_content`, `site_content_revisions`, `site_enquiries` + storage bucket `site-media`
 */
import { supabase } from '../../lib/supabase'
import type { ContentKey } from './types'

export interface ContentRow { key: ContentKey; data: unknown; updated_at: string; updated_by_name?: string | null }
export interface Revision { id: string; key: ContentKey; data: unknown; created_at: string; created_by_name?: string | null }
export interface MediaItem { name: string; url: string; size?: number; created_at?: string }
export type ContentRows = Partial<Record<ContentKey, ContentRow>>

export const MEDIA_BUCKET = 'site-media'

interface CmsStore {
  mode: 'supabase'
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

export const cms: CmsStore = supabaseStore
