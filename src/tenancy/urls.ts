/**
 * Hospital addresses on the platform domain (multi-hospital "Hospital Comrade" mode).
 *
 *   custom domain        https://cityhospital.in/…            (Domains tab — always wins)
 *   own subdomain        https://city.hospital.digitalcomrade.in/…   (TENANT_SUBDOMAINS=on: wildcard DNS + SSL ready)
 *   fallback             https://hospital.digitalcomrade.in/…?hospital=city
 *
 * The bare platform domain is the Hospital Comrade product page. With subdomains on, an old `?hospital=` link there
 * is sent on to the hospital's subdomain. No imports: the control panel uses this too.
 */

type Env = Partial<Record<string, string>>
const env = (): Env => (typeof window !== 'undefined' ? (window as unknown as { __ENV__?: Env }).__ENV__ ?? {} : {})
const vite = (k: string) => (import.meta.env as Record<string, string | undefined>)[`VITE_${k}`]

/** a hospital slug as signup.sql allows it */
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/

export const platformHost = (): string => String(env().PLATFORM_DOMAIN || vite('PLATFORM_DOMAIN') || 'hospital.digitalcomrade.in').trim().toLowerCase()
/** every hospital gets <slug>.<platform domain> (runtime env TENANT_SUBDOMAINS=on) */
export const subdomainsOn = (): boolean => /^(1|on|true|yes)$/i.test(String(env().TENANT_SUBDOMAINS || vite('TENANT_SUBDOMAINS') || '').trim())

const bare = (host: string) => host.toLowerCase().split(':')[0].replace(/\.$/, '')

/** the platform's own domain (with or without www.) */
export function isRootPlatformHost(host = location.hostname): boolean {
  const p = platformHost()
  return !!p && bare(host).replace(/^www\./, '') === p
}

/** `city` on city.hospital.digitalcomrade.in (one label only; never www) */
export function hostSlug(host = location.hostname): string | null {
  const p = platformHost(), h = bare(host)
  if (!p || !h.endsWith(`.${p}`)) return null
  const sub = h.slice(0, -(p.length + 1))
  return sub !== 'www' && SLUG.test(sub) ? sub : null
}

/** adds ?hospital=… to a path, keeping its query and #hash */
function withSlugParam(path: string, slug: string): string {
  const [beforeHash, ...hash] = path.split('#')
  const sep = beforeHash.includes('?') ? '&' : '?'
  return `${beforeHash}${sep}hospital=${encodeURIComponent(slug)}${hash.length ? `#${hash.join('#')}` : ''}`
}

/** where a hospital's website / app lives: its custom domain, else its subdomain, else ?hospital= here */
export function hospitalUrl(h: { slug: string; domain?: string | null }, path = '/'): string {
  const p = path.startsWith('/') ? path : `/${path}`
  if (h.domain) return `https://${h.domain}${p}`
  if (subdomainsOn() && platformHost()) return `https://${h.slug}.${platformHost()}${p}`
  const origin = typeof location !== 'undefined' ? location.origin : `https://${platformHost()}`
  return `${origin}${withSlugParam(p, h.slug)}`
}

/** the address shown to people (no https://, no trailing slash) */
export function hospitalHost(h: { slug: string; domain?: string | null }): string {
  return hospitalUrl(h, '/').replace(/^https?:\/\//, '').replace(/\/$/, '')
}

/** subdomains on + an old `?hospital=city` link on the bare platform domain → that hospital's subdomain */
export function subdomainRedirect(loc: Pick<Location, 'hostname' | 'pathname' | 'search' | 'hash'> = location): string | null {
  if (!subdomainsOn() || !isRootPlatformHost(loc.hostname)) return null
  const q = new URLSearchParams(loc.search)
  const slug = (q.get('hospital') ?? '').trim().toLowerCase()
  if (!SLUG.test(slug)) return null
  q.delete('hospital')
  const rest = q.toString()
  return `https://${slug}.${platformHost()}${loc.pathname}${rest ? `?${rest}` : ''}${loc.hash}`
}

/**
 * Subdomains off: a hospital opened on the bare platform domain keeps `?hospital=<slug>` in the address bar, so a
 * reload or a shared link opens the same hospital (and never the product page).
 */
export function keepSlugInUrl(slug: string) {
  if (typeof location === 'undefined' || !isRootPlatformHost(location.hostname)) return
  const q = new URLSearchParams(location.search)
  if (q.get('hospital') === slug) return
  q.set('hospital', slug)
  history.replaceState(history.state, '', `${location.pathname}?${q.toString()}${location.hash}`)
}
