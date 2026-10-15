export type RevenueRow = { day: string; city: string; revenue: number }

export type CityRevenue = { city: string; revenue: number; previousRevenue: number }

/** Changes are whole percents, null when the week before had nothing to compare with. */
export type Digest = {
  title: string
  from: string
  to: string
  revenue: number
  previousRevenue: number
  change: number | null
  topCity: { city: string; revenue: number; change: number | null } | null
  fall: { city: string; revenue: number; change: number } | null
  bestDay: { day: string; revenue: number } | null
  /** Every city of both weeks, by this week's revenue. */
  cities: CityRevenue[]
  text: string
}

const DAY_MS = 86_400_000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const isoDay = (date: Date) => date.toISOString().slice(0, 10)
const daysBefore = (today: Date, days: number) => isoDay(new Date(today.getTime() - days * DAY_MS))
const parseDay = (day: string) => new Date(`${day}T00:00:00Z`)
export const amount = (value: number) => Math.round(value).toLocaleString('en-US')

/** `Friday 9 Oct`, or `Fri 9 Oct` when short. */
export function dayLabel(day: string, short = false): string {
  const date = parseDay(day)
  const weekday = WEEKDAYS[date.getUTCDay()]
  return `${short ? weekday.slice(0, 3) : weekday} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`
}

/** The last seven full days in UTC, and the seven days before them. */
export function digestWindow(today: Date) {
  return {
    from: daysBefore(today, 7),
    to: daysBefore(today, 1),
    previousFrom: daysBefore(today, 14),
    previousTo: daysBefore(today, 8),
  }
}

/** `8–14 Oct 2026`, or `26 Sep – 2 Oct 2026` across months. */
export function formatRange(from: string, to: string): string {
  const [start, end] = [parseDay(from), parseDay(to)]
  const day = (date: Date) => `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`
  if (
    start.getUTCMonth() === end.getUTCMonth() &&
    start.getUTCFullYear() === end.getUTCFullYear()
  ) {
    return `${start.getUTCDate()}–${day(end)} ${end.getUTCFullYear()}`
  }
  return `${day(start)} – ${day(end)} ${end.getUTCFullYear()}`
}

const trend = (change: number) =>
  change === 0 ? 'flat' : `${change > 0 ? 'up' : 'down'} ${Math.abs(change)}%`

/** A whole-percent change, or null when there is nothing to compare with. */
function percentChange(current: number, previous: number): number | null {
  return previous > 0 ? Math.round((current / previous - 1) * 100) : null
}

function sumBy(rows: RevenueRow[], key: (row: RevenueRow) => string): Map<string, number> {
  const sums = new Map<string, number>()
  for (const row of rows) sums.set(key(row), (sums.get(key(row)) ?? 0) + row.revenue)
  return sums
}

/** Explains which of the digest's columns a Data Mart lacks. */
export function missingColumnsMessage(title: string, missing: readonly string[]): string {
  const quoted = missing.map(column => `"${column}"`)
  const list =
    quoted.length > 1 ? `${quoted.slice(0, -1).join(', ')} or ${quoted.at(-1)}` : quoted[0]
  return `${title} has no ${list} column. A sales digest needs "order_date", "city" and "revenue".`
}

/** Writes the weekly digest from revenue grouped by day and city. */
export function writeDigest(title: string, rows: RevenueRow[], today: Date): Digest {
  const window = digestWindow(today)
  const current = rows.filter(row => row.day >= window.from && row.day <= window.to)
  const previous = rows.filter(
    row => row.day >= window.previousFrom && row.day <= window.previousTo,
  )
  const sum = (part: RevenueRow[]) => part.reduce((total, row) => total + row.revenue, 0)
  const [revenue, previousRevenue] = [sum(current), sum(previous)]
  const change = percentChange(revenue, previousRevenue)

  const thisWeek = sumBy(current, row => row.city)
  const weekBefore = sumBy(previous, row => row.city)
  const cities = [...new Set([...thisWeek.keys(), ...weekBefore.keys()])]
    .map(city => ({
      city,
      revenue: thisWeek.get(city) ?? 0,
      previousRevenue: weekBefore.get(city) ?? 0,
    }))
    .sort((a, b) => b.revenue - a.revenue)

  const top = current.length > 0 ? cities[0] : undefined
  const topCity = top
    ? {
        city: top.city,
        revenue: top.revenue,
        change: percentChange(top.revenue, top.previousRevenue),
      }
    : null
  const fall = top
    ? (cities
        .filter(city => city.city !== top.city && city.previousRevenue > 0)
        .map(city => ({
          city: city.city,
          revenue: city.revenue,
          change: percentChange(city.revenue, city.previousRevenue)!,
        }))
        .filter(city => city.change < 0)
        .sort((a, b) => a.change - b.change)[0] ?? null)
    : null
  const days = [...sumBy(current, row => row.day)].sort((a, b) => b[1] - a[1])
  const bestDay = days[0] ? { day: days[0][0], revenue: days[0][1] } : null

  const heading = `${title}, ${formatRange(window.from, window.to)}:`
  const comparison =
    change === null
      ? 'with no revenue the week before'
      : `${trend(change)} on the week before (${amount(previousRevenue)})`
  const sentences =
    topCity && bestDay
      ? [
          `${heading} revenue ${amount(revenue)}, ${comparison}.`,
          `${topCity.city} brought the most: ${amount(topCity.revenue)}` +
            `${topCity.change ? `, ${trend(topCity.change)}` : ''}.`,
          ...(fall ? [`${fall.city} fell ${-fall.change}% to ${amount(fall.revenue)}.`] : []),
          `Best day: ${dayLabel(bestDay.day)}, ${amount(bestDay.revenue)}.`,
        ]
      : [
          `${heading} no orders.`,
          ...(previousRevenue > 0 ? [`The week before brought ${amount(previousRevenue)}.`] : []),
        ]

  return {
    title,
    from: window.from,
    to: window.to,
    revenue,
    previousRevenue,
    change,
    topCity,
    fall,
    bestDay,
    cities,
    text: sentences.join(' '),
  }
}
