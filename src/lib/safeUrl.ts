/**
 * Links typed into the website CMS are rendered as <a href>, <iframe src> and <img src>. React does not block
 * `javascript:` / `data:` URLs, so every admin-entered URL passes through here first: anything that is not an
 * allowed scheme (or a same-site path) becomes '' — and the site simply hides that link.
 */
export type UrlKind = 'web' | 'link' | 'image'

const SCHEMES: Record<UrlKind, string[]> = {
  web: ['http:', 'https:'],                       // iframe embeds, "Get directions", social profiles
  link: ['http:', 'https:', 'tel:', 'mailto:'],   // general links
  image: ['http:', 'https:', 'blob:'],            // logos / photos (uploads are https; previews may be blob:)
}

export function safeUrl(raw: string | null | undefined, kind: UrlKind = 'link'): string {
  const u = (raw ?? '').trim()
  if (!u) return ''
  if (u.startsWith('/') && !u.startsWith('//')) return u   // same-site path
  if (kind === 'image' && /^data:image\//i.test(u)) return u   // demo-mode uploads; an <img> never runs script
  // strip control characters/whitespace browsers ignore inside the scheme ("java\tscript:")
  // eslint-disable-next-line no-control-regex -- matching control characters is the point here
  const probe = u.replace(/[\u0000-\u0020\u007f]/g, '')
  try {
    return SCHEMES[kind].includes(new URL(probe).protocol) ? u : ''
  } catch {
    return ''   // relative junk like "javascript:…" without a valid URL shape, or plain words
  }
}
