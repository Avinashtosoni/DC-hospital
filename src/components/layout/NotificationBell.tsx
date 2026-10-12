/**
 * The header bell: personal notifications (appointments, bills, leave, digests… — public.user_notifications, written by
 * the template library's "In-app" channel) and the Notice Board, in two tabs. Polls every minute.
 */
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, CheckCheck } from 'lucide-react'
import { cn, ago } from '../../lib/utils'
import { bellApi, type BellItem, type BellPage } from '../../notify/api'
import type { Notice } from '../../types'

const QK = ['my-notifications'] as const

/** an absolute link into this app → its path; anything else stays as is */
export function appPath(link: string, origin = typeof window === 'undefined' ? '' : window.location.origin): string {
  if (link.startsWith('/')) return link
  try {
    const u = new URL(link)
    return origin && u.origin === origin ? `${u.pathname}${u.search}${u.hash}` : link
  } catch { return link }
}

export function NotificationBell({ notices, unreadNotices, isNoticeRead, tr }: {
  notices: Notice[]
  unreadNotices: number
  isNoticeRead: (n: Notice) => boolean
  tr: (s: string) => string
}) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const q = useQuery({ queryKey: QK, queryFn: () => bellApi.list(30), refetchInterval: 60_000, refetchOnWindowFocus: true, staleTime: 20_000 })
  const page: BellPage = q.data ?? { unread: 0, items: [] }
  const [tab, setTab] = useState<'mine' | 'notices'>('mine')
  const read = useMutation({
    mutationFn: (ids: string[] | null) => bellApi.read(ids),
    // optimistic: the dot goes away at once
    onMutate: (ids) => {
      const prev = qc.getQueryData<BellPage>(QK)
      if (prev) qc.setQueryData<BellPage>(QK, {
        unread: ids ? Math.max(0, prev.unread - prev.items.filter((i) => !i.read && ids.includes(i.id)).length) : 0,
        items: prev.items.map((i) => (!ids || ids.includes(i.id) ? { ...i, read: true } : i)),
      })
      return { prev }
    },
    onError: (_e, _v, c) => { if (c?.prev) qc.setQueryData(QK, c.prev) },
    onSettled: () => qc.invalidateQueries({ queryKey: QK }),
  })
  const total = page.unread + unreadNotices
  const openItem = (i: BellItem) => {
    if (!i.read) read.mutate([i.id])
    if (!i.link) return
    setOpen(false)
    const to = appPath(i.link)
    if (to.startsWith('/')) navigate(to)
    else window.open(to, '_blank', 'noopener')
  }
  const toggle = () => setOpen((o) => {
    if (!o) setTab(page.unread > 0 || unreadNotices === 0 ? 'mine' : 'notices')
    return !o
  })

  return (
    <div className="relative">
      <button onClick={toggle} className="relative grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Notifications">
        <Bell className="h-5 w-5" />
        {total > 0 && <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white" aria-label={`${total} unread`}>{total > 9 ? '9+' : total}</span>}
      </button>
      {open && <>
        <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
        <div className="absolute right-0 z-50 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] animate-pop-in rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center gap-1 border-b border-slate-100 px-2 pt-2">
            {([['mine', tr('For you'), page.unread], ['notices', tr('Notices'), unreadNotices]] as const).map(([id, label, n]) => (
              <button key={id} type="button" onClick={() => setTab(id)}
                className={cn('-mb-px flex items-center gap-1.5 border-b-2 px-3 pb-2 pt-1 text-sm font-medium', tab === id ? 'border-brand-600 text-brand-900' : 'border-transparent text-slate-500 hover:text-slate-700')}>
                {label}{n > 0 && <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600">{n}</span>}
              </button>
            ))}
            <div className="ml-auto pb-2 pr-2">
              {tab === 'mine'
                ? page.unread > 0 && <button type="button" onClick={() => read.mutate(null)} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700"><CheckCheck className="h-3.5 w-3.5" />{tr('Mark all read')}</button>
                : <Link to="/notices" onClick={() => setOpen(false)} className="text-xs font-medium text-brand-700">{tr('View all')}</Link>}
            </div>
          </div>
          <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
            {tab === 'mine' && (q.isPending
              ? <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />)}</div>
              : page.items.length === 0
                ? <p className="px-4 py-8 text-center text-sm text-slate-400">{tr("You're all caught up")}</p>
                : page.items.map((i) => (
                  <button type="button" key={i.id} onClick={() => openItem(i)} className={cn('block w-full px-4 py-3 text-left hover:bg-brand-50/50', !i.read && 'bg-brand-50/40')}>
                    <div className="flex items-start gap-2">
                      {!i.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" aria-label="unread" />}
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800">{i.title}</p>
                        <p className="mt-0.5 line-clamp-3 whitespace-pre-line text-xs text-slate-500">{i.body}</p>
                        <p className="mt-1 text-[11px] text-slate-400">{ago(i.created_at)}</p>
                      </div>
                    </div>
                  </button>
                )))}
            {tab === 'notices' && (notices.length === 0
              ? <p className="px-4 py-8 text-center text-sm text-slate-400">{tr("You're all caught up")}</p>
              : notices.map((n) => (
                <button type="button" key={n.id} onClick={() => { setOpen(false); navigate(`/notices?open=${n.id}`) }} className="block w-full px-4 py-3 text-left hover:bg-brand-50/50">
                  <div className="flex items-center gap-2">
                    {!isNoticeRead(n) && <span className="h-2 w-2 shrink-0 rounded-full bg-brand-600" aria-label="unread" />}
                    {n.priority !== 'normal' && <span className={cn('h-1.5 w-1.5 rounded-full', n.priority === 'urgent' ? 'bg-rose-500' : 'bg-amber-500')} />}
                    <span className="text-sm font-medium text-slate-800">{n.title}</span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{n.body}</p>
                  <p className="mt-1 text-[11px] text-slate-400">{ago(n.published_on)}</p>
                </button>
              )))}
          </div>
        </div>
      </>}
    </div>
  )
}
