import { useRef, type CSSProperties, type ElementType, type ReactNode, type PointerEvent } from 'react'
import { Link } from 'react-router-dom'
import { HeartPulse } from 'lucide-react'
import { cn } from '../lib/utils'
import { useSite } from './cms/content'
import { useCountUp, useInView } from './hooks'

/** Scroll-reveal wrapper. `delay` in ms for staggered entrances. */
export function Reveal({ as: Tag = 'div', delay = 0, variant, className, children, ...rest }: {
  as?: ElementType; delay?: number; variant?: 'left' | 'right' | 'scale'; className?: string; children?: ReactNode
} & Record<string, unknown>) {
  return (
    <Tag className={cn('reveal', variant && `reveal-${variant}`, className)} style={{ '--d': `${delay}ms` } as CSSProperties} {...rest}>
      {children}
    </Tag>
  )
}

export function LandingLogo({ className, light, to = '/' }: { className?: string; light?: boolean; to?: string }) {
  const { settings } = useSite()
  return (
    <Link to={to} className={cn('group inline-flex items-center gap-2.5 rounded-xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-peri-300', className)} aria-label={`${settings.name} home`}>
      <span className="relative grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-peri-600 to-peri-800 text-white shadow-glow transition-transform duration-500 group-hover:rotate-[8deg] group-hover:scale-105">
        <HeartPulse className="h-5 w-5" strokeWidth={2.4} />
        <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-400" />
      </span>
      <span className="leading-none">
        <span className={cn('block font-display text-lg font-extrabold tracking-tight', light ? 'text-white' : 'text-peri-900')}>{settings.name}</span>
        <span className={cn('mt-1 block text-[10px] font-semibold uppercase tracking-[.2em]', light ? 'text-peri-300' : 'text-peri-500')}>{settings.tagline}</span>
      </span>
    </Link>
  )
}

/** Card with a soft radial highlight that follows the cursor. */
export function SpotlightCard({ className, children, as: Tag = 'div' }: { className?: string; children: ReactNode; as?: ElementType }) {
  const ref = useRef<HTMLElement>(null)
  const onMove = (e: PointerEvent<HTMLElement>) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    el.style.setProperty('--x', `${e.clientX - r.left}px`)
    el.style.setProperty('--y', `${e.clientY - r.top}px`)
  }
  return (
    <Tag
      ref={ref}
      onPointerMove={onMove}
      className={cn(
        'group relative overflow-hidden rounded-3xl border border-peri-200/80 bg-white/80 shadow-soft backdrop-blur transition duration-500 hover:-translate-y-1 hover:border-peri-300 hover:shadow-[0_24px_60px_-20px_rgba(41,41,102,.28)]',
        'before:pointer-events-none before:absolute before:inset-0 before:opacity-0 before:transition-opacity before:duration-500 hover:before:opacity-100',
        'before:bg-[radial-gradient(420px_circle_at_var(--x,50%)_var(--y,50%),rgba(204,204,255,.55),transparent_60%)]',
        className,
      )}
    >
      <div className="relative h-full">{children}</div>
    </Tag>
  )
}

export function Counter({ value, suffix = '', decimals = 0, format }: { value: number; suffix?: string; decimals?: number; format?: 'lakh' | 'plain' }) {
  const { ref, inView } = useInView<HTMLSpanElement>(0.5)
  const v = useCountUp(value, inView)
  let text: string
  if (format === 'lakh') text = `${(v / 100000).toFixed(1)}L`
  else text = decimals ? v.toFixed(decimals) : Math.round(v).toLocaleString('en-IN')
  return <span ref={ref} className="tabular-nums">{text}{suffix}</span>
}

export function Stars({ value = 5, className }: { value?: number; className?: string }) {
  return (
    <span className={cn('inline-flex gap-0.5 text-amber-400', className)} aria-label={`${value} out of 5 stars`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <svg key={i} viewBox="0 0 20 20" className={cn('h-4 w-4', i + 0.5 > value && 'opacity-30')} fill="currentColor" aria-hidden="true">
          <path d="M10 1.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.5 7.7l5.9-.8L10 1.5z" />
        </svg>
      ))}
    </span>
  )
}

const socialPaths: Record<string, string> = {
  Instagram: 'M12 2.2c3.2 0 3.6 0 4.8.1 1.2.1 1.8.2 2.2.4.6.2 1 .5 1.4.9.4.4.7.8.9 1.4.2.4.4 1.1.4 2.2.1 1.3.1 1.6.1 4.8s0 3.6-.1 4.8c-.1 1.2-.2 1.8-.4 2.2-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.2-1.1.4-2.2.4-1.3.1-1.6.1-4.8.1s-3.6 0-4.8-.1c-1.2-.1-1.8-.2-2.2-.4-.6-.2-1-.5-1.4-.9-.4-.4-.7-.8-.9-1.4-.2-.4-.4-1.1-.4-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.8c.1-1.2.2-1.8.4-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.2 1.1-.4 2.2-.4C8.4 2.2 8.8 2.2 12 2.2zm0 4.9a4.9 4.9 0 100 9.8 4.9 4.9 0 000-9.8zm0 8.1a3.2 3.2 0 110-6.4 3.2 3.2 0 010 6.4zm5.1-8.3a1.1 1.1 0 100-2.3 1.1 1.1 0 000 2.3z',
  Facebook: 'M13.5 21.9v-8.1h2.7l.4-3.2h-3.1V8.6c0-.9.3-1.5 1.6-1.5h1.7V4.2c-.3 0-1.3-.1-2.5-.1-2.4 0-4.1 1.5-4.1 4.2v2.3H7.5v3.2h2.7v8.1h3.3z',
  X: 'M17.8 3h3.1l-6.8 7.7L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.2-8.3L1.9 3h6.4l4.4 5.8L17.8 3zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5z',
  LinkedIn: 'M20.4 20.5h-3.6v-5.6c0-1.3 0-3-1.8-3s-2.1 1.4-2.1 2.9v5.7H9.3V9h3.4v1.6h.1c.5-.9 1.6-1.8 3.4-1.8 3.6 0 4.3 2.4 4.3 5.5v6.2zM5.3 7.4a2.1 2.1 0 110-4.2 2.1 2.1 0 010 4.2zM7.1 20.5H3.5V9h3.6v11.5z',
  YouTube: 'M23 7.2s-.2-1.6-.9-2.3c-.9-.9-1.9-.9-2.3-1C16.6 3.6 12 3.6 12 3.6s-4.6 0-7.8.3c-.5.1-1.4.1-2.3 1-.7.7-.9 2.3-.9 2.3S.8 9.1.8 11v1.8c0 1.9.2 3.8.2 3.8s.2 1.6.9 2.3c.9.9 2 .9 2.5 1 1.8.2 7.6.2 7.6.2s4.6 0 7.8-.3c.5-.1 1.4-.1 2.3-1 .7-.7.9-2.3.9-2.3s.2-1.9.2-3.8V11c0-1.9-.2-3.8-.2-3.8zM9.7 14.9V8.4l6.2 3.3-6.2 3.2z',
}

export function SocialIcon({ name }: { name: keyof typeof socialPaths | string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true"><path d={socialPaths[name]} /></svg>
  )
}
export const SOCIALS = Object.keys(socialPaths)
