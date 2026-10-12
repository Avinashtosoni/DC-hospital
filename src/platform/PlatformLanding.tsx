import { useEffect, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import LegalPage from './LegalPage'
import SignupPage from './SignupPage'
import { useSite } from './site/store'
import { A, Layout, usePath, useSeo } from './site/ui'
import type { PlatformSite } from './site/types'
import HomePage from './pages/HomePage'
import { AboutPage, ContactPage, FaqPage, FeaturesPage, PricingPage, SecurityPage, SolutionsPage } from './pages/InfoPages'
import { BlogList, BlogPost } from './pages/BlogPages'

/**
 * The Hospital Comrade product site — shown on the platform's own domain (PLATFORM_DOMAIN) when no hospital is
 * selected. Pages: / · /features · /solutions · /pricing · /security · /about · /contact · /faq · /blog(/:slug)
 * · /legal/:slug · /signup. Text comes from the control panel → Website (defaults in ./site/defaults.ts).
 */
export default function PlatformLanding() {
  const { path, search } = usePath()
  const site = useSite()
  if (/^\/signup$/.test(path)) return <SignupPage />
  if (!site) return <div className="grid min-h-screen place-items-center bg-[#f7f7ff]"><Loader2 className="h-6 w-6 animate-spin text-peri-500" aria-label="Loading" /></div>
  return <Layout site={site} path={path}><Page site={site} path={path} search={search} /></Layout>
}

function Page({ site, path, search }: { site: PlatformSite; path: string; search: URLSearchParams }): ReactNode {
  // old one-page links (/#pricing, /#contact …) still land on the right page
  useEffect(() => {
    const hash = location.hash.slice(1)
    const moved: Record<string, string> = { pricing: '/pricing', contact: '/contact', faq: '/faq', features: '/features' }
    if (path === '/' && moved[hash]) { history.replaceState(null, '', moved[hash] + location.search); window.dispatchEvent(new Event('hc:nav')) }
  }, [path])

  const legal = path.match(/^\/legal\/([a-z-]+)$/)
  if (legal) return <LegalPage site={site} slug={legal[1]} />
  const post = path.match(/^\/blog\/([a-z0-9-]+)$/)
  if (post) return <BlogPost site={site} slug={post[1]} />
  switch (path) {
    case '/': return <HomePage site={site} />
    case '/features': return <FeaturesPage site={site} />
    case '/solutions': return <SolutionsPage site={site} />
    case '/pricing': return <PricingPage site={site} />
    case '/security': return <SecurityPage site={site} />
    case '/about': return <AboutPage site={site} />
    case '/contact': return <ContactPage site={site} plan={search.get('plan')} />
    case '/faq': return <FaqPage site={site} />
    case '/blog': return <BlogList site={site} tag={search.get('tag')} />
    default: return <NotFound />
  }
}

function NotFound() {
  useSeo({ title: 'Page not found', description: '' }, 'Page not found')
  return (
    <div className="l-container py-28 text-center">
      <p className="font-display text-6xl font-extrabold text-peri-300">404</p>
      <p className="mt-4 font-display text-2xl font-bold text-peri-900">This page doesn’t exist</p>
      <A to="/" className="btn-peri mt-8">Go to the home page</A>
    </div>
  )
}
