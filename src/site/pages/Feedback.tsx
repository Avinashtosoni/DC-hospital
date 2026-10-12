import { useParams } from 'react-router-dom'
import { FeedbackForm } from '../../feedback/FeedbackForm'
import { LanguageSwitch, useT } from '../../i18n'
import { useSiteSettings } from '../cms/content'

/** Public page opened from the post-visit SMS / WhatsApp link. */
export default function FeedbackPage() {
  const { id = '' } = useParams()
  const { t } = useT()
  const site = useSiteSettings()
  return (
    <section className="bg-gradient-to-b from-brand-50/70 to-white px-4 py-12 sm:py-16">
      <div className="mx-auto max-w-xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-600">{site.name}</p>
          <LanguageSwitch />
        </div>
        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-brand-100 sm:p-8">
          <h1 className="mb-4 text-2xl font-semibold tracking-tight text-brand-950">{t('Rate your visit')}</h1>
          <FeedbackForm appointmentId={id} source="link" />
        </div>
        <p className="mt-4 text-center text-xs text-slate-400">{t('Your feedback goes to the hospital management. For medical questions, please call the hospital.')}</p>
      </div>
    </section>
  )
}
