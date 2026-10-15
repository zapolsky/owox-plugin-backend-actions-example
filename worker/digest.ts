export type RevenueRow = { day: string; city: string; revenue: number }

export type Digest = { title: string; from: string; to: string; text: string }

const DAY_MS = 86_400_000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const isoDay = (date: Date) => date.toISOString().slice(0, 10)
const daysBefore = (today: Date, days: number) => isoDay(new Date(today.getTime() - days * DAY_MS))
const parseDay = (day: string) => new Date(`${day}T00:00:00Z`)
const amount = (value: number) => Math.round(value).toLocaleString('en-US')

/** The last seven full days in UTC, and the seven days before them. */
export function digestWindow(today: Date) {
  return {
    from: daysBefore(today, 7),
    to: daysBefore(today, 1),
    previousFrom: daysBefore(today, 14),
    previousTo: daysBefore(today, 8),
  }
}

function formatRange(from: string, to: string): string {
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

const largest = (sums: Map<string, number>) =>
  [...sums].reduce<[string, number] | null>(
    (best, entry) => (!best || entry[1] > best[1] ? entry : best),
    null,
  )

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
  const total = current.reduce((sum, row) => sum + row.revenue, 0)
  const previousTotal = previous.reduce((sum, row) => sum + row.revenue, 0)
  const heading = `${title}, ${formatRange(window.from, window.to)}:`
  const digest = (sentences: string[]) => ({
    title,
    from: window.from,
    to: window.to,
    text: sentences.join(' '),
  })

  if (current.length === 0) {
    return digest([
      `${heading} no orders.`,
      ...(previousTotal > 0 ? [`The week before brought ${amount(previousTotal)}.`] : []),
    ])
  }

  const change = percentChange(total, previousTotal)
  const comparison =
    change === null
      ? 'with no revenue the week before'
      : `${trend(change)} on the week before (${amount(previousTotal)})`
  const sentences = [`${heading} revenue ${amount(total)}, ${comparison}.`]

  const cities = sumBy(current, row => row.city)
  const previousCities = sumBy(previous, row => row.city)
  const [topCity, topRevenue] = largest(cities)!
  const topChange = percentChange(topRevenue, previousCities.get(topCity) ?? 0)
  sentences.push(
    `${topCity} brought the most: ${amount(topRevenue)}${topChange ? `, ${trend(topChange)}` : ''}.`,
  )

  const falls = [...previousCities]
    .filter(([city]) => city !== topCity)
    .map(([city, before]) => ({
      city,
      now: cities.get(city) ?? 0,
      change: percentChange(cities.get(city) ?? 0, before)!,
    }))
    .filter(fall => fall.change < 0)
    .sort((a, b) => a.change - b.change)
  if (falls[0])
    sentences.push(`${falls[0].city} fell ${-falls[0].change}% to ${amount(falls[0].now)}.`)

  const [bestDay, bestRevenue] = largest(sumBy(current, row => row.day))!
  const date = parseDay(bestDay)
  const dayName = `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`
  sentences.push(`Best day: ${dayName}, ${amount(bestRevenue)}.`)
  return digest(sentences)
}
