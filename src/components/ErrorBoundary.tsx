/**
 * Crash protection.
 *  - <ErrorBoundary> wraps a page: a bug in one screen shows a friendly card (with Reload / Go back) instead of a white page,
 *    and the sidebar keeps working. Reset automatically when the route changes (pass `resetKey`).
 *  - <RouteError> is the router-level errorElement (last line of defence).
 *  - After a new deploy, an open tab may ask for a JS chunk that no longer exists ("Failed to fetch dynamically imported
 *    module"). That is not a bug — we reload once to pick up the new version.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useRouteError } from 'react-router-dom'
import { reportError } from '../lib/monitoring'

const RELOAD_KEY = 'dch:chunk-reload'
export const isChunkError = (e: unknown) =>
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk \d+ failed/i
    .test(String((e as Error)?.message ?? e))

/** Reload once per 30 s for stale-chunk errors; returns true if a reload was triggered. */
export function reloadForChunkError(e: unknown) {
  if (!isChunkError(e)) return false
  const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0)
  if (Date.now() - last < 30_000) return false
  sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  window.location.reload()
  return true
}

function Fallback({ error, onRetry, full }: { error: unknown; onRetry?: () => void; full?: boolean }) {
  const chunk = isChunkError(error)
  return (
    <div role="alert" className={full ? 'grid min-h-screen place-items-center bg-slate-50 p-6' : 'grid place-items-center px-4 py-16'}>
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-amber-50 text-2xl" aria-hidden>⚠</div>
        <h1 className="text-lg font-semibold text-slate-900">{chunk ? 'A new version is available' : 'Something went wrong on this screen'}</h1>
        <p className="mt-1 text-sm text-slate-600">
          {chunk ? 'The app was updated while this tab was open. Reload to continue.' : 'Your data is safe. Reload the page, or go back and try again. If it keeps happening, tell your administrator what you were doing.'}
        </p>
        {!chunk && error != null && (
          <details className="mt-3 text-left">
            <summary className="cursor-pointer text-xs text-slate-400">Technical details</summary>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-[11px] text-slate-600">{String((error as Error)?.message ?? error)}</pre>
          </details>
        )}
        <div className="mt-5 flex justify-center gap-2">
          {!chunk && <button type="button" onClick={() => (onRetry ? onRetry() : window.history.back())} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">{onRetry ? 'Try again' : 'Go back'}</button>}
          <button type="button" onClick={() => window.location.reload()} className="rounded-lg bg-[#292966] px-4 py-2 text-sm font-semibold text-white hover:bg-[#5C5C99]">Reload</button>
        </div>
      </div>
    </div>
  )
}

export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string; full?: boolean }, { error: unknown }> {
  state = { error: null as unknown }
  static getDerivedStateFromError(error: unknown) { return { error } }
  componentDidCatch(error: unknown, info: ErrorInfo) {
    if (reloadForChunkError(error)) return
    console.error('[dc-hospital] screen crashed', error, info.componentStack)
    reportError(error, { source: 'screen' })
  }
  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }
  render() {
    return this.state.error ? <Fallback error={this.state.error} full={this.props.full} onRetry={() => this.setState({ error: null })} /> : this.props.children
  }
}

export function RouteError() {
  const error = useRouteError()
  if (reloadForChunkError(error)) return null
  console.error('[dc-hospital] route error', error)
  reportError(error, { source: 'route' })
  return <Fallback error={error} full />
}
