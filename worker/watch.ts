/** When a check alerts: outside the usual range of the weeks before, or a change bigger than a percent. */
export type Rule =
  | { kind: 'unusual' }
  | { kind: 'change'; percent: number; direction: 'down' | 'up' | 'any' }

/** A Data Mart metric to watch, saved in the `watches` collection. */
export type Watch = {
  /** What the metric is called, such as ROAS. */
  name: string
  dataMartId: string
  dataMartTitle: string
  dateColumn: string
  /** The metric is SUM(numerator), or SUM(numerator) / SUM(denominator) when a denominator is set. */
  numerator: string
  denominator: string | null
  /** Up to three columns that explain a change, such as channel, campaign and country. */
  dimensions: string[]
  rule: Rule
}

/** Sums for one day, and for one value of a dimension when `segment` is set. */
export type SumRow = { day: string; segment?: string; numerator: number; denominator: number }

export type Week = { from: string; to: string; value: number | null }

export type Segment = {
  name: string
  /** This value's part of the metric's change; the parts of a dimension add up to the whole change. */
  contribution: number
  value: number | null
  previousValue: number | null
  /** Percent changes of the summed columns, null when the week before had none. */
  numeratorChange: number | null
  denominatorChange: number | null
}

export type Breakdown = { dimension: string; segments: Segment[] }

/** One checked week, saved in the `checks` collection as `<watchId>~<asOf>`. */
export type Check = {
  watchId: string
  name: string
  /** The day the check ran for: it covers the seven days before it. */
  asOf: string
  from: string
  to: string
  value: number | null
  previousValue: number | null
  /** Whole percent against the week before. */
  change: number | null
  /** Median ± 3 robust deviations of the eight weeks before. */
  usual: { low: number; high: number } | null
  alert: boolean
  reason: string
  /** Nine weeks, oldest first; the last one is the checked week. */
  weeks: Week[]
  breakdowns: Breakdown[]
  text: string
  checkedAt: string
}

const DAY_MS = 86_400_000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** The weeks before the checked one that set its usual range. */
export const BASELINE_WEEKS = 8
/** Segments a dimension keeps; the rest are summed into one "Other" row. */
const TOP_SEGMENTS = 6

export const shiftDay = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)

/** Week `k` before `asOf`: seven days that end `7k + 1` days before it. */
export const weekAt = (asOf: string, k: number) => ({
  from: shiftDay(asOf, -7 * (k + 1)),
  to: shiftDay(asOf, -7 * k - 1),
})

/** The first day that `checks` weekly checks back from `asOf` read, with their usual ranges. */
export const firstDay = (asOf: string, checks: number) =>
  weekAt(asOf, checks - 1 + BASELINE_WEEKS).from

/** `8–14 Oct 2026`, or `26 Sep – 2 Oct 2026` across months. */
export function formatRange(from: string, to: string): string {
  const [start, end] = [new Date(`${from}T00:00:00Z`), new Date(`${to}T00:00:00Z`)]
  const day = (date: Date) => `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`
  if (start.getUTCMonth() === end.getUTCMonth() && start.getUTCFullYear() === end.getUTCFullYear()) {
    return `${start.getUTCDate()}–${day(end)} ${end.getUTCFullYear()}`
  }
  return `${day(start)} – ${day(end)} ${end.getUTCFullYear()}`
}

/** `1.96` for a ratio, `54,138` for a sum, `—` when undefined. */
export function formatValue(value: number | null, ratio: boolean): string {
  if (value === null) return '—'
  return ratio
    ? value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : Math.round(value).toLocaleString('en-US')
}

export const signed = (value: number, ratio: boolean) =>
  `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatValue(Math.abs(value), ratio)}`

type Sums = { numerator: number; denominator: number }

const metric = (sums: Sums, ratio: boolean) =>
  ratio ? (sums.denominator ? sums.numerator / sums.denominator : null) : sums.numerator

const percent = (now: number, before: number) =>
  before ? Math.round((now / before - 1) * 100) : null

function sumBySegment(rows: SumRow[], from: string, to: string): Map<string, Sums> {
  const sums = new Map<string, Sums>()
  for (const row of rows) {
    if (row.day < from || row.day > to) continue
    const key = row.segment ?? ''
    const sum = sums.get(key) ?? { numerator: 0, denominator: 0 }
    sum.numerator += row.numerator
    sum.denominator += row.denominator
    sums.set(key, sum)
  }
  return sums
}

const total = (sums: Iterable<Sums>) =>
  [...sums].reduce((all, sum) => ({
    numerator: all.numerator + sum.numerator,
    denominator: all.denominator + sum.denominator,
  }), { numerator: 0, denominator: 0 })

const middle = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const half = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2
}

/**
 * Median ± 3 robust deviations (1.4826 × MAD, at least 5% of the median), so up to three unusual
 * weeks out of eight do not widen the range. Null with fewer than four weeks of data.
 */
export function usualRange(values: (number | null)[]): { low: number; high: number } | null {
  const known = values.filter((value): value is number => value !== null)
  if (known.length < 4) return null
  const median = middle(known)
  const spread = Math.max(
    1.4826 * middle(known.map(value => Math.abs(value - median))),
    0.05 * Math.abs(median),
  )
  return { low: median - 3 * spread, high: median + 3 * spread }
}

/**
 * Splits the change of the metric between the values of one dimension. A sum splits by each
 * value's own change. A ratio R = ΣN / ΣD splits exactly as
 * (N₁ − R₀·D₁) / ΣD₁ − (N₀ − R₀·D₀) / ΣD₀ per value, so a value that grows its cost without
 * revenue gets the drop, and the parts add up to R₁ − R₀.
 */
export function breakdown(
  rows: SumRow[],
  current: { from: string; to: string },
  previous: { from: string; to: string },
  ratio: boolean,
): Segment[] {
  const now = sumBySegment(rows, current.from, current.to)
  const before = sumBySegment(rows, previous.from, previous.to)
  const [totalNow, totalBefore] = [total(now.values()), total(before.values())]
  const ratioBefore = metric(totalBefore, true)
  if (ratio && (ratioBefore === null || !totalNow.denominator)) return []

  const zero = { numerator: 0, denominator: 0 }
  const segments = [...new Set([...now.keys(), ...before.keys()])].map(name => {
    const [n, b] = [now.get(name) ?? zero, before.get(name) ?? zero]
    const contribution = ratio
      ? (n.numerator - ratioBefore! * n.denominator) / totalNow.denominator -
        (b.numerator - ratioBefore! * b.denominator) / totalBefore.denominator
      : n.numerator - b.numerator
    return {
      name,
      contribution,
      value: metric(n, ratio),
      previousValue: metric(b, ratio),
      numeratorChange: percent(n.numerator, b.numerator),
      denominatorChange: ratio ? percent(n.denominator, b.denominator) : null,
    }
  })
  segments.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
  if (segments.length <= TOP_SEGMENTS + 1) return segments

  const rest = segments.slice(TOP_SEGMENTS)
  return [
    ...segments.slice(0, TOP_SEGMENTS),
    {
      name: `Other (${rest.length})`,
      contribution: rest.reduce((sum, segment) => sum + segment.contribution, 0),
      value: null,
      previousValue: null,
      numeratorChange: null,
      denominatorChange: null,
    },
  ]
}

function judge(
  watch: Watch,
  value: number | null,
  previousValue: number | null,
  usual: Check['usual'],
): { alert: boolean; reason: string } {
  const ratio = watch.denominator !== null
  if (value === null) {
    return { alert: false, reason: `No ${watch.denominator} this week, so ${watch.name} is undefined.` }
  }
  if (watch.rule.kind === 'unusual') {
    if (!usual) return { alert: false, reason: 'Needs four earlier weeks with data to know the usual range.' }
    const range = `${formatValue(usual.low, ratio)}–${formatValue(usual.high, ratio)}`
    if (value < usual.low) return { alert: true, reason: `Below the usual ${range} of the eight weeks before.` }
    if (value > usual.high) return { alert: true, reason: `Above the usual ${range} of the eight weeks before.` }
    return { alert: false, reason: `Within the usual ${range} of the eight weeks before.` }
  }
  if (!previousValue) return { alert: false, reason: 'No week before to compare with.' }
  const change = (value / previousValue - 1) * 100
  const { percent: limit, direction } = watch.rule
  const alert =
    (direction !== 'up' && change <= -limit) || (direction !== 'down' && change >= limit)
  const moved = `${change < 0 ? 'Fell' : 'Rose'} ${Math.abs(Math.round(change))}%`
  return { alert, reason: alert ? `${moved}, past the ${limit}% the rule allows.` : `${moved}, within ${limit}%.` }
}

function describe(watch: Watch, check: Omit<Check, 'text'>): string {
  const ratio = watch.denominator !== null
  const range = formatRange(check.from, check.to)
  if (check.value === null) return `${watch.name}, ${range}: ${check.reason}`
  const { change } = check
  const moved =
    change === null
      ? `was ${formatValue(check.value, ratio)}`
      : change === 0
        ? `held at ${formatValue(check.value, ratio)}`
        : `${change < 0 ? 'fell' : 'rose'} ${Math.abs(change)}% to ${formatValue(check.value, ratio)}`
  const sentences = [
    `${watch.name}, ${range}: ${moved}${check.previousValue === null ? '' : ` (${formatValue(check.previousValue, ratio)} the week before)`}.`,
  ]
  if (check.alert) sentences.push(check.reason)

  const whole = check.value - (check.previousValue ?? 0)
  if (check.previousValue === null || whole === 0) return sentences.join(' ')
  // The top value of each dimension, strongest first: a country-wide problem leads with the country.
  const drivers = check.breakdowns
    .flatMap(({ dimension, segments }) => {
      const top = segments.find(segment => segment.contribution * whole > 0 && !segment.name.startsWith('Other ('))
      return top ? [{ dimension, top, share: Math.round((top.contribution / whole) * 100) }] : []
    })
    .sort((a, b) => b.share - a.share)
  if (drivers.length === 0) return sentences.join(' ')

  const named = ({ dimension, top, share }: (typeof drivers)[number]) => `${dimension} "${top.name}" (${share}%)`
  const strong = drivers.filter(driver => driver.share >= 50)
  sentences.push(
    strong.length > 0
      ? `Driven by ${strong.map(named).join(', ').replace(/, ([^,]*)$/, ' and $1')}.`
      : `No single value explains most of it; the largest is ${named(drivers[0])}.`,
  )
  const { top } = (strong[0] ?? drivers[0])
  const sides = [
    top.denominatorChange === null ? null : `${watch.denominator} ${signedPercent(top.denominatorChange)}`,
    top.numeratorChange === null ? null : `${watch.numerator} ${signedPercent(top.numeratorChange)}`,
  ].filter(Boolean)
  if (sides.length > 0) sentences.push(`In "${top.name}", ${sides.join(', ')}.`)
  return sentences.join(' ')
}

export const signedPercent = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value)}%`

/** Checks the week before `asOf` from daily sums: in total, and per value of each dimension. */
export function checkWeek(
  watchId: string,
  watch: Watch,
  asOf: string,
  totals: SumRow[],
  byDimension: Record<string, SumRow[]>,
  checkedAt: string,
): Check {
  const ratio = watch.denominator !== null
  const weeks = Array.from({ length: BASELINE_WEEKS + 1 }, (_, i) => {
    const window = weekAt(asOf, BASELINE_WEEKS - i)
    return { ...window, value: metric(total(sumBySegment(totals, window.from, window.to).values()), ratio) }
  })
  const [current, previous] = [weeks[BASELINE_WEEKS], weeks[BASELINE_WEEKS - 1]]
  const usual = usualRange(weeks.slice(0, BASELINE_WEEKS).map(week => week.value))
  const change =
    current.value !== null && previous.value ? percent(current.value, previous.value) : null
  const check = {
    watchId,
    name: watch.name,
    asOf,
    from: current.from,
    to: current.to,
    value: current.value,
    previousValue: previous.value,
    change,
    usual,
    ...judge(watch, current.value, previous.value, usual),
    weeks,
    breakdowns: watch.dimensions.map(dimension => ({
      dimension,
      segments: breakdown(byDimension[dimension] ?? [], current, previous, ratio),
    })),
    checkedAt,
  }
  return { ...check, text: describe(watch, check) }
}

/** Explains which of the watched columns a Data Mart lacks. */
export function missingColumnsMessage(title: string, missing: readonly string[]): string {
  const quoted = missing.map(column => `"${column}"`)
  const list = quoted.length > 1 ? `${quoted.slice(0, -1).join(', ')} or ${quoted.at(-1)}` : quoted[0]
  return `${title} has no ${list} column any more. Fix the Data Mart, or delete the watch and create it again.`
}
