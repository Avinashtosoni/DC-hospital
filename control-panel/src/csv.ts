/**
 * CSV for the control panel's import (Data tab): a small RFC-4180 parser (quotes, commas / newlines inside quotes,
 * Excel's BOM and ; separators) and header matching, so a file saved from Excel or Google Sheets just works.
 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '')
  const firstLine = src.slice(0, src.search(/\r?\n|$/))
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"' && cell === '') quoted = true
    else if (c === sep) { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((v) => v.trim() !== '')) rows.push(row)
      row = []
    } else cell += c
  }
  row.push(cell)
  if (row.some((v) => v.trim() !== '')) rows.push(row)
  return rows
}

export type ImportKind = 'patients' | 'doctors'
/** the columns the database understands, with the header names people actually use */
export const IMPORT_COLUMNS: Record<ImportKind, Record<string, string[]>> = {
  patients: {
    full_name: ['full name', 'name', 'patient name', 'patient'],
    phone: ['phone', 'mobile', 'mobile number', 'phone number', 'contact'],
    gender: ['gender', 'sex'],
    date_of_birth: ['date of birth', 'dob', 'birth date', 'birthday'],
    blood_group: ['blood group', 'blood'],
    email: ['email', 'e-mail', 'email address'],
    address: ['address', 'city'],
  },
  doctors: {
    full_name: ['full name', 'name', 'doctor name', 'doctor'],
    specialization: ['specialization', 'specialisation', 'speciality', 'specialty'],
    department: ['department', 'dept'],
    qualification: ['qualification', 'degree', 'degrees'],
    phone: ['phone', 'mobile', 'mobile number'],
    email: ['email', 'e-mail'],
    consultation_fee: ['consultation fee', 'fee', 'fees', 'opd fee'],
    experience_years: ['experience years', 'experience', 'years of experience'],
  },
}
export const TEMPLATE: Record<ImportKind, string> = {
  patients: 'full_name,phone,gender,date_of_birth,blood_group,email,address\nRavi Kumar,9876543210,male,1985-04-12,B+,ravi@example.com,Patna\n',
  doctors: 'full_name,specialization,department,qualification,phone,email,consultation_fee,experience_years\nDr Anjali Rao,Cardiologist,Cardiology,MBBS MD,9876543211,anjali@example.com,800,12\n',
}

const norm = (h: string) => h.trim().toLowerCase().replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ')

/** DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY (Indian order) → YYYY-MM-DD; anything else is passed on for the database to judge */
export function isoDate(v: string): string {
  const t = v.trim()
  const m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : t
}

/** header row → our column names; returns the rows as objects plus the headers we couldn't use */
export function mapRows(kind: ImportKind, table: string[][]): { rows: Record<string, string>[]; unknown: string[]; missing: string[] } {
  const [head = [], ...body] = table
  const cols = IMPORT_COLUMNS[kind]
  const keys = head.map((h) => {
    const n = norm(h)
    return Object.entries(cols).find(([k, alts]) => norm(k) === n || alts.includes(n))?.[0] ?? null
  })
  const rows = body.map((r) => {
    const o: Record<string, string> = {}
    keys.forEach((k, i) => { if (k && r[i] !== undefined && r[i].trim() !== '') o[k] = k === 'date_of_birth' ? isoDate(r[i]) : r[i].trim() })
    return o
  })
  const required = kind === 'patients' ? ['full_name'] : ['full_name', 'specialization']
  return { rows, unknown: head.filter((_, i) => !keys[i]), missing: required.filter((k) => !keys.includes(k)) }
}
