import { Link, useParams } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { usePublicForm } from '../../forms/api'
import { FormRenderer } from '../../forms/FormRenderer'
import { useSeo } from '../hooks'
import { Reveal } from '../parts'
import { PageHero } from '../ui'
import NotFound from './NotFound'

/** Any enabled website form by its link: /forms/review, /forms/callback… (Settings → Forms). */
export default function FormPage() {
  const { slug = '' } = useParams()
  const q = usePublicForm(slug)
  const form = q.data
  useSeo(form?.name ?? 'Form', form?.description ?? undefined)
  if (!q.isPending && !form) return <NotFound />
  return (
    <>
      <PageHero center crumbs={[{ label: form?.name ?? 'Form' }]} title={form?.name ?? ' '} lead={form?.description ?? undefined} />
      <section className="pb-20 sm:pb-28">
        <div className="l-container max-w-3xl">
          <Reveal className="relative overflow-hidden rounded-[2rem] border border-peri-200 bg-white/90 p-6 shadow-[0_30px_70px_-35px_rgba(41,41,102,.35)] backdrop-blur sm:p-10">
            <div aria-hidden="true" className="absolute -right-24 -top-24 h-64 w-64 rounded-full bg-peri-200/60 blur-3xl" />
            {form ? (
              <FormRenderer key={form.updated_at} form={form} idPrefix="form" title={null} note={null} className="[&>div]:mt-0"
                successActions={<Link to="/" className="btn-peri">Back to home<ArrowRight className="h-4 w-4" /></Link>} />
            ) : (
              <div className="relative space-y-5" aria-busy="true">
                {[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-2xl bg-peri-50" />)}
                <div className="h-32 animate-pulse rounded-2xl bg-peri-50" />
              </div>
            )}
          </Reveal>
        </div>
      </section>
    </>
  )
}
