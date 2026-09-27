import { Link } from 'react-router-dom'
import { HOSPITAL } from '../../lib/utils'
import { useActiveSection, useSeo } from '../hooks'
import { PageHero } from '../ui'
import { cn } from '../../lib/utils'

type Doc = { title: string; lead: string; updated: string; sections: { id: string; h: string; p: string[] }[] }

const PRIVACY: Doc = {
  title: 'Privacy policy', updated: '1 September 2026',
  lead: 'Your health information is deeply personal. This policy explains what we collect, why, and how we keep it safe.',
  sections: [
    { id: 'collect', h: 'Information we collect', p: ['Identity and contact details (name, age, gender, phone, email, address) that you share while registering or booking.', 'Medical information created during your care — consultation notes, prescriptions, lab results, imaging, admission and billing records.', 'Technical data such as device type and pages visited on our website, used only to keep the service secure and working well.'] },
    { id: 'use', h: 'How we use your information', p: ['To provide, coordinate and follow up on your medical care.', 'To process appointments, payments and insurance claims on your behalf.', 'To send reminders, reports and important service updates. We never sell your data or use it for third-party advertising.'] },
    { id: 'share', h: 'When we share information', p: ['With the doctors, nurses and staff directly involved in your care — access is role-based and logged.', 'With your insurer or TPA when you opt for cashless treatment, and with laboratories or specialists you are referred to.', 'When required by Indian law, including the Digital Personal Data Protection Act, 2023, or a valid court order.'] },
    { id: 'security', h: 'How we protect it', p: ['Data is encrypted in transit and at rest. Staff access is limited to what their role requires, and every access to a medical record is audited.', 'We follow recognised healthcare information security practices and review them regularly.'] },
    { id: 'rights', h: 'Your rights', p: ['You can access, download or request correction of your records through the patient portal or at the medical records desk.', 'You may withdraw consent for non-essential communication at any time. Some records must be retained for the period required by medical regulations.'] },
    { id: 'contact', h: 'Grievance officer', p: [`For any privacy concern, contact our Grievance Officer at privacy@dchospital.com or ${HOSPITAL.phone}, ${HOSPITAL.address}. We respond within 7 working days.`] },
  ],
}

const TERMS: Doc = {
  title: 'Terms of use', updated: '1 September 2026',
  lead: 'These terms govern your use of the DC Hospital website, patient portal and online booking services.',
  sections: [
    { id: 'services', h: 'Our online services', p: ['The website and portal let you learn about our services, book or manage appointments, and view your records. They do not replace an in-person medical consultation.', 'In an emergency, call ' + HOSPITAL.phone + ' or visit the nearest emergency department immediately — do not rely on online booking.'] },
    { id: 'account', h: 'Your account', p: ['You are responsible for keeping your login credentials confidential and for activity under your account.', 'Please provide accurate information. You may manage family members’ appointments only with their consent or as their legal guardian.'] },
    { id: 'appointments', h: 'Appointments & cancellations', p: ['Slots are confirmed subject to doctor availability. In rare cases we may need to reschedule; we will inform you as early as possible.', 'You can cancel free of charge up to 2 hours before your appointment through the portal.'] },
    { id: 'payments', h: 'Fees & payments', p: ['Consultation fees and package prices shown online are inclusive of applicable taxes unless stated otherwise.', 'Final treatment costs depend on clinical needs. Estimates are provided in good faith and may change as your care progresses.'] },
    { id: 'content', h: 'Website content', p: ['Information on this website is for general awareness and is not medical advice. Always consult a qualified doctor about your specific condition.', 'All content, logos and design are the property of DC Hospital and may not be reused without permission.'] },
    { id: 'law', h: 'Governing law', p: ['These terms are governed by the laws of India, and courts at New Delhi shall have exclusive jurisdiction.'] },
  ],
}

function LegalPage({ doc }: { doc: Doc }) {
  useSeo(doc.title, doc.lead)
  const active = useActiveSection(doc.sections.map((s) => s.id))
  return (
    <>
      <PageHero crumbs={[{ label: doc.title }]} eyebrow={`Last updated · ${doc.updated}`} title={doc.title} lead={doc.lead} />
      <section className="pb-24">
        <div className="l-container grid grid-cols-1 gap-10 lg:grid-cols-[240px_1fr]">
          <nav aria-label="On this page" className="hidden lg:sticky lg:top-28 lg:block lg:self-start">
            <p className="text-xs font-semibold uppercase tracking-wider text-peri-500">On this page</p>
            <ul className="mt-4 space-y-1 border-l border-peri-200">
              {doc.sections.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className={cn('-ml-px block border-l-2 py-1.5 pl-4 text-sm transition', active === s.id ? 'border-peri-800 font-semibold text-peri-900' : 'border-transparent text-slate-500 hover:text-peri-800')}>{s.h}</a>
                </li>
              ))}
            </ul>
          </nav>
          <article className="max-w-3xl rounded-[2rem] border border-peri-200 bg-white p-6 shadow-soft sm:p-10">
            {doc.sections.map((s, i) => (
              <section key={s.id} id={s.id} className={cn('scroll-mt-28', i > 0 && 'mt-10 border-t border-peri-100 pt-10')}>
                <h2 className="font-display text-xl font-bold text-peri-900"><span className="mr-2 text-peri-400">{String(i + 1).padStart(2, '0')}</span>{s.h}</h2>
                {s.p.map((p, j) => <p key={j} className="mt-3 text-[15px] leading-relaxed text-slate-600">{p}</p>)}
              </section>
            ))}
            <p className="mt-12 rounded-2xl bg-peri-50 p-4 text-sm text-slate-600">Questions about this document? <Link to="/contact" className="font-semibold text-peri-700 hover:underline">Contact us</Link>.</p>
          </article>
        </div>
      </section>
    </>
  )
}

export function Privacy() { return <LegalPage doc={PRIVACY} /> }
export function Terms() { return <LegalPage doc={TERMS} /> }
