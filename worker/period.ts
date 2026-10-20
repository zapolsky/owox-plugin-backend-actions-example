/** How long a checked period is: a watch's choice, `week` for a watch saved before periods. */
export type Granularity = 'day' | 'week' | 'month' | 'quarter'

export const granularityOf = (item: { granularity?: Granularity } | null | undefined): Granularity =>
  item?.granularity ?? 'week'

/** The periods before the checked one that set its usual range. */
export const BASELINE_PERIODS = 8

/** Periods the first check of a new or re-checked watch covers; older quarters rarely have data. */
export const FIRST_CHECK: Record<Granularity, number> = { day: 14, week: 12, month: 12, quarter: 4 }

export const ADVERB: Record<Granularity, string> = { day: 'Daily', week: 'Weekly', month: 'Monthly', quarter: 'Quarterly' }

/** When a period's schedule runs, at 09:00 in the member's time zone, and how the page says it. */
export const SCHEDULES: Record<Granularity, { cron: string; when: string }> = {
  day: { cron: '0 9 * * *', when: 'Every day at 09:00' },
  week: { cron: '0 9 * * 1', when: 'Every Monday at 09:00' },
  month: { cron: '0 9 1 * *', when: 'On the 1st of each month at 09:00' },
  quarter: { cron: '0 9 1 1,4,7,10 *', when: 'On the 1st of Jan, Apr, Jul and Oct at 09:00' },
}

/** `1 month`, `12 months`. */
export const count = (n: number, granularity: Granularity) => `${n} ${granularity}${n === 1 ? '' : 's'}`

const DAY_MS = 86_400_000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_IN = { month: 1, quarter: 3 } as const

const dateOf = (day: string) => new Date(`${day}T00:00:00Z`)
const dayOf = (date: Date) => date.toISOString().slice(0, 10)

export const shiftDay = (day: string, days: number) => dayOf(new Date(dateOf(day).getTime() + days * DAY_MS))

/** `day` moved by whole months: exact for the 1st of a month, which is every month or quarter `asOf`. */
function shiftMonth(day: string, months: number): string {
  const date = dateOf(day)
  date.setUTCMonth(date.getUTCMonth() + months)
  return dayOf(date)
}

/** The `asOf` of a run on `today`: the first day after the period it checks. */
export function asOfFor(granularity: Granularity, today: string): string {
  if (granularity === 'day' || granularity === 'week') return today
  const date = dateOf(today)
  const month = date.getUTCMonth() - (granularity === 'quarter' ? date.getUTCMonth() % 3 : 0)
  return dayOf(new Date(Date.UTC(date.getUTCFullYear(), month, 1)))
}

/** `asOf` moved by `n` periods. */
export function shiftPeriod(granularity: Granularity, asOf: string, n: number): string {
  if (granularity === 'day') return shiftDay(asOf, n)
  if (granularity === 'week') return shiftDay(asOf, 7 * n)
  return shiftMonth(asOf, MONTHS_IN[granularity] * n)
}

/** Period `k` before `asOf`: period 0 ends the day before `asOf`. */
export const periodAt = (granularity: Granularity, asOf: string, k: number) => ({
  from: shiftPeriod(granularity, asOf, -(k + 1)),
  to: shiftDay(shiftPeriod(granularity, asOf, -k), -1),
})

/** The first day that `checks` checks back from `asOf` read, with their usual ranges. */
export const firstDayFor = (granularity: Granularity, asOf: string, checks: number) =>
  periodAt(granularity, asOf, checks - 1 + BASELINE_PERIODS).from

/** `8–14 Oct 2026`, or `26 Sep – 2 Oct 2026` across months. */
export function formatRange(from: string, to: string): string {
  const [start, end] = [dateOf(from), dateOf(to)]
  const day = (date: Date) => `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`
  if (start.getUTCMonth() === end.getUTCMonth() && start.getUTCFullYear() === end.getUTCFullYear()) {
    return `${start.getUTCDate()}–${day(end)} ${end.getUTCFullYear()}`
  }
  return `${day(start)} – ${day(end)} ${end.getUTCFullYear()}`
}

/** `19 Oct 2026`, `13–19 Oct 2026`, `Sep 2026`, `Q3 2026`. */
export function periodLabel(granularity: Granularity, from: string, to: string): string {
  if (granularity === 'week') return formatRange(from, to)
  return `${shortLabel(granularity, from)} ${dateOf(from).getUTCFullYear()}`
}

/** A period on a chart or a strip: `19 Oct`, `Sep`, `Q3`. */
export function shortLabel(granularity: Granularity, from: string): string {
  const start = dateOf(from)
  if (granularity === 'month') return MONTHS[start.getUTCMonth()]
  if (granularity === 'quarter') return `Q${Math.floor(start.getUTCMonth() / 3) + 1}`
  return `${start.getUTCDate()} ${MONTHS[start.getUTCMonth()]}`
}

/** A watch's schedule as the host keeps it. */
export function scheduleFor(watch: { name: string; granularity?: Granularity }) {
  const granularity = granularityOf(watch)
  return { cron: SCHEDULES[granularity].cron, name: `${ADVERB[granularity]} check of ${watch.name}`.slice(0, 200) }
}

/** Today in `timeZone`; in UTC without one, or for a zone this runtime does not know. */
export function today(timeZone?: string, now = new Date()): string {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
      const part = (type: string) => parts.find(item => item.type === type)?.value
      return `${part('year')}-${part('month')}-${part('day')}`
    } catch {
      // An unknown zone checks by UTC, as a run without one does.
    }
  }
  return dayOf(now)
}
