import { useEffect } from 'react'
import { useBlocker } from 'react-router-dom'
import { Button, Modal } from '../components/ui'

/**
 * Warns before leaving a page with unsaved edits: browser reload/close (beforeunload) AND in-app
 * navigation (sidebar links, back button) via React Router's useBlocker. Changing only the query string
 * (e.g. switching Settings tabs) is not blocked. Render the returned element somewhere in the page.
 */
export function useUnsavedChanges(dirty: boolean, opts: { onSave?: () => Promise<unknown> | void; saving?: boolean; what?: string } = {}) {
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname)
  // edits were saved/discarded while the dialog was open → let the navigation through
  useEffect(() => { if (blocker.state === 'blocked' && !dirty) blocker.proceed() }, [blocker, dirty])

  const open = blocker.state === 'blocked'
  return (
    <Modal open={open} onClose={() => blocker.reset?.()} title="Leave without saving?" footer={<>
      <Button variant="outline" onClick={() => blocker.reset?.()}>Stay on this page</Button>
      <Button variant="danger" onClick={() => blocker.proceed?.()}>Discard &amp; leave</Button>
      {opts.onSave && <Button loading={opts.saving} onClick={async () => { try { await opts.onSave!(); blocker.proceed?.() } catch { /* error toast shown by caller */ } }}>Save &amp; leave</Button>}
    </>}>
      <p className="text-sm text-slate-600">You have unsaved changes to {opts.what ?? 'this page'}. If you leave now they will be lost.</p>
    </Modal>
  )
}
