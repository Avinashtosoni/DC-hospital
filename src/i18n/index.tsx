/**
 * Tiny i18n for the patient-facing screens (website booking, sign-in, patient portal, feedback, PWA prompt).
 * The English text itself is the key, so untranslated strings simply stay in English:
 *   const { t } = useT();  t('Book appointment')  ·  t('Hello {name}', { name })
 * Add a language by adding a dictionary in ./hi.ts-style and listing it in LANGS.
 * Staff screens stay in English on purpose (medical / billing terms are used in English at hospitals).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Languages } from 'lucide-react'
import { cn } from '../lib/utils'
import { hi } from './hi'

export type Lang = 'en' | 'hi'
export const LANGS: { id: Lang; label: string; short: string }[] = [
  { id: 'en', label: 'English', short: 'EN' },
  { id: 'hi', label: 'हिन्दी', short: 'हि' },
]
const DICTS: Record<Lang, Record<string, string>> = { en: {}, hi }
const KEY = 'dch:lang'

type Vars = Record<string, string | number | null | undefined>
export type TFn = (text: string, vars?: Vars) => string

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'en' || saved === 'hi') return saved
  } catch { /* private mode */ }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('hi') ? 'hi' : 'en'
}

export const translate = (lang: Lang, text: string, vars?: Vars) => {
  const s = DICTS[lang][text] ?? text
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m) as string) : s
}

interface Ctx { lang: Lang; setLang: (l: Lang) => void; t: TFn }
const I18nCtx = createContext<Ctx>({ lang: 'en', setLang: () => {}, t: (s, v) => translate('en', s, v) })

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang)
  useEffect(() => { document.documentElement.lang = lang }, [lang])
  const setLang = useCallback((l: Lang) => { setLangState(l); try { localStorage.setItem(KEY, l) } catch { /* ignore */ } }, [])
  const t = useCallback<TFn>((s, v) => translate(lang, s, v), [lang])
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t])
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>
}

export const useT = () => useContext(I18nCtx)

/** EN | हि toggle. `tone="dark"` for use on dark backgrounds. */
export function LanguageSwitch({ className, tone = 'light' }: { className?: string; tone?: 'light' | 'dark' }) {
  const { lang, setLang } = useT()
  return (
    <div role="group" aria-label="Language / भाषा" className={cn('inline-flex items-center gap-0.5 rounded-full p-0.5 text-xs font-semibold',
      tone === 'dark' ? 'bg-white/10 ring-1 ring-white/20' : 'bg-white ring-1 ring-brand-100', className)}>
      <Languages className={cn('ml-1.5 mr-0.5 h-3.5 w-3.5', tone === 'dark' ? 'text-white/70' : 'text-brand-500')} aria-hidden />
      {LANGS.map((l) => (
        <button key={l.id} type="button" onClick={() => setLang(l.id)} aria-pressed={lang === l.id} title={l.label} lang={l.id}
          className={cn('rounded-full px-2 py-1 transition', lang === l.id
            ? tone === 'dark' ? 'bg-white text-brand-950' : 'bg-brand-900 text-white'
            : tone === 'dark' ? 'text-white/80 hover:text-white' : 'text-slate-600 hover:text-brand-900')}>
          {l.short}
        </button>
      ))}
    </div>
  )
}
