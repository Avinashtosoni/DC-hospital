import { useEffect, useRef, useState, type RefObject } from 'react'

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Adds `.is-visible` to every `.reveal` element inside `root` when it scrolls into view. */
export function useRevealAll(root: RefObject<HTMLElement>) {
  useEffect(() => {
    const el = root.current
    if (!el) return
    const items = Array.from(el.querySelectorAll<HTMLElement>('.reveal:not(.is-visible)'))
    if (prefersReducedMotion() || !('IntersectionObserver' in window)) {
      items.forEach((i) => i.classList.add('is-visible'))
      return
    }
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add('is-visible'); io.unobserve(e.target) }
      }),
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
    )
    items.forEach((i) => io.observe(i))
    return () => io.disconnect()
  }, [root])
}

/** True once the element has entered the viewport. */
export function useInView<T extends HTMLElement>(threshold = 0.3) {
  const ref = useRef<T>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || inView) return
    if (!('IntersectionObserver' in window)) { setInView(true); return }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setInView(true); io.disconnect() } }, { threshold })
    io.observe(el)
    return () => io.disconnect()
  }, [threshold, inView])
  return { ref, inView }
}

/** Eased number counter that starts when `start` flips true. */
export function useCountUp(target: number, start: boolean, duration = 1800) {
  const [value, setValue] = useState(0)
  useEffect(() => {
    if (!start) return
    if (prefersReducedMotion()) { setValue(target); return }
    let raf = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration)
      setValue(target * (1 - Math.pow(1 - p, 4)))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, start, duration])
  return value
}

/** Scroll position helpers: past-threshold flag + 0..1 page progress. */
export function useScroll(threshold = 12) {
  const [state, setState] = useState({ scrolled: false, progress: 0, y: 0 })
  useEffect(() => {
    let raf = 0
    const on = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const y = window.scrollY
        const max = document.documentElement.scrollHeight - window.innerHeight
        setState({ scrolled: y > threshold, progress: max > 0 ? y / max : 0, y })
      })
    }
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => { window.removeEventListener('scroll', on); cancelAnimationFrame(raf) }
  }, [threshold])
  return state
}

/** Id of the section currently in the middle of the viewport. */
export function useActiveSection(ids: string[]) {
  const [active, setActive] = useState<string>('')
  useEffect(() => {
    if (!('IntersectionObserver' in window)) return
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) setActive(e.target.id) }),
      { rootMargin: '-45% 0px -50% 0px' },
    )
    ids.forEach((id) => { const el = document.getElementById(id); if (el) io.observe(el) })
    return () => io.disconnect()
  }, [ids])
  return active
}
