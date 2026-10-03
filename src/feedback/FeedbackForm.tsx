import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { CheckCircle2, Star, ThumbsDown, ThumbsUp } from 'lucide-react'
import { Button, Skeleton, Textarea } from '../components/ui'
import { useT } from '../i18n'
import { cn } from '../lib/utils'
import { qk } from '../hooks/useData'
import { FEEDBACK_TAGS, feedbackApi } from './api'

const FACES = ['', 'Very poor', 'Poor', 'Okay', 'Good', 'Excellent']

export function StarRating({ value, onChange, size = 'lg' }: { value: number; onChange?: (v: number) => void; size?: 'sm' | 'lg' }) {
  const { t } = useT()
  const [hover, setHover] = useState(0)
  const shown = hover || value
  return (
    <div className="flex items-center gap-1" role={onChange ? 'radiogroup' : undefined} aria-label={t('Rating')} onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => {
        const star = <Star className={cn(size === 'lg' ? 'h-9 w-9' : 'h-4 w-4', n <= shown ? 'fill-amber-400 text-amber-400' : 'text-slate-300')} />
        return onChange ? (
          <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} ★ ${t(FACES[n])}`}
            onMouseEnter={() => setHover(n)} onClick={() => onChange(n)} className="rounded-lg p-0.5 transition hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500">
            {star}
          </button>
        ) : <span key={n}>{star}</span>
      })}
    </div>
  )
}

/** Post-visit rating form. Used by the public link (/feedback/:id) and inside the patient portal. */
export function FeedbackForm({ appointmentId, source, onDone }: { appointmentId: string; source: 'portal' | 'link'; onDone?: () => void }) {
  const { t } = useT()
  const qc = useQueryClient()
  const ctx = useQuery({ queryKey: ['feedback-ctx', appointmentId], queryFn: () => feedbackApi.context(appointmentId), staleTime: Infinity, retry: false })
  const [rating, setRating] = useState(0)
  const [tags, setTags] = useState<string[]>([])
  const [comment, setComment] = useState('')
  const [recommend, setRecommend] = useState<boolean | null>(null)
  const send = useMutation({
    mutationFn: () => feedbackApi.submit(appointmentId, { rating, tags, comment, would_recommend: recommend }, source),
    onSuccess: () => { qc.invalidateQueries({ queryKey: qk('visit_feedback') }); qc.invalidateQueries({ queryKey: ['feedback-ctx', appointmentId] }); onDone?.() },
  })

  if (ctx.isLoading) return <div className="space-y-3"><Skeleton className="h-6 w-2/3" /><Skeleton className="h-10 w-1/2" /><Skeleton className="h-24 w-full" /></div>
  const c = ctx.data
  if (!c || !c.ok) return <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600 ring-1 ring-slate-200">{t(c && !c.ok ? c.error : 'This feedback link is not valid.')}</p>
  if (c.submitted || send.isSuccess) return (
    <div className="py-6 text-center" role="status">
      <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
      <h2 className="mt-3 text-xl font-semibold text-slate-900">{t('Thank you for your feedback!')}</h2>
      <p className="mt-1 text-sm text-slate-500">{t('It helps us take better care of every patient.')}</p>
    </div>
  )

  const toggle = (k: string) => setTags((x) => (x.includes(k) ? x.filter((y) => y !== k) : [...x, k]))
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (rating) send.mutate() }} className="space-y-5" aria-label={t('Rate your visit')}>
      <div>
        <p className="text-sm text-slate-500">{t('Hi {name}, how was your visit with {doctor} on {date}?', { name: c.first_name, doctor: c.doctor, date: format(parseISO(c.date), 'd MMM') })}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <StarRating value={rating} onChange={setRating} />
          {rating > 0 && <span className="text-sm font-medium text-slate-700">{t(FACES[rating])}</span>}
        </div>
      </div>
      {rating > 0 && <>
        <div>
          <p className="label">{rating >= 4 ? t('What went well?') : t('What should we improve?')}</p>
          <div className="flex flex-wrap gap-2">
            {FEEDBACK_TAGS.map(([k, label]) => (
              <button key={k} type="button" onClick={() => toggle(k)} aria-pressed={tags.includes(k)}
                className={cn('rounded-full px-3 py-1.5 text-sm ring-1 transition', tags.includes(k) ? 'bg-brand-900 text-white ring-brand-900' : 'bg-white text-slate-700 ring-slate-200 hover:ring-brand-300')}>
                {t(label)}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="label" htmlFor="fb-comment">{t('Anything else? (optional)')}</label>
          <Textarea id="fb-comment" rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('Tell us about your experience')} />
        </div>
        <div>
          <p className="label">{t('Would you recommend us to family and friends?')}</p>
          <div className="flex gap-2">
            {([[true, 'Yes', ThumbsUp], [false, 'No', ThumbsDown]] as const).map(([v, label, Icon]) => (
              <button key={label} type="button" onClick={() => setRecommend(recommend === v ? null : v)} aria-pressed={recommend === v}
                className={cn('inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium ring-1 transition', recommend === v ? 'bg-brand-900 text-white ring-brand-900' : 'bg-white text-slate-700 ring-slate-200 hover:ring-brand-300')}>
                <Icon className="h-4 w-4" />{t(label)}
              </button>
            ))}
          </div>
        </div>
      </>}
      {send.error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">{t((send.error as Error).message)}</p>}
      <Button type="submit" disabled={!rating} loading={send.isPending} className="w-full sm:w-auto">{t('Submit feedback')}</Button>
    </form>
  )
}
