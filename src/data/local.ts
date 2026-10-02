/**
 * The in-browser demo store (src/data/localAdapter.ts + the demo seed, ~100 KB) is only loaded in demo mode —
 * a production install with Supabase never downloads it. Everything that needs it goes through `loadLocal()`.
 */
type LocalModule = typeof import('./localAdapter')
let mod: Promise<LocalModule> | null = null
export const loadLocal = (): Promise<LocalModule> => (mod ??= import('./localAdapter'))
