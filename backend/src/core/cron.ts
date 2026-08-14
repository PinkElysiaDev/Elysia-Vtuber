/** 5-field cron: minute hour day-of-month month day-of-week */

export function parseCron(expr: string): string[] | null {
  const parts = expr.trim().split(/\s+/)
  return parts.length === 5 ? parts : null
}

export function cronMatches(expr: string, date: Date = new Date()): boolean {
  const parts = parseCron(expr)
  if (!parts) return false
  const [min, hour, dom, month, dow] = parts
  return (
    fieldMatches(min, date.getMinutes(), 0, 59) &&
    fieldMatches(hour, date.getHours(), 0, 23) &&
    fieldMatches(dom, date.getDate(), 1, 31) &&
    fieldMatches(month, date.getMonth() + 1, 1, 12) &&
    fieldMatches(dow, date.getDay(), 0, 7, true)
  )
}

/** Minute-precision key so a rule fires at most once per matching minute. */
export function cronMinuteKey(date: Date = new Date()): string {
  return [
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
  ].join('-')
}

function fieldMatches(field: string, value: number, min: number, max: number, dow = false): boolean {
  if (field === '*') return true
  return field.split(',').some((part) => matchPart(part.trim(), value, min, max, dow))
}

function matchPart(part: string, value: number, min: number, max: number, dow: boolean): boolean {
  if (!part) return false
  let range = part
  let step = 1
  const slash = part.indexOf('/')
  if (slash >= 0) {
    range = part.slice(0, slash)
    step = Number(part.slice(slash + 1))
    if (!Number.isFinite(step) || step <= 0) return false
  }

  const actual = dow ? normalizeDow(value) : value

  if (range === '*' || range === '') {
    return ((actual - min) % step) === 0
  }

  if (range.includes('-')) {
    const [aRaw, bRaw] = range.split('-')
    let a = Number(aRaw)
    let b = Number(bRaw)
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false
    if (dow) {
      a = normalizeDow(a)
      b = normalizeDow(b)
      if (a <= b) {
        for (let i = a; i <= b; i += step) {
          if (normalizeDow(i) === actual) return true
        }
        return false
      }
      for (let i = a; i <= 6; i += step) {
        if (normalizeDow(i) === actual) return true
      }
      return false
    }
    if (actual < a || actual > b) return false
    return ((actual - a) % step) === 0
  }

  const n = Number(range)
  if (!Number.isFinite(n)) return false
  const target = dow ? normalizeDow(n) : n
  if (actual !== target) return false
  return step === 1
}

function normalizeDow(n: number): number {
  if (n === 7) return 0
  return n
}
