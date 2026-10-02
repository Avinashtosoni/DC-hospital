import { supabase } from '../lib/supabase'

export interface Lead {
  name: string
  organisation: string
  phone: string
  email: string
  city: string
  plan: string
  message: string
}

const LOCAL_KEY = 'dch:platform-leads:v1'

/** "Talk to us" form on the product page → `platform_leads` (visible to Hospital Comrade admins only). */
export async function submitLead(l: Lead): Promise<void> {
  if (supabase) {
    const { error } = await supabase.rpc('submit_platform_lead', {
      p_name: l.name, p_organisation: l.organisation, p_phone: l.phone, p_email: l.email,
      p_city: l.city, p_plan: l.plan, p_message: l.message, p_source: location.host,
    })
    if (error) throw new Error(error.message)
    return
  }
  // demo mode: keep it in this browser so the flow can be tried end to end
  await new Promise((r) => setTimeout(r, 400))
  try {
    const all = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]') as unknown[]
    localStorage.setItem(LOCAL_KEY, JSON.stringify([{ ...l, created_at: new Date().toISOString() }, ...all].slice(0, 50)))
  } catch { /* storage full / private mode */ }
}

/** same checks as the database, so people get instant feedback */
export function leadProblem(l: Lead): string | null {
  if (l.name.trim().length < 2) return 'Please enter your name.'
  if (l.organisation.trim().length < 2) return 'Please enter your hospital or clinic name.'
  const digits = l.phone.replace(/\D/g, '')
  if (digits.length < 10 || digits.length > 13) return 'Please enter a valid mobile number.'
  if (l.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(l.email.trim())) return 'Please enter a valid email or leave it empty.'
  if (l.message.length > 2000) return 'Message is too long.'
  return null
}
