const DAY_MS = 24 * 60 * 60 * 1000

export function toDateOnly(str) {
  return new Date(str + 'T00:00:00Z')
}

export function daysBetween(a, b) {
  return Math.round((b - a) / DAY_MS)
}

export function addDaysToDate(date, days) {
  const d = new Date(date)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

export function addDays(str, days) {
  return formatDate(addDaysToDate(toDateOnly(str), days))
}

export function formatDate(date) {
  return date.toISOString().slice(0, 10)
}

export function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

export function weekdayOf(str) {
  return toDateOnly(str).getUTCDay()
}
