import { useRef, useState, type DragEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, CloudUpload, Copy, ImageIcon, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '../../lib/utils'
import { ConfirmDialog, Skeleton, Tabs } from '../../components/ui'
import { cms, type MediaItem } from '../../site/cms/store'

const BUILT_IN: MediaItem[] = [
  'hero', 'care', 'doc-arjun', 'doc-kavita', 'doc-vikram', 'doc-nikhil', 'doc-lakshmi', 'doc-meera', 'doc-rajesh', 'doc-sneha',
  'doc-sameer', 'doc-ananya', 'doc-aditya', 'doc-farah', 'doc-harish', 'doc-pooja',
].map((n) => ({ name: `${n}.webp`, url: `/landing/${n}.webp` }))

const kb = (n?: number) => (n == null ? '' : n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
export const MEDIA_QK = ['cms-media'] as const

/** Browse, upload and delete website images. With `onPick` it works as a picker. */
export function MediaLibrary({ onPick, selected }: { onPick?: (url: string) => void; selected?: string }) {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'library' | 'built-in'>('library')
  const [drag, setDrag] = useState(false)
  const [confirm, setConfirm] = useState<MediaItem | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const media = useQuery({ queryKey: MEDIA_QK, queryFn: () => cms.listMedia() })

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      const out: MediaItem[] = []
      for (const f of files) {
        if (!f.type.startsWith('image/')) throw new Error(`${f.name} is not an image`)
        if (f.size > 15 * 1024 * 1024) throw new Error(`${f.name} is larger than 15 MB`)
        out.push(await cms.upload(f))
      }
      return out
    },
    onSuccess: (items) => {
      qc.setQueryData<MediaItem[]>(MEDIA_QK, (old) => [...items, ...(old ?? [])])
      toast.success(items.length > 1 ? `${items.length} images uploaded` : 'Image uploaded', { description: 'Optimised to WebP for fast loading.' })
      setTab('library')
      if (onPick && items.length === 1) onPick(items[0].url)
    },
    onError: (e) => toast.error('Upload failed', { description: (e as Error).message }),
  })
  const remove = useMutation({
    mutationFn: (m: MediaItem) => cms.removeMedia(m),
    onMutate: (m) => { const prev = qc.getQueryData<MediaItem[]>(MEDIA_QK); qc.setQueryData<MediaItem[]>(MEDIA_QK, (o) => (o ?? []).filter((x) => x.name !== m.name)); return { prev } },
    onError: (e, _m, c) => { qc.setQueryData(MEDIA_QK, c?.prev); toast.error((e as Error).message) },
    onSuccess: () => toast.success('Image deleted'),
  })

  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); const files = Array.from(e.dataTransfer.files); if (files.length) upload.mutate(files) }
  const items = tab === 'library' ? media.data ?? [] : BUILT_IN
  const copy = async (url: string) => { try { await navigator.clipboard.writeText(url.startsWith('/') ? location.origin + url : url); toast.success('Image URL copied') } catch { toast.error('Could not copy') } }

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={onDrop}
        className={cn('flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition', drag ? 'border-brand-500 bg-brand-50' : 'border-slate-200 bg-slate-50/60')}>
        {upload.isPending ? <Loader2 className="h-7 w-7 animate-spin text-brand-600" /> : <CloudUpload className="h-7 w-7 text-slate-400" />}
        <p className="text-sm text-slate-600">{upload.isPending ? 'Optimising & uploading…' : <>Drag images here, or <button type="button" onClick={() => input.current?.click()} className="font-semibold text-brand-700 hover:underline">browse</button></>}</p>
        <p className="text-[11px] text-slate-400">JPG, PNG or WebP · resized to max 1600px and converted to WebP{cms.mode === 'local' ? ' · demo mode stores images in this browser' : ''}</p>
        <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => { const f = Array.from(e.target.files ?? []); if (f.length) upload.mutate(f); e.target.value = '' }} />
      </div>

      <div className="mt-4"><Tabs value={tab} onChange={setTab} tabs={[{ value: 'library', label: 'Uploaded', count: media.data?.length }, { value: 'built-in', label: 'Built-in', count: BUILT_IN.length }]} /></div>

      {tab === 'library' && media.isPending ? (
        <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="aspect-square rounded-lg" />)}</div>
      ) : tab === 'library' && media.isError ? (
        <p className="mt-6 rounded-lg bg-rose-50 p-4 text-sm text-rose-700">Could not load the media library: {(media.error as Error).message}</p>
      ) : items.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-2 py-8 text-center text-sm text-slate-400"><ImageIcon className="h-8 w-8" />No uploads yet — drop an image above, or use a built-in one.</div>
      ) : (
        <ul className="mt-4 grid max-h-[50vh] grid-cols-2 gap-3 overflow-y-auto p-0.5 sm:grid-cols-4 lg:grid-cols-5">
          {items.map((m) => {
            const active = selected === m.url
            return (
              <li key={m.name} className={cn('group relative overflow-hidden rounded-lg border bg-white transition', active ? 'border-brand-500 ring-2 ring-brand-500/30' : 'border-slate-200 hover:border-slate-300')}>
                <button type="button" onClick={() => (onPick ? onPick(m.url) : copy(m.url))} className="block w-full text-left" title={onPick ? 'Use this image' : 'Copy URL'}>
                  <img src={m.url} alt="" loading="lazy" className="aspect-square w-full bg-slate-100 object-cover" />
                  <span className="block truncate px-2 pt-1.5 text-[11px] font-medium text-slate-600">{m.name}</span>
                  <span className="block px-2 pb-1.5 text-[10px] text-slate-400">{kb(m.size) || 'Built-in'}</span>
                </button>
                {active && <span className="absolute left-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-brand-600 text-white"><Check className="h-3.5 w-3.5" /></span>}
                <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                  <button type="button" onClick={() => copy(m.url)} aria-label="Copy URL" className="grid h-7 w-7 place-items-center rounded-md bg-white/90 text-slate-600 shadow hover:text-slate-900"><Copy className="h-3.5 w-3.5" /></button>
                  {tab === 'library' && <button type="button" onClick={() => setConfirm(m)} aria-label="Delete image" className="grid h-7 w-7 place-items-center rounded-md bg-white/90 text-rose-600 shadow hover:bg-rose-50"><Trash2 className="h-3.5 w-3.5" /></button>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <ConfirmDialog open={!!confirm} onClose={() => setConfirm(null)} onConfirm={() => { if (confirm) remove.mutate(confirm); setConfirm(null) }}
        title="Delete this image?" description="Pages that still use it will show a broken image until you pick another one." />
    </div>
  )
}
