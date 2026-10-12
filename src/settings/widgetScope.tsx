import { createContext, useContext, type ReactNode } from 'react'

/** Dashboard widgets hidden in Settings → Appearance → Dashboard widgets (by title). */
export const WidgetScope = createContext<Set<string> | null>(null)
export const useWidgetHidden = (id?: string) => { const s = useContext(WidgetScope); return !!(id && s?.has(id)) }
export function Widget({ id, children }: { id: string; children: ReactNode }) {
  return useWidgetHidden(id) ? null : <>{children}</>
}
