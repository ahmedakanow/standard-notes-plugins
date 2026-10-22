// Calendar dates as 'YYYY-MM-DD' strings, which also sort correctly as plain strings.

const pad = (n) => String(n).padStart(2, '0')
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The local calendar date. */
export function todayIso(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function toUtc(iso) {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

export function isIsoDate(text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
  return toUtc(text).toISOString().slice(0, 10) === text
}

export function addDays(iso, days) {
  const date = toUtc(iso)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(iso) {
  return toUtc(iso).getUTCDay()
}

/** 'Nov 15', with the year only when it isn't this year. */
export function shortDate(iso, today) {
  const [year, month, day] = iso.split('-').map(Number)
  const label = `${MONTHS[month - 1]} ${day}`
  return String(year) === today.slice(0, 4) ? label : `${label}, ${year}`
}
