import { Link } from 'react-router-dom'
import { ArrowRight, Compass, Phone, Stethoscope } from 'lucide-react'
import { useContact } from '../cms/content'
import { useSeo } from '../hooks'
import { AmbientBackdrop, useHomeHref } from '../ui'

export default function NotFound() {
  useSeo('Page not found')
  const home = useHomeHref()
  const c = useContact()
  const links = [['Find a doctor', '/find-a-doctor'], ['Our services', '/services'], ['Health packages', '/packages'], ['Contact us', '/contact']]
  return (
    <section className="relative isolate flex min-h-[80vh] items-center overflow-hidden pb-20 pt-32">
      <AmbientBackdrop />
      <div className="l-container text-center">
        <p className="l-rise select-none font-display text-[7rem] font-extrabold leading-none tracking-tighter sm:text-[10rem]">
          <span className="text-gradient">404</span>
        </p>
        <span className="l-rise mx-auto mt-2 grid h-14 w-14 place-items-center rounded-2xl bg-white text-peri-700 shadow-soft" style={{ animationDelay: '120ms' }}><Compass className="h-7 w-7 motion-safe:animate-[spin_8s_linear_infinite]" /></span>
        <h1 className="l-rise mt-6 font-display text-3xl font-bold text-peri-900 sm:text-4xl" style={{ animationDelay: '200ms' }}>This page seems to have been discharged</h1>
        <p className="l-rise mx-auto mt-3 max-w-md text-slate-600" style={{ animationDelay: '280ms' }}>The link may be broken or the page may have moved. Let’s get you back to the right care.</p>
        <div className="l-rise mt-8 flex flex-wrap justify-center gap-3" style={{ animationDelay: '360ms' }}>
          <Link to={home} className="btn-peri">Back to home<ArrowRight className="h-4 w-4" /></Link>
          <a href={c.tel} className="btn-ghost"><Phone className="h-4 w-4" />{c.phone}</a>
        </div>
        <ul className="l-rise mx-auto mt-12 flex max-w-2xl flex-wrap justify-center gap-2" style={{ animationDelay: '440ms' }}>
          {links.map(([l, to]) => <li key={to}><Link to={to} className="inline-flex items-center gap-1.5 rounded-full border border-peri-200 bg-white/80 px-4 py-2 text-sm font-medium text-peri-700 transition hover:border-peri-800 hover:bg-peri-800 hover:text-white"><Stethoscope className="h-3.5 w-3.5" />{l}</Link></li>)}
        </ul>
      </div>
    </section>
  )
}
