/** Small input rules shared by forms (the database repeats the money / bed rules — scripts/sql/integrity.sql). */

/** 10-digit Indian mobile, optionally written with +91 / 91 / 0 in front and spaces or dashes inside */
export function isIndianMobile(raw: string): boolean {
  const s = String(raw ?? '').trim()
  if (!/^[+\d][\d\s\-()]*$/.test(s)) return false
  let d = s.replace(/\D/g, '')
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2)
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1)
  return /^[6-9]\d{9}$/.test(d)
}
