/**
 * A small, backend-neutral query description used for server-side pagination, search and windowed reads.
 *
 * The same `Query` runs against Supabase (translated to PostgREST filters, so only the requested page leaves
 * the database) and against the demo store (evaluated in memory by `runQuery`), which keeps both modes
 * behaving identically.
 */
export type Op = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'nin' | 'is_null' | 'not_null'
export type Filter = readonly [column: string, op: Op, value?: unknown]

export interface SearchSpec {
  /** free text typed by the user */
  term: string
  /** text columns matched with a case-insensitive "contains" */
  columns: string[]
  /** …or rows whose foreign key is one of these ids (e.g. patients whose name matched) */
  ids?: { column: string; ids: string[] }[]
}

export interface Query {
  where?: Filter[]
  search?: SearchSpec
  order?: { column: string; asc?: boolean }[]
  /** zero-based, inclusive [from, to] — same convention as PostgREST */
  range?: [number, number]
  /** also return the total number of matching rows (ignores range) */
  count?: boolean
  /** only return the count, no rows */
  head?: boolean
}

export interface QueryResult<T> { rows: T[]; count: number | null }

/** characters that would break PostgREST's or=() syntax or act as wildcards */
export const cleanTerm = (s: string) => s.replace(/[,()*%\\"':]/g, ' ').replace(/\s+/g, ' ').trim()

const get = (r: unknown, c: string) => (r as Record<string, unknown>)[c]

function cmp(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0
  if (a == null) return 1 // nulls last
  if (b == null) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  const na = Number(a), nb = Number(b)
  if (typeof a !== 'boolean' && a !== '' && b !== '' && !Number.isNaN(na) && !Number.isNaN(nb) && /^-?\d+(\.\d+)?$/.test(String(a)) && /^-?\d+(\.\d+)?$/.test(String(b))) return na - nb
  return String(a).localeCompare(String(b))
}

export function matches(r: unknown, [column, op, value]: Filter): boolean {
  const v = get(r, column)
  switch (op) {
    case 'eq': return v === value || (v != null && value != null && String(v) === String(value))
    case 'neq': return !(v === value || (v != null && value != null && String(v) === String(value)))
    case 'gt': return v != null && cmp(v, value) > 0
    case 'gte': return v != null && cmp(v, value) >= 0
    case 'lt': return v != null && cmp(v, value) < 0
    case 'lte': return v != null && cmp(v, value) <= 0
    case 'in': return (value as unknown[]).some((x) => String(x) === String(v))
    case 'nin': return v != null && !(value as unknown[]).some((x) => String(x) === String(v))
    case 'is_null': return v == null
    case 'not_null': return v != null
  }
}

/** Evaluate a query in memory (demo store). Mirrors the PostgREST translation in supabaseAdapter. */
export function runQuery<T>(all: T[], q: Query = {}): QueryResult<T> {
  let rows = all
  if (q.where?.length) rows = rows.filter((r) => q.where!.every((f) => matches(r, f)))
  const term = q.search ? cleanTerm(q.search.term).toLowerCase() : ''
  if (term && q.search) {
    const { columns, ids = [] } = q.search
    const idSets = ids.map((x) => ({ column: x.column, set: new Set(x.ids) }))
    rows = rows.filter((r) => columns.some((c) => String(get(r, c) ?? '').toLowerCase().includes(term))
      || idSets.some((x) => x.set.has(String(get(r, x.column) ?? ''))))
  }
  if (q.order?.length) {
    const order = q.order
    rows = [...rows].sort((a, b) => {
      for (const o of order) {
        const d = cmp(get(a, o.column), get(b, o.column))
        if (d) return o.asc === false ? -d : d
      }
      return cmp(get(a, 'id'), get(b, 'id'))
    })
  }
  const count = q.count || q.head ? rows.length : null
  if (q.head) return { rows: [], count }
  if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1)
  return { rows, count }
}

/** Stable cache key for a query (react-query hashes objects, but arrays inside filters need care). */
export const queryKey = (q: Query) => JSON.stringify(q)
