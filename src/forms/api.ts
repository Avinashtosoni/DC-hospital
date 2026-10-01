/**
 * Reading and submitting website forms.
 *  - Supabase mode: table `site_forms` (visitors see enabled forms) + RPC `submit_site_form` (validates on the server)
 *  - Demo mode:     the browser store, with the same validation
 * A database that hasn't run the forms upgrade yet still gets the built-in Contact form (sent the old way).
 */
import { useQuery } from '@tanstack/react-query'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { localAdapter } from '../data/localAdapter'
import type { SiteForm } from '../types'
import { CONTACT_FORM_ID, DEFAULT_FORMS, toEnquiry, validateAnswers, type Answers, type FormField } from './schema'

const builtIn = (slug: string): SiteForm | null => {
  const f = DEFAULT_FORMS.find((d) => d.slug === slug)
  return f ? ({ ...f, created_at: '', updated_at: '' } as SiteForm) : null
}
const missingTable = (msg: string) => /site_forms|schema cache|does not exist|PGRST20[25]/i.test(msg)

/** An enabled form by its link name (null = no such form or switched off). */
export async function getPublicForm(slug: string): Promise<SiteForm | null> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabase!.from('site_forms').select('*').eq('slug', slug).eq('enabled', true).maybeSingle()
    if (error) { if (missingTable(error.message) && slug === 'contact') return builtIn(slug); throw new Error(error.message) }
    return (data as SiteForm | null) ?? null
  }
  const forms = await localAdapter.list('site_forms')
  return forms.find((f) => f.slug === slug && f.enabled) ?? null
}

export function usePublicForm(slug: string) {
  return useQuery({ queryKey: ['public-form', slug], queryFn: () => getPublicForm(slug), staleTime: 60_000, retry: 1 })
}

const demoRef = () => `DCH-${String(Math.floor(100000 + Math.random() * 900000))}`

/** Sends one submission and returns its reference number. `optionsFor` resolves CMS-driven option lists. */
export async function submitForm(form: SiteForm, answers: Answers, optionsFor?: (f: FormField) => string[]): Promise<string> {
  const errors = validateAnswers(form.fields as FormField[], answers, optionsFor)
  if (Object.keys(errors).length) throw new Error(Object.values(errors)[0])
  if (isSupabaseConfigured) {
    const { data, error } = await supabase!.rpc('submit_site_form', { p_form: form.id, p_answers: answers })
    if (!error) return (data as { ref: string }).ref
    // the database is older than Settings → Forms: the Contact form still works the old way
    if (form.id === CONTACT_FORM_ID && /submit_site_form|PGRST202|does not exist/i.test(error.message)) {
      const { form_id: _f, form_name: _n, data: _d, notes: _no, starred: _s, read_at: _r, ...row } = toEnquiry(form, answers)
      const ref = demoRef()
      const { error: e2 } = await supabase!.from('site_enquiries').insert({ ...row, ref, status: 'new' })
      if (e2) throw new Error(e2.message)
      return ref
    }
    throw new Error(error.message)
  }
  await new Promise((r) => setTimeout(r, 500))
  const ref = demoRef()
  await localAdapter.insert('site_enquiries', { ...toEnquiry(form, answers), ref, status: 'new' })
  return ref
}
