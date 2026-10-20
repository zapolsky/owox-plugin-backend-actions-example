import { BASELINE_PERIODS, granularityOf, periodAt, periodLabel, type Granularity } from './period.ts'

/** When a check alerts: outside the usual range of the weeks before, or a change bigger than a percent. */
export type Rule =
  | { kind: 'unusual' }
  | { kind: 'change'; percent: number; direction: 'down' | 'up' | 'any' }

/** How a watch's values read: `54,138`, `1.96%` or `1.99×`. */
export type Format = 'number' | 'percent' | 'times'

/** How unusual a week must be to count: fewer alerts at low, more at high. */
export type Sensitivity = 'low' | 'medium' | 'high'

/** Robust deviations from the median that bound the usual range at each sensitivity. */
export const DEVIATIONS: Record<Sensitivity, number> = { low: 4, medium: 3, high: 2 }

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
  /** `number` when unset, as for watches saved before formats. */
  format?: Format
  /** Whether a rise is good news, as for revenue (the default), or bad, as for cost. */
  rise?: 'good' | 'bad'
  /** `medium` when unset. */
  sensitivity?: Sensitivity
  /** How long a checked period is; `week` when unset, as for watches saved before periods. */
  granularity?: Granularity
}

/** Sums for one day, or one period's for a month or quarter watch, and for one value of a dimension when `segment` is set. */
export type SumRow = { day: string; segment?: string; numerator: number; denominator: number }

/** A checked period; named for the weekly first version. */
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

/** One checked period, saved in the `checks` collection as `<watchId>~<asOf>`. */
export type Check = {
  watchId: string
  name: string
  /** The watch's period when it was checked; a week when unset. */
  granularity?: Granularity
  /** The first day after the checked period. */
  asOf: string
  from: string
  to: string
  value: number | null
  previousValue: number | null
  /** Whole percent against the period before. */
  change: number | null
  /** Median ± robust deviations of the eight periods before. */
  usual: { low: number; high: number } | null
  alert: boolean
  reason: string
  /** The checked period and the eight before it, oldest first; named for the weekly first version. */
  weeks: Week[]
  breakdowns: Breakdown[]
  text: string
  checkedAt: string
  /** What started the check: the page, or the watch's schedule. */
  trigger?: 'frontend' | 'schedule'
}

/** Segments a dimension keeps; the rest are summed into one "Other" row. */
const TOP_SEGMENTS = 6

/**
 * Decimal places for a watch's values: null for a sum, and for a ratio near `value` enough for
 * three significant digits, at least two: `1.96`, `0.104`, `0.0231`.
 */
export function placesFor(ratio: boolean, value: number | null): number | null {
  if (!ratio) return null
  return value ? Math.min(6, Math.max(2, 2 - Math.floor(Math.log10(Math.abs(value))))) : 2
}

/** `1.96` for a ratio, `54,138` for a sum (`places` null), `—` when undefined. */
export function formatValue(value: number | null, places: number | null): string {
  if (value === null) return '—'
  return places === null
    ? Math.round(value).toLocaleString('en-US')
    : value.toLocaleString('en-US', { minimumFractionDigits: places, maximumFractionDigits: places })
}

/** `+0.66`, `−1,204`, and `0.00` without a sign when the value rounds to zero. */
export function signed(value: number, places: number | null): string {
  const text = formatValue(Math.abs(value), places)
  return /[1-9]/.test(text) ? `${value > 0 ? '+' : '−'}${text}` : text
}

/** A watch's value as it reads: `54,138`, `$54,138`, `$76.99`, `1.96%`, `10.1%` or `1.99×`. */
export function formatMetric(
  value: number | null,
  watch: Pick<Watch, 'format'>,
  places: number | null,
): string {
  if (value === null) return '—'
  if (watch.format === 'percent') return `${formatValue(value * 100, Math.abs(value) >= 0.1 ? 1 : 2)}%`
  if (watch.format === 'times') return `${formatValue(value, 2)}×`
  return formatValue(value, places)
}

/** A part of a change in the watch's terms: `−0.71`, `−2,972`, `−0.50 pp`; no sign when it rounds to zero. */
export function formatDelta(value: number, watch: Pick<Watch, 'format'>, places: number | null): string {
  if (watch.format === 'percent') return `${signed(value * 100, 2)} pp`
  return signed(value, watch.format === 'times' ? 2 : places)
}

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
 * Median ± `deviations` robust deviations (1.4826 × MAD, at least 5% of the median), so up to three
 * unusual weeks out of eight do not widen the range. Null with fewer than four weeks of data.
 */
export function usualRange(
  values: (number | null)[],
  deviations = DEVIATIONS.medium,
): { low: number; high: number } | null {
  const known = values.filter((value): value is number => value !== null)
  if (known.length < 4) return null
  const median = middle(known)
  const spread = Math.max(
    1.4826 * middle(known.map(value => Math.abs(value - median))),
    0.05 * Math.abs(median),
  )
  return { low: median - deviations * spread, high: median + deviations * spread }
}

/**
 * Splits the change of the metric between the values of one dimension. A sum splits by each
 * value's own change. A ratio R = ΣN / ΣD splits exactly as (ΔN − R₀·ΔD) / ΣD₁ per value: what the
 * value added beyond what its added cost earns at last week's ratio. The parts add up to R₁ − R₀,
 * a value that grows its cost without revenue gets the drop, and a value that did not change gets
 * nothing.
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
      ? (n.numerator - b.numerator - ratioBefore! * (n.denominator - b.denominator)) / totalNow.denominator
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
  places: number | null,
): { alert: boolean; reason: string } {
  const unit = granularityOf(watch)
  const ratio = watch.denominator !== null
  if (value === null) {
    return {
      alert: false,
      reason: ratio ? `No ${watch.denominator} this ${unit}, so ${watch.name} is undefined.` : `No data this ${unit}.`,
    }
  }
  if (watch.rule.kind === 'unusual') {
    if (!usual) return { alert: false, reason: `Needs four earlier ${unit}s with data to know the usual range.` }
    const range = `${formatMetric(usual.low, watch, places)}–${formatMetric(usual.high, watch, places)}`
    const side = value < usual.low ? 'Below' : value > usual.high ? 'Above' : null
    if (!side) return { alert: false, reason: `Within the usual ${range} of the eight ${unit}s before.` }
    // Only the bad side alerts: ROAS above its range is good news, cost above its range is not.
    const alert = (side === 'Below') === ((watch.rise ?? 'good') === 'good')
    return { alert, reason: `${side} the usual ${range} of the eight ${unit}s before${alert ? '' : ', which is good news'}.` }
  }
  if (!previousValue) return { alert: false, reason: `No ${unit} before to compare with.` }
  const change = (value / previousValue - 1) * 100
  const { percent: limit, direction } = watch.rule
  const alert =
    (direction !== 'up' && change <= -limit) || (direction !== 'down' && change >= limit)
  const moved = `${change < 0 ? 'Fell' : 'Rose'} ${Math.abs(Math.round(change))}%`
  return { alert, reason: alert ? `${moved}, past the ${limit}% the rule allows.` : `${moved}, within ${limit}%.` }
}

/** Below this, a change is everyday noise, and naming what drove it would be guessing. */
const EXPLAINED_CHANGE = 5

/** The value of one dimension that moved the metric most its way, and its share of that move. */
export type Driver = { dimension: string; top: Segment; share: number; segments: number }

/**
 * The top value of each dimension, strongest first: a country-wide problem leads with the country.
 * None for a week without both values or with a change too small to explain.
 */
export function drivers(check: Pick<Check, 'value' | 'previousValue' | 'change' | 'breakdowns'>): Driver[] {
  if (check.value === null || check.previousValue === null) return []
  const whole = check.value - check.previousValue
  if (whole === 0 || Math.abs(check.change ?? 0) < EXPLAINED_CHANGE) return []
  return check.breakdowns
    .flatMap(({ dimension, segments }) => {
      const top = segments.find(segment => segment.contribution * whole > 0 && !segment.name.startsWith('Other ('))
      return top ? [{ dimension, top, share: shareOf(top, segments, whole) ?? 0, segments: segments.length }] : []
    })
    .sort((a, b) => b.share - a.share)
}

/**
 * The driver to name first. Among values that explain about as much as the strongest, the one from
 * the dimension with the most values: campaign Spring_Broad says more than channel facebook / paid.
 */
export function leadDriver(found: readonly Driver[]): Driver | null {
  const [strongest] = found
  if (!strongest) return null
  if (strongest.share < 50) return strongest
  return found
    .filter(driver => driver.share >= strongest.share - 10)
    .reduce((best, driver) => (driver.segments > best.segments ? driver : best))
}

/** `cost more than doubled`, `orders fell 47%`, `revenue barely moved`. */
function moved(column: string, change: number): string {
  if (Math.abs(change) < 10) return `${column} barely moved`
  if (change > 200) return `${column} more than tripled`
  if (change > 100) return `${column} more than doubled`
  return `${column} ${change > 0 ? 'rose' : 'fell'} ${Math.abs(change)}%`
}

/** What happened to a driver's columns: `cost more than doubled while revenue barely moved`. */
function whatMoved(watch: Watch, top: Segment): string | null {
  const sides: [string, number][] = []
  if (top.numeratorChange !== null) sides.push([watch.numerator, top.numeratorChange])
  if (watch.denominator && top.denominatorChange !== null) sides.push([watch.denominator, top.denominatorChange])
  if (sides.length === 0) return null
  sides.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
  if (sides.length === 1) return moved(...sides[0])
  const [[, big], [, small]] = sides
  const apart = Math.abs(small) < 10 || Math.sign(big) !== Math.sign(small)
  return `${moved(...sides[0])} ${apart ? 'while' : 'and'} ${moved(...sides[1])}`
}

/** A driver's columns as changes: `cost +80%, revenue +2%`. */
export function driverChanges(watch: Watch, top: Segment): string {
  return [
    watch.denominator && top.denominatorChange !== null ? `${watch.denominator} ${signedPercent(top.denominatorChange)}` : null,
    top.numeratorChange !== null ? `${watch.numerator} ${signedPercent(top.numeratorChange)}` : null,
  ]
    .filter(Boolean)
    .join(', ')
}

export type Explanation = { headline: string; points: string[] }

/** A week's change in words: a headline that names its driver, and what each dimension adds. */
export function explain(check: Check, watch: Watch): Explanation | null {
  const found = drivers(check)
  const lead = leadDriver(found)
  if (!lead || check.value === null || check.previousValue === null) return null
  const direction = check.value < check.previousValue ? 'drop' : 'rise'
  const places = placesFor(watch.denominator !== null, check.value ?? check.previousValue)
  const name = `${lead.dimension} ${lead.top.name}`
  const what = whatMoved(watch, lead.top)
  const headline =
    lead.share < 50
      ? `No single value explains the ${direction}; the largest part is ${name}, ${lead.share}%.`
      : what
        ? `In ${name}, ${what}.`
        : `${name} explains ${lead.share >= 95 ? 'the whole' : `${lead.share}% of the`} ${direction}.`
  const { previousValue, value } = lead.top
  const moved =
    previousValue === null || value === null
      ? ''
      : `${watch.name} ${formatMetric(previousValue, watch, places)} → ${formatMetric(value, watch, places)}`
  // A sum's own column is the watch itself: name its change once.
  const detail = watch.denominator
    ? [driverChanges(watch, lead.top), moved].filter(Boolean).join(', ')
    : moved && lead.top.numeratorChange !== null
      ? `${moved} (${signedPercent(lead.top.numeratorChange)})`
      : moved || driverChanges(watch, lead.top)
  const points = [
    ...(detail ? [`${name}: ${detail}.`] : []),
    ...found
      .filter(driver => driver.dimension !== lead.dimension)
      .map(driver =>
        driver.share >= 50
          ? `${driver.dimension} ${driver.top.name} explains ${driver.share >= 95 ? 'all' : `${driver.share}%`} of the ${direction}.`
          : `No single ${driver.dimension} stands out: the largest, ${driver.top.name}, explains ${driver.share}%.`,
      ),
  ]
  return { headline, points }
}

function describe(watch: Watch, check: Omit<Check, 'text'>, places: number | null): string {
  const range = periodLabel(granularityOf(watch), check.from, check.to)
  if (check.value === null) return `${watch.name}, ${range}: ${check.reason}`
  const { change } = check
  const value = formatMetric(check.value, watch, places)
  const moved =
    change === null
      ? `was ${value}`
      : change === 0
        ? `held at ${value}`
        : `${change < 0 ? 'fell' : 'rose'} ${Math.abs(change)}% to ${value}`
  const sentences = [
    `${watch.name}, ${range}: ${moved}${check.previousValue === null ? '' : ` (${formatMetric(check.previousValue, watch, places)} the ${granularityOf(watch)} before)`}.`,
  ]
  if (check.alert) sentences.push(check.reason)

  const found = drivers(check)
  if (found.length === 0) return sentences.join(' ')

  const named = ({ dimension, top, share }: Driver) => `${dimension} "${top.name}" (${share}%)`
  const strong = found.filter(driver => driver.share >= 50)
  sentences.push(
    strong.length > 0
      ? `Driven by ${strong.map(named).join(', ').replace(/, ([^,]*)$/, ' and $1')}.`
      : `No single value explains most of it; the largest is ${named(found[0])}.`,
  )
  const { top } = strong[0] ?? found[0]
  const sides = driverChanges(watch, top)
  if (sides) sentences.push(`In "${top.name}", ${sides}.`)
  return sentences.join(' ')
}

/** How a checked week reads now: `bad` alerts, `good` is outside the usual range on the good side. */
export type Verdict = { tone: 'bad' | 'good' | 'usual' | 'none'; label: string }

/**
 * Judged again from the saved week, because a watch's rise setting can change after its check.
 * A change rule keeps the check's own alert: its limit and direction re-check the history when edited.
 */
export function verdict(check: Pick<Check, 'value' | 'change' | 'usual' | 'alert'>, watch: Watch): Verdict {
  if (check.value === null) return { tone: 'none', label: 'No data' }
  if (watch.rule.kind === 'change') {
    if (!check.alert) return { tone: 'usual', label: 'As usual' }
    const change = check.change ?? 0
    return { tone: 'bad', label: `${change < 0 ? 'Down' : 'Up'} ${Math.abs(change)}% · limit ${watch.rule.percent}%` }
  }
  if (!check.usual) return { tone: 'none', label: 'Too little history' }
  const side = check.value < check.usual.low ? 'Below' : check.value > check.usual.high ? 'Above' : null
  if (!side) return { tone: 'usual', label: 'As usual' }
  const bad = (side === 'Below') === ((watch.rise ?? 'good') === 'good')
  return { tone: bad ? 'bad' : 'good', label: `${side} usual` }
}

/**
 * A value's percent of everything that moved the metric the way `whole` went, so the values that
 * pulled it one way add up to 100% even when others won some of it back. Null for a value that
 * pulled the other way or not at all.
 */
export function shareOf(
  segment: { contribution: number },
  segments: readonly { contribution: number }[],
  whole: number,
): number | null {
  if (segment.contribution * whole <= 0) return null
  const pull = segments.reduce((sum, other) => (other.contribution * whole > 0 ? sum + other.contribution : sum), 0)
  return Math.round((segment.contribution / pull) * 100)
}

export const signedPercent = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value)}%`

/** Checks the period before `asOf` from sums per day or per period: in total, and per value of each dimension. */
export function checkPeriod(
  watchId: string,
  watch: Watch,
  asOf: string,
  totals: SumRow[],
  byDimension: Record<string, SumRow[]>,
  checkedAt: string,
): Check {
  const granularity = granularityOf(watch)
  const ratio = watch.denominator !== null
  const weeks = Array.from({ length: BASELINE_PERIODS + 1 }, (_, i) => {
    const window = periodAt(granularity, asOf, BASELINE_PERIODS - i)
    const sums = sumBySegment(totals, window.from, window.to)
    // A period without rows has no value: zero would make an empty history look like a usual range.
    return { ...window, value: sums.size > 0 ? metric(total(sums.values()), ratio) : null }
  })
  const [current, previous] = [weeks[BASELINE_PERIODS], weeks[BASELINE_PERIODS - 1]]
  const usual = usualRange(
    weeks.slice(0, BASELINE_PERIODS).map(week => week.value),
    DEVIATIONS[watch.sensitivity ?? 'medium'],
  )
  const places = placesFor(ratio, current.value ?? previous.value)
  const change =
    current.value !== null && previous.value ? percent(current.value, previous.value) : null
  const check = {
    watchId,
    name: watch.name,
    granularity,
    asOf,
    from: current.from,
    to: current.to,
    value: current.value,
    previousValue: previous.value,
    change,
    usual,
    ...judge(watch, current.value, previous.value, usual, places),
    weeks,
    breakdowns: watch.dimensions.map(dimension => ({
      dimension,
      segments: breakdown(byDimension[dimension] ?? [], current, previous, ratio),
    })),
    checkedAt,
  }
  return { ...check, text: describe(watch, check, places) }
}

/** Decimal places for a check's values, as its text uses them. */
export const placesOf = (check: Pick<Check, 'value' | 'previousValue'>, watch: Watch) =>
  placesFor(watch.denominator !== null, check.value ?? check.previousValue)

/** Where the week stands against its rule: `Below the usual $17,624–$24,788`, `Down 23% · limit 15%`. */
export function standing(check: Check, watch: Watch): string {
  const result = verdict(check, watch)
  if (result.tone === 'none') return check.reason
  if (watch.rule.kind === 'change') {
    return result.tone === 'bad' ? result.label : `Within ${watch.rule.percent}% of the ${granularityOf(watch)} before`
  }
  const places = placesOf(check, watch)
  const range = `${formatMetric(check.usual!.low, watch, places)}–${formatMetric(check.usual!.high, watch, places)}`
  if (result.tone === 'usual') return `Within the usual ${range}`
  return `${result.label === 'Below usual' ? 'Below' : 'Above'} the usual ${range}`
}

/** Explains which of the watched columns a Data Mart lacks. */
export function missingColumnsMessage(title: string, missing: readonly string[]): string {
  const quoted = missing.map(column => `"${column}"`)
  const list = quoted.length > 1 ? `${quoted.slice(0, -1).join(', ')} or ${quoted.at(-1)}` : quoted[0]
  return `${title} has no ${list} column any more. Fix the Data Mart, or edit the watch to use other columns.`
}

/** What makes a watch's saved checks wrong when it changes, so saving it checks them again. */
export const analysisKey = (watch: Watch) =>
  JSON.stringify([
    watch.dataMartId,
    watch.dateColumn,
    watch.numerator,
    watch.denominator,
    [...watch.dimensions].sort(),
    watch.rule,
    watch.sensitivity ?? 'medium',
    granularityOf(watch),
  ])
