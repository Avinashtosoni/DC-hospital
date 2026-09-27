import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowUpDown, Search, SearchX, SlidersHorizontal, X } from 'lucide-react'
import { cn } from '../../lib/utils'
import { DEPARTMENTS, DOCTORS, nextAvailable } from '../data/doctors'
import { useSeo } from '../hooks'
import { CtaBand, DoctorCard, PageHero } from '../ui'

type Sort = 'recommended' | 'experience' | 'rating' | 'fee-low' | 'fee-high'
const SORTS: [Sort, string][] = [['recommended', 'Recommended'], ['experience', 'Most experienced'], ['rating', 'Highest rated'], ['fee-low', 'Fee: low to high'], ['fee-high', 'Fee: high to low']]

export default function FindDoctor() {
  useSeo('Find a doctor', 'Search DC Hospital specialists by name, speciality, language or availability and book an appointment online in 30 seconds.')
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const dept = params.get('dept') ?? 'All'
  const sort = (params.get('sort') as Sort) ?? 'recommended'
  const today = params.get('today') === '1'

  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params)
    if (v === null || v === '' || v === 'All' || (k === 'sort' && v === 'recommended')) next.delete(k); else next.set(k, v)
    setParams(next, { replace: true })
  }

  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    let r = DOCTORS.filter((d) =>
      (dept === 'All' || d.dept === dept) &&
      (!today || nextAvailable(d) === 'Today') &&
      (!t || [d.name, d.role, d.dept, d.quals, ...d.expertise, ...d.langs].join(' ').toLowerCase().includes(t)))
    const by: Record<Sort, (a: typeof r[0], b: typeof r[0]) => number> = {
      recommended: (a, b) => Number(!!b.featured) - Number(!!a.featured) || b.rating - a.rating,
      experience: (a, b) => b.exp - a.exp,
      rating: (a, b) => b.rating - a.rating || b.reviews - a.reviews,
      'fee-low': (a, b) => a.fee - b.fee,
      'fee-high': (a, b) => b.fee - a.fee,
    }
    r = [...r].sort(by[sort] ?? by.recommended)
    return r
  }, [q, dept, sort, today])

  const activeFilters = (q ? 1 : 0) + (dept !== 'All' ? 1 : 0) + (today ? 1 : 0)

  return (
    <>
      <PageHero
        center
        crumbs={[{ label: 'Find a doctor' }]}
        eyebrow={`${DOCTORS.length} senior specialists`}
        title={<>Find the <span className="text-gradient">right doctor</span> for you</>}
        lead="Search by name, speciality, condition or language. See real availability and book in seconds."
      >
        <div className="glass mx-auto flex max-w-2xl items-center gap-3 rounded-full p-2 pl-5">
          <Search className="h-5 w-5 shrink-0 text-peri-500" aria-hidden="true" />
          <input value={q} onChange={(e) => set('q', e.target.value)} type="search" placeholder="Try “knee pain”, “Hindi” or “Dr. Rao”" aria-label="Search doctors"
            className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-peri-900 outline-none placeholder:text-slate-400" />
          {q && <button type="button" onClick={() => set('q', null)} className="grid h-8 w-8 place-items-center rounded-full text-slate-400 transition hover:bg-peri-100 hover:text-peri-800" aria-label="Clear search"><X className="h-4 w-4" /></button>}
        </div>
      </PageHero>

      <section className="pb-20" aria-labelledby="results-title">
        <div className="l-container">
          {/* filter bar */}
          <div className="sticky top-[72px] z-30 -mx-5 mb-8 border-y border-peri-200/60 bg-[#fbfbff]/85 px-5 py-3 backdrop-blur-xl sm:mx-0 sm:rounded-3xl sm:border sm:px-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="mask-fade-x -mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0 sm:[mask-image:none]">
                <div className="flex w-max gap-1.5" role="radiogroup" aria-label="Department">
                  {['All', ...DEPARTMENTS].map((d) => (
                    <button key={d} type="button" role="radio" aria-checked={dept === d} onClick={() => set('dept', d)}
                      className={cn('whitespace-nowrap rounded-full border px-4 py-2 text-xs font-semibold transition-all duration-300',
                        dept === d ? 'border-peri-800 bg-peri-800 text-white shadow-glow' : 'border-peri-200 bg-white text-slate-600 hover:border-peri-400 hover:text-peri-800')}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" role="switch" aria-checked={today} onClick={() => set('today', today ? null : '1')}
                  className={cn('flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3 py-2 text-xs font-semibold transition', today ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-peri-200 bg-white text-slate-600 hover:border-peri-400')}>
                  <span className={cn('relative h-4 w-7 rounded-full transition', today ? 'bg-emerald-500' : 'bg-slate-300')}><span className={cn('absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all', today ? 'left-3.5' : 'left-0.5')} /></span>
                  Available today
                </button>
                <label className="relative flex items-center">
                  <span className="sr-only">Sort doctors</span>
                  <ArrowUpDown className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-peri-500" aria-hidden="true" />
                  <select value={sort} onChange={(e) => set('sort', e.target.value)} className="cursor-pointer appearance-none rounded-full border border-peri-200 bg-white py-2 pl-8 pr-4 text-xs font-semibold text-peri-900 outline-none transition hover:border-peri-400 focus:ring-4 focus:ring-peri-200">
                    {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
              </div>
            </div>
          </div>

          <div className="mb-6 flex items-center justify-between">
            <h2 id="results-title" className="text-sm text-slate-500" aria-live="polite"><strong className="text-peri-900">{list.length}</strong> {list.length === 1 ? 'doctor' : 'doctors'} found</h2>
            {activeFilters > 0 && (
              <button type="button" onClick={() => setParams({}, { replace: true })} className="flex items-center gap-1.5 text-xs font-semibold text-peri-700 transition hover:text-peri-900">
                <SlidersHorizontal className="h-3.5 w-3.5" />Clear {activeFilters} filter{activeFilters > 1 ? 's' : ''}
              </button>
            )}
          </div>

          {list.length === 0 ? (
            <div className="mx-auto max-w-md animate-pop-in rounded-3xl border border-dashed border-peri-300 bg-white/70 p-10 text-center">
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-peri-100 text-peri-600"><SearchX className="h-7 w-7" /></span>
              <p className="mt-4 font-display text-lg font-bold text-peri-900">No doctors match your filters</p>
              <p className="mt-1 text-sm text-slate-500">Try removing a filter, or call our care team and we’ll find the right specialist for you.</p>
              <button type="button" onClick={() => setParams({}, { replace: true })} className="btn-ghost mt-6">Reset filters</button>
            </div>
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {list.map((d, i) => <DoctorCard key={`${d.slug}-${dept}-${sort}-${today}`} d={d} delay={Math.min(i, 8) * 50} />)}
            </div>
          )}
        </div>
      </section>

      <CtaBand title={<>Can’t decide? <span className="text-peri-300">We’ll help you choose.</span></>} lead="Our care coordinators match you with the right specialist based on your symptoms — free of charge." badge="Free care coordination" />
    </>
  )
}
