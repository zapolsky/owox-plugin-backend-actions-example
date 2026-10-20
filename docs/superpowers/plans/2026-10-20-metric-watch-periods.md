# Metric Watch Periods and Scheduled Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A watch checks its metric by day, week, month or quarter; its schedule follows the period
and can add each new check to a Google Doc or Sheet.

**Architecture:** A new pure module `worker/period.ts` owns every period rule: windows, `asOf`,
labels, words, schedules and the run's day in a time zone. `worker/watch.ts` keeps the analysis and
asks `period.ts` for windows and words. `worker/index.ts` reads month and quarter sums through
HTTP Data `dateTrunc`, and after a scheduled check adds it to a Doc or Sheet with the same code as
the export actions. The page picks the period in the watch form and names it everywhere it now
says "week".

**Tech Stack:** TypeScript 6 (`erasableSyntaxOnly`), React 19, Vite 8, Cloudflare Worker,
`@owox/plugin-sdk` 0.38.0 (vendored), `@googleapis/docs`, `@googleapis/sheets`, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-20-metric-watch-periods-design.md`

## Global Constraints

- Repository: `~/projects/owox/owox-plugin-backend-actions-example`, branch `main`, as its history
  does. Commit locally; never push, tag or deploy. Task 8 asks Yevhen for those.
- Stage explicit paths only. Never stage `worker/stand-callback.ts`: it is uncommitted on purpose.
- Commits: lowercase Conventional Commits as in `git log` (`feat: …`, `fix: …`, `docs: …`), in
  English, with no trailers, no Co-Authored-By and no "Generated with" line.
- Commands, from the repository root: `npm test` (`node --test worker/*.test.ts`), `npm run build`
  (`tsc -b && vite build`), `npm run lint` (oxlint). All three pass at the end of every task.
- `npm test` runs TypeScript by type stripping: a module a test imports, directly or through
  another module, imports its neighbours with the `.ts` extension (`from './period.ts'`).
  `worker/index.ts` and `src/` import without extensions, as they do now.
- `erasableSyntaxOnly`: no `enum`, no namespaces, no constructor parameter properties.
- No new dependencies.
- Stored data keeps its shape: a check's id is `<watchId>~<asOf>`, its periods stay in the field
  `weeks`, and a watch or check without `granularity` is a week.
- Copy is English and exact as written in the tasks. Periods: `day`, `week`, `month`, `quarter`;
  adverbs `Daily`, `Weekly`, `Monthly`, `Quarterly`.
- Never log the `x-owox-execution-token` header, a credential or an action's input.

## Review Focus

1. A watch saved before periods (no `granularity`) reads, checks and schedules as a week, and
   opening its edit form and saving it unchanged does not re-check it. Pinned in Task 2
   (`a watch saved before periods checks a week`) and Task 6 (`analysisKey`).
2. A schedule at 09:00 on the 1st in a zone far ahead of UTC (Australia/Sydney) checks the month
   that just ended in that zone, not the month before it. Pinned in Task 1 (`today`).
3. Month and quarter boundaries: a January run checks December of the year before, a Q1 run checks
   Q4 of the year before, February has 28 or 29 days. Pinned in Task 1.
4. A pasted export link with spaces, another host or another Google app never reaches a
   schedule's parameters, and a saved target shows back as a link that parses to the same id.
   Pinned in Task 4 (`exportLink`).
5. A Google error of any length gives a run message of at most 1000 characters that still says
   what was saved. Pinned in Task 4 (`exportFailure`).

---

### Task 1: Period rules in `worker/period.ts`

**Files:**
- Create: `worker/period.ts`
- Test: `worker/period.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (all exported from `worker/period.ts`):
  - `type Granularity = 'day' | 'week' | 'month' | 'quarter'`
  - `granularityOf(item: { granularity?: Granularity } | null | undefined): Granularity`
  - `BASELINE_PERIODS: number` (8)
  - `FIRST_CHECK: Record<Granularity, number>`
  - `ADVERB: Record<Granularity, string>`
  - `SCHEDULES: Record<Granularity, { cron: string; when: string }>`
  - `count(n: number, granularity: Granularity): string`
  - `shiftDay(day: string, days: number): string`
  - `asOfFor(granularity: Granularity, today: string): string`
  - `shiftPeriod(granularity: Granularity, asOf: string, n: number): string`
  - `periodAt(granularity: Granularity, asOf: string, k: number): { from: string; to: string }`
  - `firstDayFor(granularity: Granularity, asOf: string, checks: number): string`
  - `formatRange(from: string, to: string): string`
  - `periodLabel(granularity: Granularity, from: string, to: string): string`
  - `shortLabel(granularity: Granularity, from: string): string`
  - `scheduleFor(watch: { name: string; granularity?: Granularity }): { cron: string; name: string }`
  - `today(timeZone?: string, now?: Date): string`

`worker/watch.ts` keeps its own `shiftDay` and `formatRange` until Task 2 removes them.

- [ ] **Step 1: Write the failing test**

Create `worker/period.test.ts`:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  asOfFor,
  count,
  firstDayFor,
  granularityOf,
  periodAt,
  periodLabel,
  scheduleFor,
  shiftDay,
  shiftPeriod,
  shortLabel,
  today,
} from './period.ts'

test('weeks end the day before the check and step back seven days', () => {
  const asOf = '2026-10-15'
  assert.equal(asOfFor('week', asOf), asOf)
  assert.deepEqual(periodAt('week', asOf, 0), { from: '2026-10-08', to: '2026-10-14' })
  assert.deepEqual(periodAt('week', asOf, 1), { from: '2026-10-01', to: '2026-10-07' })
  // One check reads its week and the eight before it; twelve checks reach eleven weeks further.
  assert.equal(firstDayFor('week', asOf, 1), '2026-08-13')
  assert.equal(firstDayFor('week', asOf, 12), shiftDay('2026-08-13', -77))
  assert.equal(shiftPeriod('week', asOf, -1), '2026-10-08')
})

test('a day is yesterday, and the days before it step back one at a time', () => {
  assert.equal(asOfFor('day', '2026-10-20'), '2026-10-20')
  assert.deepEqual(periodAt('day', '2026-10-20', 0), { from: '2026-10-19', to: '2026-10-19' })
  assert.deepEqual(periodAt('day', '2026-10-20', 1), { from: '2026-10-18', to: '2026-10-18' })
  assert.equal(firstDayFor('day', '2026-10-20', 14), '2026-09-28')
  assert.equal(shiftPeriod('day', '2026-10-01', -1), '2026-09-30')
})

test('a month is the last full calendar month, across a year end and a leap February', () => {
  assert.equal(asOfFor('month', '2026-10-20'), '2026-10-01')
  assert.equal(asOfFor('month', '2026-10-01'), '2026-10-01')
  assert.deepEqual(periodAt('month', '2026-10-01', 0), { from: '2026-09-01', to: '2026-09-30' })
  assert.deepEqual(periodAt('month', '2026-10-01', 1), { from: '2026-08-01', to: '2026-08-31' })
  assert.deepEqual(periodAt('month', asOfFor('month', '2027-01-05'), 0), { from: '2026-12-01', to: '2026-12-31' })
  assert.deepEqual(periodAt('month', '2028-03-01', 0), { from: '2028-02-01', to: '2028-02-29' })
  assert.deepEqual(periodAt('month', '2027-03-01', 0), { from: '2027-02-01', to: '2027-02-28' })
  assert.equal(firstDayFor('month', '2026-10-01', 12), '2025-02-01')
})

test('a quarter is the last full calendar quarter', () => {
  assert.equal(asOfFor('quarter', '2026-10-20'), '2026-10-01')
  assert.equal(asOfFor('quarter', '2026-12-31'), '2026-10-01')
  assert.equal(asOfFor('quarter', '2027-02-10'), '2027-01-01')
  assert.deepEqual(periodAt('quarter', '2027-01-01', 0), { from: '2026-10-01', to: '2026-12-31' })
  assert.deepEqual(periodAt('quarter', '2027-01-01', 1), { from: '2026-07-01', to: '2026-09-30' })
  assert.equal(shiftPeriod('quarter', '2026-01-01', -1), '2025-10-01')
  assert.equal(firstDayFor('quarter', '2026-10-01', 4), '2023-10-01')
})

test('each period reads as a label and a short label', () => {
  assert.equal(periodLabel('day', '2026-10-19', '2026-10-19'), '19 Oct 2026')
  assert.equal(periodLabel('week', '2026-10-13', '2026-10-19'), '13–19 Oct 2026')
  assert.equal(periodLabel('week', '2026-09-26', '2026-10-02'), '26 Sep – 2 Oct 2026')
  assert.equal(periodLabel('month', '2026-09-01', '2026-09-30'), 'Sep 2026')
  assert.equal(periodLabel('quarter', '2026-07-01', '2026-09-30'), 'Q3 2026')
  assert.equal(shortLabel('day', '2026-10-19'), '19 Oct')
  assert.equal(shortLabel('week', '2026-10-13'), '13 Oct')
  assert.equal(shortLabel('month', '2026-09-01'), 'Sep')
  assert.equal(shortLabel('quarter', '2026-07-01'), 'Q3')
  assert.equal(count(1, 'month'), '1 month')
  assert.equal(count(12, 'month'), '12 months')
})

test('a watch saved before periods is a week, and its schedule stays the one it has', () => {
  assert.equal(granularityOf({}), 'week')
  assert.equal(granularityOf(undefined), 'week')
  assert.deepEqual(scheduleFor({ name: 'ROAS' }), { cron: '0 9 * * 1', name: 'Weekly check of ROAS' })
  assert.deepEqual(scheduleFor({ name: 'ROAS', granularity: 'day' }), { cron: '0 9 * * *', name: 'Daily check of ROAS' })
  assert.deepEqual(scheduleFor({ name: 'ROAS', granularity: 'month' }), { cron: '0 9 1 * *', name: 'Monthly check of ROAS' })
  assert.deepEqual(scheduleFor({ name: 'ROAS', granularity: 'quarter' }), { cron: '0 9 1 1,4,7,10 *', name: 'Quarterly check of ROAS' })
  assert.equal(scheduleFor({ name: 'x'.repeat(300) }).name.length, 200)
})

test("today is the member's date, so a run at 09:00 on the 1st in Sydney checks the month that just ended", () => {
  // 09:00 on 1 Oct in Sydney (UTC+10) is still 30 Sep in UTC.
  const now = new Date('2026-09-30T23:00:00Z')
  assert.equal(today('Australia/Sydney', now), '2026-10-01')
  assert.deepEqual(periodAt('month', asOfFor('month', today('Australia/Sydney', now)), 0), { from: '2026-09-01', to: '2026-09-30' })
  assert.equal(today(undefined, now), '2026-09-30')
  assert.equal(today('Not/AZone', now), '2026-09-30')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL with `Cannot find module` for `./period.ts`.

- [ ] **Step 3: Write the implementation**

Create `worker/period.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS, all suites.

- [ ] **Step 5: Build and lint**

Run: `npm run build && npm run lint`
Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add worker/period.ts worker/period.test.ts
git commit -m "feat: add day, week, month and quarter periods"
```

---

### Task 2: The analysis checks any period

**Files:**
- Modify: `worker/watch.ts`
- Modify: `worker/watch.test.ts`
- Modify: `worker/index.ts` (imports and the `check-metric` loop)
- Modify: `src/App.tsx`, `src/WatchPage.tsx`, `src/CheckView.tsx` (the `formatRange` import only)

**Interfaces:**
- Consumes from Task 1: `BASELINE_PERIODS`, `granularityOf`, `periodAt`, `periodLabel`,
  `asOfFor`, `firstDayFor`, `shiftDay`, `shiftPeriod`, `formatRange`, `type Granularity`.
- Produces:
  - `Watch.granularity?: Granularity`, `Check.granularity?: Granularity`
  - `checkPeriod(watchId: string, watch: Watch, asOf: string, totals: SumRow[], byDimension: Record<string, SumRow[]>, checkedAt: string): Check`, which replaces `checkWeek`.
  - `watch.ts` no longer exports `shiftDay`, `weekAt`, `firstDay`, `formatRange`, `BASELINE_WEEKS`; they live in `period.ts`.

- [ ] **Step 1: Point the existing tests at the new names**

In `worker/watch.test.ts`:
- From the import list of `./watch.ts`, remove `checkWeek`, `firstDay`, `shiftDay` and `weekAt`,
  and add `checkPeriod`.
- Add below it: `import { periodAt, shiftDay, shiftPeriod } from './period.ts'`
- Delete the test `weeks end the day before the check and step back seven days`; Task 1 moved it
  to `period.test.ts`.
- Replace every `weekAt(asOf, ` with `periodAt('week', asOf, ` and every `checkWeek(` with
  `checkPeriod(`.

Then append these tests:

```ts
test('a watch saved before periods checks a week', () => {
  const rows = days()
  const check = checkPeriod('w1', roas, asOf, totals(rows), { channel: rows }, '2026-10-15T06:00:00.000Z')
  assert.equal(check.granularity, 'week')
  assert.deepEqual([check.from, check.to], ['2026-10-08', '2026-10-14'])
  assert.match(check.text, /the week before/)
})

test('a day watch compares a day with the day before and the eight days before it', () => {
  const watch: Watch = { ...roas, granularity: 'day' }
  const rows: SumRow[] = Array.from({ length: 20 }, (_, i) => shiftDay('2026-10-20', -(i + 1))).map(day => ({
    day,
    segment: 'google / cpc',
    numerator: 300,
    denominator: day === '2026-10-19' ? 200 : 100,
  }))
  const check = checkPeriod('w1', watch, '2026-10-20', totals(rows), { channel: rows }, '2026-10-20T06:00:00.000Z')
  assert.equal(check.granularity, 'day')
  assert.deepEqual([check.from, check.to], ['2026-10-19', '2026-10-19'])
  assert.deepEqual([check.value, check.previousValue], [1.5, 3])
  assert.equal(check.reason, 'Below the usual 2.55–3.45 of the eight days before.')
  assert.match(check.text, /^ROAS, 19 Oct 2026: fell 50% to 1\.50 \(3\.00 the day before\)\./)
})

test('a month watch checks the last full month from month-truncated rows', () => {
  const watch: Watch = { ...roas, granularity: 'month' }
  // One row a month, as the Data Mart returns month-truncated sums: ROAS 3 until September halves it.
  const rows: SumRow[] = Array.from({ length: 10 }, (_, i) => shiftPeriod('month', '2026-10-01', -(i + 1))).map(day => ({
    day,
    segment: 'google / cpc',
    numerator: day === '2026-09-01' ? 1500 : 3000,
    denominator: 1000,
  }))
  const check = checkPeriod('w1', watch, '2026-10-01', totals(rows), { channel: rows }, '2026-10-01T06:00:00.000Z')
  assert.deepEqual([check.from, check.to], ['2026-09-01', '2026-09-30'])
  assert.deepEqual([check.value, check.previousValue, check.change], [1.5, 3, -50])
  assert.equal(check.reason, 'Below the usual 2.55–3.45 of the eight months before.')
  assert.match(check.text, /^ROAS, Sep 2026: fell 50% to 1\.50 \(3\.00 the month before\)\./)
  assert.equal(check.weeks.length, 9)
  assert.equal(check.weeks[0].from, '2026-01-01')
})

test('a period without rows names its period', () => {
  const check = checkPeriod('w1', { ...roas, granularity: 'quarter' }, '2026-10-01', [], { channel: [] }, '2026-10-01T06:00:00.000Z')
  assert.equal(check.value, null)
  assert.equal(check.reason, 'No cost this quarter, so ROAS is undefined.')
  assert.equal(check.text, 'ROAS, Q3 2026: No cost this quarter, so ROAS is undefined.')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL: `checkPeriod` is not exported by `./watch.ts`.

- [ ] **Step 3: Change `worker/watch.ts`**

1. Add at the top of the file:

```ts
import { BASELINE_PERIODS, granularityOf, periodAt, periodLabel, type Granularity } from './period.ts'
```

2. Delete `DAY_MS`, `MONTHS`, `BASELINE_WEEKS`, `shiftDay`, `weekAt`, `firstDay` and
   `formatRange`, with their doc comments.

3. In `type Watch`, after `sensitivity`, add:

```ts
  /** How long a checked period is; `week` when unset, as for watches saved before periods. */
  granularity?: Granularity
```

4. Above `export type Week`, add the comment `/** A checked period; named for the weekly first version. */`.

5. In `type Check`, after `name: string`, add:

```ts
  /** The watch's period when it was checked; a week when unset. */
  granularity?: Granularity
```

   and replace these doc comments:
   - on `asOf`: `/** The first day after the checked period. */`
   - on `change`: `/** Whole percent against the period before. */`
   - on `usual`: `/** Median ± robust deviations of the eight periods before. */`
   - on `weeks`: `/** The checked period and the eight before it, oldest first; named for the weekly first version. */`
   - on `trigger`: `/** What started the check: the page, or the watch's schedule. */`

6. In `judge`, add `const unit = granularityOf(watch)` as its first line and replace its strings:

| Before | After |
| --- | --- |
| `` `No ${watch.denominator} this week, so ${watch.name} is undefined.` `` | `` `No ${watch.denominator} this ${unit}, so ${watch.name} is undefined.` `` |
| `'No data this week.'` | `` `No data this ${unit}.` `` |
| `'Needs four earlier weeks with data to know the usual range.'` | `` `Needs four earlier ${unit}s with data to know the usual range.` `` |
| `` `Within the usual ${range} of the eight weeks before.` `` | `` `Within the usual ${range} of the eight ${unit}s before.` `` |
| `` `${side} the usual ${range} of the eight weeks before${alert ? '' : ', which is good news'}.` `` | `` `${side} the usual ${range} of the eight ${unit}s before${alert ? '' : ', which is good news'}.` `` |
| `'No week before to compare with.'` | `` `No ${unit} before to compare with.` `` |

7. In `describe`, replace `const range = formatRange(check.from, check.to)` with
   `const range = periodLabel(granularityOf(watch), check.from, check.to)`, and
   `` ` (${formatMetric(check.previousValue, watch, places)} the week before)` `` with
   `` ` (${formatMetric(check.previousValue, watch, places)} the ${granularityOf(watch)} before)` ``.

8. In `standing`, replace `` `Within ${watch.rule.percent}% of the week before` `` with
   `` `Within ${watch.rule.percent}% of the ${granularityOf(watch)} before` ``.

9. Replace the comment above `EXPLAINED_CHANGE` with
   `/** Below this, a change is everyday noise, and naming what drove it would be guessing. */`.

10. Replace `checkWeek` with:

```ts
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
```

- [ ] **Step 4: Keep the Worker and the page compiling**

In `worker/index.ts`, replace the `./watch` import with:

```ts
import { asOfFor, firstDayFor, granularityOf, shiftDay, shiftPeriod } from './period'
import { checkPeriod, missingColumnsMessage, placesOf, type Check, type SumRow, type Watch } from './watch'
```

and in `check-metric` replace:

```ts
      const asOf = new Date().toISOString().slice(0, 10)
      const [from, to] = [firstDay(asOf, weeks), shiftDay(asOf, -1)]
```

with:

```ts
      const granularity = granularityOf(watch)
      const asOf = asOfFor(granularity, new Date().toISOString().slice(0, 10))
      const [from, to] = [firstDayFor(granularity, asOf, weeks), shiftDay(asOf, -1)]
```

and the loop:

```ts
      for (let week = 0; week < weeks; week++) {
        const check = checkWeek(watchId, watch, shiftDay(asOf, -7 * week), totals, byDimension, checkedAt)
```

with:

```ts
      for (let k = 0; k < weeks; k++) {
        const check = checkPeriod(watchId, watch, shiftPeriod(granularity, asOf, -k), totals, byDimension, checkedAt)
```

In `src/App.tsx`, `src/WatchPage.tsx` and `src/CheckView.tsx`, remove `formatRange` from the
`../worker/watch` import and add `import { formatRange } from '../worker/period'`.

- [ ] **Step 5: Run the tests, build and lint**

Run: `npm test && npm run build && npm run lint`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add worker/watch.ts worker/watch.test.ts worker/index.ts src/App.tsx src/WatchPage.tsx src/CheckView.tsx
git commit -m "feat: check a watch by its period"
```

---

### Task 3: Charts label their periods

**Files:**
- Modify: `worker/chart.ts`
- Modify: `worker/chart.test.ts`
- Modify: `worker/index.ts` (`CHART_WEEKS`, `chartOfCheck`)
- Modify: `src/WatchPage.tsx` (`CHART_WEEKS`), `src/CheckView.tsx` (`shortDay`)

**Interfaces:**
- Consumes from Task 1: `granularityOf`, `shortLabel`, `type Granularity`.
- Produces: `CHART_PERIODS` (replaces `CHART_WEEKS`, still 12); `ChartData.granularity?: Granularity`;
  `shortDay` is removed in favour of `shortLabel`.

- [ ] **Step 1: Write the failing test**

Append to `worker/chart.test.ts`:

```ts
test('a month chart labels its months and its link keeps the period', async () => {
  const months = weeks.map((week, i) => ({ ...week, from: `2026-${String(i + 1).padStart(2, '0')}-01` }))
  const monthly: ChartData = { ...data, weeks: months, granularity: 'month' }
  const svg = chartSvg(monthly)!
  // Every other label, ending on the newest month.
  assert.match(svg, />Dec</)
  assert.match(svg, />Oct</)
  assert.doesNotMatch(svg, />Nov</)
  const read = await chartOf(new URL(await chartLink('https://plugin.example', monthly, 'secret', now)), 'secret', now)
  assert.equal(read?.granularity, 'month')
  const weekly = await chartOf(new URL(await chartLink('https://plugin.example', data, 'secret', now)), 'secret', now)
  assert.equal(weekly?.granularity, undefined)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL: the month chart has no `>Dec<` (it draws `1 Dec`).

- [ ] **Step 3: Change `worker/chart.ts`**

1. Change the import to:

```ts
import { granularityOf, shortLabel, type Granularity } from './period.ts'
import { formatMetric, verdict, type Check, type Format, type Verdict, type Watch } from './watch.ts'
```

2. Replace `/** Weeks a chart shows, on the page and in a Doc. */ export const CHART_WEEKS = 12` with:

```ts
/** Periods a chart shows, on the page and in a Doc. */
export const CHART_PERIODS = 12
```

3. In `type ChartData`, after `places`, add:

```ts
  /** Labels the periods; a week when unset. */
  granularity?: Granularity
```

4. Delete `MONTHS` and `shortDay` (with its comment).

5. In `chartSvg`, replace `${shortDay(week.from)}` with `${shortLabel(granularityOf(data), week.from)}`.

6. In `chartLink`, replace
   `JSON.stringify([data.format ?? null, data.places, data.selected, weeks])` with
   `JSON.stringify([data.format ?? null, data.places, data.selected, weeks, data.granularity ?? null])`.

7. In `chartOf`, replace `const [format, places, selected, weeks] = JSON.parse(...)` with
   `const [format, places, selected, weeks, granularity] = JSON.parse(...)` (the same argument), and
   add `granularity: granularity ?? undefined,` after `places,` in the returned object.

- [ ] **Step 4: Update the users of the chart**

In `worker/index.ts`: import `CHART_PERIODS` instead of `CHART_WEEKS` and use it in
`chartOfCheck`; in the object `chartOfCheck` returns, add `granularity: granularityOf(watch),`
after `format: watch.format,` (`granularityOf` is imported since Task 2).

In `src/WatchPage.tsx`: import `CHART_PERIODS` instead of `CHART_WEEKS` and use it in
`history.slice(0, CHART_PERIODS)`. Replace the stray comment `/** Weeks the chart and the strip
show, the newest last. */` (it sits above `formula` and describes nothing) by deleting it.

In `src/CheckView.tsx`: import `shortLabel` and `granularityOf` from `'../worker/period'` instead of
`shortDay` from `'../worker/chart'`, and replace each `shortDay(check.from)` (three places) with
`shortLabel(granularityOf(watch), check.from)`.

- [ ] **Step 5: Run the tests, build and lint**

Run: `npm test && npm run build && npm run lint`
Expected: all pass, including the existing `>21 Jul<` assertion.

- [ ] **Step 6: Commit**

```bash
git add worker/chart.ts worker/chart.test.ts worker/index.ts src/WatchPage.tsx src/CheckView.tsx
git commit -m "feat: label a chart's days, months and quarters"
```

---

### Task 4: Export targets, links and failures

**Files:**
- Modify: `worker/google.ts`
- Modify: `worker/google.test.ts`
- Modify: `worker/index.ts` (`linkOf`)

**Interfaces:**
- Consumes: nothing new.
- Produces (from `worker/google.ts`):
  - `periodLink(owox: string, projectId: string, pluginId: string, check: Pick<Check, 'watchId' | 'asOf'>): string`, replacing `weekLink`.
  - `type ExportTo = { kind: 'Doc'; documentId: string } | { kind: 'Sheet'; spreadsheetId: string }`
  - `exportToOf(input: { documentId?: string; spreadsheetId?: string }): ExportTo | null`, throwing an `Error` with `code: 'INVALID_EXPORT'` for both.
  - `exportLink(parameters: unknown): string`, `''` for no target.
  - `exportFailure(label: string, kind: 'Doc' | 'Sheet', error: unknown): { code: string; message: string }`

- [ ] **Step 1: Write the failing tests**

In `worker/google.test.ts`, change the import to:

```ts
import { docRequests, exportFailure, exportLink, exportTarget, exportToOf, LINK_TEXT, periodLink, sheetCells, sheetRow } from './google.ts'
```

Replace the test `a week links to the plugin page that shows it` with:

```ts
test('a period links to the plugin page that shows it', () => {
  assert.equal(
    periodLink('https://app.owox.com', 'p1', 'plug 1', { watchId: 'w/1', asOf: '2026-10-15' }),
    'https://app.owox.com/ui/p1/plugins/plug%201/open/watches/w%2F1/periods/2026-10-15',
  )
})
```

Append:

```ts
test("a schedule's export target shows back as a link that exports to the same place", () => {
  assert.equal(exportLink({ watchId: 'w1' }), '')
  assert.equal(exportLink(null), '')
  assert.equal(exportLink({ watchId: 'w1', documentId: 7 }), '')
  assert.deepEqual(exportTarget(exportLink({ watchId: 'w1', documentId: 'abc_D-1' }))?.input, { documentId: 'abc_D-1' })
  assert.deepEqual(exportTarget(exportLink({ watchId: 'w1', spreadsheetId: 'xyz-2' }))?.input, { spreadsheetId: 'xyz-2' })
})

test('a check goes to a Doc or a Sheet, never both', () => {
  assert.equal(exportToOf({}), null)
  assert.deepEqual(exportToOf({ documentId: 'd1' }), { kind: 'Doc', documentId: 'd1' })
  assert.deepEqual(exportToOf({ spreadsheetId: 's1' }), { kind: 'Sheet', spreadsheetId: 's1' })
  assert.throws(() => exportToOf({ documentId: 'd1', spreadsheetId: 's1' }), { code: 'INVALID_EXPORT' })
})

test('a failed export says what was saved, keeps a missing credential its own code and fits the host', () => {
  const missing = Object.assign(new Error('Choose a Google Service Account Credential.'), { code: 'GOOGLE_NOT_CONFIGURED' })
  assert.deepEqual(exportFailure('Sep 2026', 'Doc', missing), {
    code: 'GOOGLE_NOT_CONFIGURED',
    message: 'Checked Sep 2026, but could not add it to the Doc: Choose a Google Service Account Credential.',
  })
  const long = exportFailure('Q3 2026', 'Sheet', new Error('x'.repeat(5000)))
  assert.equal(long.code, 'EXPORT_FAILED')
  assert.equal(long.message.length, 1000)
  assert.ok(long.message.startsWith('Checked Q3 2026, but could not add it to the Sheet: x'))
  assert.equal(exportFailure('19 Oct 2026', 'Doc', 'refused').message, 'Checked 19 Oct 2026, but could not add it to the Doc: refused')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL: `periodLink`, `exportLink`, `exportToOf` and `exportFailure` are not exported.

- [ ] **Step 3: Change `worker/google.ts`**

Replace `weekLink` and its comment with:

```ts
/** The plugin's page of a checked period in OWOX, as the host links to the plugin's routes. */
export const periodLink = (owox: string, projectId: string, pluginId: string, check: Pick<Check, 'watchId' | 'asOf'>) =>
  `${owox}/ui/${encodeURIComponent(projectId)}/plugins/${encodeURIComponent(pluginId)}/open/watches/${encodeURIComponent(check.watchId)}/periods/${check.asOf}`
```

Replace the comment of `docSection` with
`/** A check as a paragraph appended at the end of a Doc; its text starts with the metric and the period. */`
and the word `week` in the comments of `docRequests` and `sheetCells` with `period`.

Append:

```ts
/** Where a schedule adds each check. */
export type ExportTo = { kind: 'Doc'; documentId: string } | { kind: 'Sheet'; spreadsheetId: string }

/** The export target in `check-metric`'s input; both at once is a mistake to report, not to guess. */
export function exportToOf(input: { documentId?: string; spreadsheetId?: string }): ExportTo | null {
  if (input.documentId && input.spreadsheetId) {
    throw Object.assign(new Error('Add each check to a Doc or to a Sheet, not both.'), { code: 'INVALID_EXPORT' })
  }
  if (input.documentId) return { kind: 'Doc', documentId: input.documentId }
  if (input.spreadsheetId) return { kind: 'Sheet', spreadsheetId: input.spreadsheetId }
  return null
}

/** The link of a schedule's export target, as the member pasted it; empty for none. */
export function exportLink(parameters: unknown): string {
  const { documentId, spreadsheetId } = (parameters ?? {}) as { documentId?: unknown; spreadsheetId?: unknown }
  if (typeof documentId === 'string') return `https://docs.google.com/document/d/${documentId}/edit`
  if (typeof spreadsheetId === 'string') return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
  return ''
}

/** A run's error after its check was saved but not exported; the host keeps 1000 characters. */
export function exportFailure(label: string, kind: 'Doc' | 'Sheet', error: unknown): { code: string; message: string } {
  const code = (error as { code?: unknown } | null)?.code === 'GOOGLE_NOT_CONFIGURED' ? 'GOOGLE_NOT_CONFIGURED' : 'EXPORT_FAILED'
  const reason = error instanceof Error ? error.message : String(error)
  return { code, message: `Checked ${label}, but could not add it to the ${kind}: ${reason}`.slice(0, 1000) }
}
```

- [ ] **Step 4: Update the Worker**

In `worker/index.ts`, import `periodLink` instead of `weekLink` and use it in `linkOf`; change
`linkOf`'s comment to `/** A link to a check's period on the plugin's page in OWOX. */`.

- [ ] **Step 5: Run the tests, build and lint**

Run: `npm test && npm run build && npm run lint`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add worker/google.ts worker/google.test.ts worker/index.ts
git commit -m "feat: add export targets for schedules and link checks by period"
```

---

### Task 5: `check-metric` reads periods, takes a time zone and exports

**Files:**
- Modify: `worker/index.ts`
- Modify: `plugin.json`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: Task 1 `asOfFor`, `firstDayFor`, `granularityOf`, `periodLabel`, `shiftDay`,
  `shiftPeriod`, `today`, `type Granularity`; Task 2 `checkPeriod`; Task 4 `exportToOf`,
  `exportFailure`.
- Produces: `check-metric` input `{ watchId, periods?, weeks?, timeZone?, documentId?, spreadsheetId? }`
  in `plugin.json`; result `{ checked: number }` as now; errors `INVALID_EXPORT`, `EXPORT_FAILED`,
  `GOOGLE_NOT_CONFIGURED`.

`worker/index.ts` needs a plugin context, so it has no unit tests; its pure parts are tested in
Tasks 1, 2 and 4, and Task 8 runs it on the stand.

- [ ] **Step 1: Read sums per month or quarter**

Replace `readSums` and its doc comment with:

```ts
/**
 * Sums of the watched columns between two days, per day for a day or week watch and per month or
 * quarter for those, per combination of the watch's dimensions, in one Data Mart run: totals and
 * each dimension's split are summed from the same rows. A truncated date keeps its column's name,
 * so each row's `day` is its period's first day.
 * ponytail: rows grow with the product of the dimensions' values (periods × channels × campaigns × …);
 * fine for tens of thousands, switch back to one run per dimension for high-cardinality columns.
 */
async function readSums(ctx: BackendActionContext, watch: Watch, from: string, to: string, granularity: Granularity) {
  const summed = [watch.numerator, ...(watch.denominator ? [watch.denominator] : [])]
  const unit = granularity === 'month' ? 'MONTH' : granularity === 'quarter' ? 'QUARTER' : null
  const data = await ctx.owox.dataMarts.traverseData(watch.dataMartId, {
    column: [watch.dateColumn, ...watch.dimensions, ...summed],
    aggregation: summed.map(column => ({ column, function: 'SUM' as const })),
    ...(unit ? { dateTrunc: [{ column: watch.dateColumn, unit }] } : {}),
    filter: [{ column: watch.dateColumn, operator: 'between', value: { from, to } }],
  })
```

The rest of the body stays as it is.

- [ ] **Step 2: Share the export code between the actions and a schedule**

Above `const backend = (charts: Charts) => createBackend({`, add:

```ts
/**
 * Appends a check at the end of a Google Doc shared with the service account: its text, its chart
 * and a link back to the period. Docs fetches the chart from this Worker while the request runs.
 */
async function addToDoc(ctx: BackendActionContext, charts: Charts, check: Check, documentId: string) {
  const watch = (await ctx.collections<Watch>('watches').get(check.watchId))?.document
  const docs = new docs_v1.Docs(googleOptions(ctx))
  const chart = watch && charts.key ? await chartLink(charts.worker, await chartOfCheck(ctx, check, watch), charts.key) : null
  const { data } = await docs.documents.get({ documentId, fields: 'body(content(endIndex))' })
  const end = data.body?.content?.at(-1)?.endIndex ?? 1
  await docs.documents.batchUpdate({
    documentId,
    requestBody: { requests: docRequests(end - 1, check, chart, linkOf(ctx, check)) },
  })
}

/** Appends a check as one row of the first sheet of a Google Sheet shared with the service account. */
async function addToSheet(ctx: BackendActionContext, check: Check, spreadsheetId: string) {
  // The watch sets the value's decimal places and what the period means now.
  const watch = await ctx.collections<Watch>('watches').get(check.watchId)
  const sheets = new sheets_v4.Sheets(googleOptions(ctx))
  const { data } = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets(properties(sheetId))' })
  // Cells rather than values: only a cell can show a link under its own words.
  const row = sheetCells(sheetRow(check, watch?.document), linkOf(ctx, check))
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ appendCells: { sheetId: data.sheets?.[0]?.properties?.sheetId ?? 0, rows: [{ values: row }], fields: 'userEnteredValue,textFormatRuns' } }],
    },
  })
}
```

Replace the two export actions with:

```ts
    /** Appends a check at the end of a Google Doc shared with the service account. */
    'export-check-to-doc': async (input, ctx) => {
      const { checkId, documentId } = input as { checkId: string; documentId: string }
      await addToDoc(ctx, charts, await savedCheck(ctx, checkId), documentId)
      return { documentId }
    },

    /** Appends a check as one row of the first sheet of a Google Sheet shared with the service account. */
    'export-check-to-sheet': async (input, ctx) => {
      const { checkId, spreadsheetId } = input as { checkId: string; spreadsheetId: string }
      await addToSheet(ctx, await savedCheck(ctx, checkId), spreadsheetId)
      return { spreadsheetId }
    },
```

- [ ] **Step 3: Rewrite `check-metric`**

Replace the `check-metric` action with:

```ts
    /**
     * Checks the watch's last full period, and with `periods` the ones before it too, into the
     * `checks` history; with a Doc or Sheet, adds the newest check there.
     */
    'check-metric': async (input, ctx) => {
      const { watchId, periods, weeks, timeZone, ...target } = input as {
        watchId: string
        periods?: number
        /** The old name of `periods`, sent by a page opened before periods. */
        weeks?: number
        timeZone?: string
        documentId?: string
        spreadsheetId?: string
      }
      const exportTo = exportToOf(target)
      const count = periods ?? weeks ?? 1
      const saved = await ctx.collections<Watch>('watches').get(watchId)
      if (!saved) throw failure('WATCH_NOT_FOUND', 'This watch no longer exists.')
      const watch = saved.document
      const dataMart = (await ctx.owox.dataMarts.list()).find(item => item.id === watch.dataMartId)
      if (!dataMart) throw failure('DATA_MART_NOT_FOUND', 'This Data Mart is not available to you.')

      const granularity = granularityOf(watch)
      const asOf = asOfFor(granularity, today(timeZone))
      const [from, to] = [firstDayFor(granularity, asOf, count), shiftDay(asOf, -1)]
      let sums: Awaited<ReturnType<typeof readSums>>
      try {
        sums = await readSums(ctx, watch, from, to, granularity)
      } catch (error) {
        if (ctx.signal.aborted) throw error
        const missing = await missingColumns(ctx, watch).catch(() => [])
        if (missing.length === 0) throw error
        throw failure('MISSING_COLUMNS', missingColumnsMessage(dataMart.title, missing))
      }
      const { totals, byDimension } = sums
      if (totals.length === 0) {
        throw failure('NO_DATA', `${dataMart.title} has no rows between ${from} and ${to}.`)
      }

      // Saved by the Worker, so a check started before the plugin closed is there when it reopens.
      const checkedAt = new Date().toISOString()
      const history = ctx.collections<Check>('checks')
      let newest: Check | null = null
      for (let k = 0; k < count; k++) {
        const check = { ...checkPeriod(watchId, watch, shiftPeriod(granularity, asOf, -k), totals, byDimension, checkedAt), trigger: ctx.execution.trigger }
        await history.put(`${watchId}~${check.asOf}`, check)
        newest ??= check
      }

      // After saving, so a failed export loses no check; the run fails so that the member sees it.
      if (exportTo && newest) {
        try {
          if (exportTo.kind === 'Doc') await addToDoc(ctx, charts, newest, exportTo.documentId)
          else await addToSheet(ctx, newest, exportTo.spreadsheetId)
        } catch (error) {
          if (ctx.signal.aborted) throw error
          const { code, message } = exportFailure(periodLabel(granularity, newest.from, newest.to), exportTo.kind, error)
          throw failure(code, message)
        }
      }
      return { checked: count }
    },
```

Set the imports of `worker/index.ts` to:

```ts
import { CHART_PATH, CHART_PERIODS, chartLink, chartOf, chartSvg, chartWeeks, type ChartData } from './chart'
import { docRequests, exportFailure, exportToOf, periodLink, sheetCells, sheetRow } from './google'
import { png } from './png'
import { asOfFor, firstDayFor, granularityOf, periodLabel, shiftDay, shiftPeriod, today, type Granularity } from './period'
import { checkPeriod, missingColumnsMessage, placesOf, type Check, type SumRow, type Watch } from './watch'
```

(`docs_v1`, `sheets_v4` and the `@owox/plugin-sdk/server` import stay.)

- [ ] **Step 4: Change `plugin.json`**

Set `description` to:

```json
"description": "Watches a Data Mart metric by day, week, month or quarter, flags periods outside the usual range and explains which channels, campaigns or other values moved it",
```

Replace `check-metric`'s `input` with:

```json
        "input": {
          "type": "object",
          "required": ["watchId"],
          "properties": {
            "watchId": { "type": "string", "minLength": 1, "maxLength": 100 },
            "periods": { "type": "integer", "minimum": 1, "maximum": 14 },
            "weeks": { "type": "integer", "minimum": 1, "maximum": 12 },
            "timeZone": { "type": "string", "minLength": 1, "maxLength": 64 },
            "documentId": { "type": "string", "minLength": 1, "maxLength": 200 },
            "spreadsheetId": { "type": "string", "minLength": 1, "maxLength": 200 }
          },
          "additionalProperties": false
        }
```

- [ ] **Step 5: Change `AGENTS.md`**

Replace the first paragraph, from `This is an example OWOX Data Marts plugin` to
`at \`/chart.png\`.`, with:

```markdown
This is an example OWOX Data Marts plugin with backend actions: Metric Watch. A member picks a
Data Mart metric, such as ROAS as the sum of revenue divided by the sum of cost, the columns that
explain it, such as channel, campaign and country, its period (a day, a week, a month or a
quarter), how its value reads and whether a rise is good or bad. The page starts `check-metric`;
the Worker reads sums through HTTP Data, per day for a day or week watch and per month or quarter
through `dateTrunc` for those, compares the last full period with the eight before it, splits the
change between the values of each column and saves one check per period to the `checks`
collection. A check started before the plugin closed is there when it reopens. On a host with
schedules, a watch can be checked after each period at 09:00 in the member's time zone with the
plugin closed; a check records whether the page or the schedule started it. With an optional
Google Service Account Credential, `export-check-to-doc` and `export-check-to-sheet` append a
check to a Google Doc or Sheet with a link back to its period, and a schedule can append each check
it makes; OWOX adds the access token, so the key never reaches the Worker. The Doc also gets the
chart: the Worker draws it as a PNG at a signed link that Docs fetches while the export runs.
One Cloudflare Worker serves the page from `dist/`, runs the actions at `/owox` and draws charts
at `/chart.png`.
```

In the file list, add after the `worker/index.ts` line:

```markdown
- `worker/period.ts`: a watch's periods: their windows, labels, words, schedules and the run's day
  in the member's time zone; `worker/period.test.ts` tests them.
```

and in the `src/` line replace `keeps each watch's weekly check in \`ctx.schedules\`` with
`keeps each watch's scheduled check in \`ctx.schedules\``.

- [ ] **Step 6: Run the tests, build and lint**

Run: `npm test && npm run build && npm run lint`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add worker/index.ts plugin.json AGENTS.md
git commit -m "feat: read periods, take the member's day and export a scheduled check"
```

---

### Task 6: The page speaks in the watch's period

**Files:**
- Modify: `worker/watch.ts`, `worker/watch.test.ts` (`analysisKey`)
- Modify: `src/WatchForm.tsx`, `src/App.tsx`, `src/WatchPage.tsx`, `src/CheckView.tsx`, `src/WatchCard.tsx`

**Interfaces:**
- Consumes: Task 1 `ADVERB`, `count`, `FIRST_CHECK`, `granularityOf`, `periodLabel`, `SCHEDULES`,
  `scheduleFor`, `shortLabel`, `type Granularity`; Task 3 `CHART_PERIODS`.
- Produces: `analysisKey(watch: Watch): string` in `worker/watch.ts`; `ScheduleMenu` gains the
  prop `granularity: Granularity` (Task 7 adds the export field to it); the page starts
  `check-metric` with `{ watchId, periods, timeZone }` and creates schedules with
  `parameters: { watchId, timeZone }`.

The page has no unit tests; `analysisKey` is the one rule it adds, and it lives in `worker/watch.ts`
to be tested.

- [ ] **Step 1: Write the failing test**

Add `analysisKey` to the `./watch.ts` import in `worker/watch.test.ts` and append:

```ts
test('saving a watch re-checks it only when its analysis changes, and a missing period is a week', () => {
  assert.equal(analysisKey(roas), analysisKey({ ...roas, granularity: 'week' }))
  assert.equal(analysisKey(roas), analysisKey({ ...roas, name: 'Return on ad spend', format: 'times', rise: 'good' }))
  assert.notEqual(analysisKey(roas), analysisKey({ ...roas, granularity: 'month' }))
  assert.equal(analysisKey({ ...roas, dimensions: ['country', 'channel'] }), analysisKey({ ...roas, dimensions: ['channel', 'country'] }))
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL: `analysisKey` is not exported.

- [ ] **Step 3: Add `analysisKey` to `worker/watch.ts`**

Append:

```ts
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
```

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: `src/WatchForm.tsx`**

1. Imports: `import { analysisKey, formatMetric, type Format, type Rule, type Sensitivity, type Watch } from '../worker/watch'`
   and `import { count, FIRST_CHECK, type Granularity } from '../worker/period'`.
2. Delete the local `analysis` and its comment. Replace `analysis(draft) !== analysis(saved)` with
   `analysisKey(draft) !== analysisKey(saved)`.
3. After `SENSITIVITIES`, add:

```ts
const PERIODS: [Granularity, string][] = [
  ['day', 'Day'],
  ['week', 'Week'],
  ['month', 'Month'],
  ['quarter', 'Quarter'],
]
```

4. After the `sensitivity` state, add
   `const [granularity, setGranularity] = useState<Granularity>(saved?.granularity ?? 'week')`,
   and add `granularity,` after `sensitivity,` in `draft`.
5. In Step 1 "Where the data is", right after the `<div className="controls grid">…</div>` that
   holds the Data Mart and Date column fields, add:

```tsx
          {columns && (
            <div className="field">
              <span id="period">Period</span>
              <div className="segmented wide" role="group" aria-labelledby="period">
                {PERIODS.map(([value, label]) => (
                  <button key={value} aria-pressed={granularity === value} onClick={() => setGranularity(value)}>
                    {label}
                  </button>
                ))}
              </div>
              <p className="dm-muted hint flush">
                Each {granularity} is compared with the {granularity} before and the eight {granularity}s before it.
              </p>
            </div>
          )}
```

6. Replace the copy:

| Before | After |
| --- | --- |
| `` `Alerts when a week ${rise === 'good' ? …` `` (start of `ruleSentence`) | `` `Alerts when a ${granularity} ${rise === 'good' ? …` `` |
| `` } by more than ${rule.percent}% against the week before.` `` (end of `ruleSentence`) | `` } by more than ${rule.percent}% against the ${granularity} before.` `` |
| `A` / `week is unusual` (the rule title split over two lines) | `A {granularity} is unusual` |
| `Outside the usual range of the eight weeks before.` | `Outside the usual range of the eight {granularity}s before.` |
| `against the week before` (after the direction select) | `against the {granularity} before` |
| `By more than a percent you choose, against the week before.` | `By more than a percent you choose, against the {granularity} before.` |

7. Replace the summary hint and the submit label with:

```tsx
        <p className="dm-muted hint summary-cost">
          {!saved
            ? `The first check reads ${first} in one Data Mart run. You can close the plugin while it runs.`
            : recheck
              ? `Saving checks the last ${first} again in one Data Mart run and replaces the saved checks.`
              : `Saving keeps the checked ${granularity}s; only how they read changes.`}
        </p>
```

```tsx
            {!saved ? `Create and check ${first}` : recheck ? `Save and check ${first}` : 'Save'}
```

   with `const first = count(FIRST_CHECK[granularity], granularity)` next to `const ratio`.

- [ ] **Step 5: `src/App.tsx`**

1. Imports: remove `import { formatRange } from '../worker/period'` (added in Task 2) and add
   `import { FIRST_CHECK, granularityOf, scheduleFor } from '../worker/period'`.
2. `type Run = { executionId: string; periods: number }`.
3. In `parseRoute`, replace `if (kind === 'weeks' && value)` with
   `if ((kind === 'periods' || kind === 'weeks') && value)` and put above it the comment
   `// \`weeks\` is where the links in exports made before periods point.`. In `routePath`, replace
   `` `${base}/weeks/${route.asOf}` `` with `` `${base}/periods/${route.asOf}` ``.
4. Add above `export default function App`:

```ts
/** The member's time zone: a check's day and a schedule's 09:00 are taken in it. */
const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone
```

5. Replace `check`:

```ts
  const check = async (watchId: string, watch: StoredWatch, periods: number) => {
    try {
      const { id: executionId } = await actions.start('check-metric', { watchId, periods, timeZone: timeZone() })
      await watchStore.put(watchId, { ...watch, run: { executionId, periods } })
      await reload()
    } catch (failure) {
      setError(errorMessage(failure))
    }
  }
```

6. Replace `save` and its comment:

```ts
  /**
   * Saves a new or edited watch. A change that makes its checked periods wrong replaces them with a
   * fresh first check; a new watch looks back the same way, so its history is not empty. Its
   * schedule follows its period and name.
   */
  const save = async (id: string, watch: Watch, recheck: boolean) => {
    const run = watches?.find(saved => saved.id === id)?.document.run
    if (recheck) {
      if (run) await actions.cancel(run.executionId).catch(() => undefined)
      await Promise.all(checks.filter(saved => saved.document.watchId === id).map(saved => checkStore.delete(saved.id)))
    }
    await watchStore.put(id, !recheck && run ? { ...watch, run } : watch)
    const schedule = scheduleOf(id)
    const wanted = scheduleFor(watch)
    if (schedule && (schedule.cron !== wanted.cron || schedule.name !== wanted.name)) {
      await ctx.schedules?.update(schedule.id, wanted)
    }
    await reload()
    go({ page: 'watch', watchId: id })
    if (recheck) await check(id, watch, FIRST_CHECK[granularityOf(watch)])
  }
```

7. In `changeSchedule`, replace the `store.create({...})` call with:

```ts
      const zone = timeZone()
      await store.create({ action: 'check-metric', parameters: { watchId, timeZone: zone }, timeZone: zone, ...scheduleFor(watch) })
```

   and its comment with `/** Creates, pauses, resumes or deletes a watch's scheduled check. */`.
   Change the comment of `scheduleOf` to `/** A watch's scheduled check: the schedule that starts \`check-metric\` for it. */`
   and the comment in `remove` to `// First, so a failure leaves the watch and its scheduled check as they were.`.
8. In `onCheck`, replace `historyOf(saved.id).length === 0 ? 12 : 1` with
   `historyOf(saved.id).length === 0 ? FIRST_CHECK[granularityOf(saved.document)] : 1`.
9. In the list bar, delete `{newest && <strong>Week of {formatRange(newest.from, newest.to)}</strong>}`.
   Change the comment above `listed` to `// Each watch with its latest check and how it reads: alerts first, the largest change first.`.
10. Replace the empty state's paragraph text with:
    `Pick a metric such as ROAS or revenue. Each day, week, month or quarter it is compared with the eight before, and an unusual one comes with the channels, campaigns or countries that moved it.`

- [ ] **Step 6: `src/WatchPage.tsx`**

1. Imports: replace `import { formatRange } from '../worker/period'` with
   `import { ADVERB, count, FIRST_CHECK, granularityOf, periodLabel, SCHEDULES, type Granularity } from '../worker/period'`.
2. `ruleText`: add `const unit = granularityOf(watch)` at its top; replace
   `against the week before` with `against the ${unit} before` and
   `` `alerts when a week ${side}` `` with `` `alerts when a ${unit} ${side}` ``.
3. `ExportMenu`: add the prop `unit: Granularity` (type `{ range: string; unit: Granularity; onExport: … }`)
   and replace `The week is added` with `The {unit} is added`.
4. `ScheduleMenu`: add the prop `granularity: Granularity` and replace:

| Before | After |
| --- | --- |
| `{!schedule ? 'Schedule' : schedule.enabled ? 'Weekly' : …}` | `{!schedule ? 'Schedule' : schedule.enabled ? ADVERB[granularity] : …}` |
| `aria-label="Weekly check"` | ``aria-label={`${ADVERB[granularity]} check`}`` |
| `<strong>Weekly check</strong>` | `<strong>{ADVERB[granularity]} check</strong>` |
| `Every Monday at 09:00, {schedule.timeZone}.{' '}` | `{SCHEDULES[granularity].when}, {schedule.timeZone}.{' '}` |
| `Check the last week every Monday at 09:00, your time. The plugin can stay closed: the result is saved here.` | `{SCHEDULES[granularity].when}, your time, check the last {granularity}. The plugin can stay closed: the result is saved here.` |
| `Check weekly` | `Check {ADVERB[granularity].toLowerCase()}` |

   and its comment with `/** The watch's scheduled check, which OWOX runs with the plugin closed. */`.
5. `MoreMenu`: rename the prop `weeks` to `checks` and add `unit: Granularity`; replace
   `Delete {name} and its {weeks} checked {weeks === 1 ? 'week' : 'weeks'}?` with
   `Delete {name} and its {checks} checked {checks === 1 ? unit : `${unit}s`}?`.
6. In `WatchPage`, add `const unit = granularityOf(watch)` after `alerts` (`watch` may be null;
   `granularityOf` takes null) and replace:

| Before | After |
| --- | --- |
| `range={formatRange(selected.from, selected.to)}` | `range={periodLabel(unit, selected.from, selected.to)}` and the prop `unit={unit}` |
| `<ScheduleMenu schedule={schedule} onChange={onSchedule} />` | `<ScheduleMenu schedule={schedule} granularity={unit} onChange={onSchedule} />` |
| `<MoreMenu name={watch.name} weeks={history.length} …` | `<MoreMenu name={watch.name} checks={history.length} unit={unit} …` |
| `Checking {history.length === 0 ? 'the last 12 weeks' : 'the last week'}.` | ``Checking {history.length === 0 ? `the last ${count(FIRST_CHECK[unit], unit)}` : `the last ${unit}`}.`` |
| `Last {recent.length} {recent.length === 1 ? 'week' : 'weeks'}` | `Last {count(recent.length, unit)}` |
| `Usual range of each week` | `Usual range of each {unit}` |
| `No checked weeks yet. Check now to see the last one.` | `No checked {unit}s yet. Check now to see the last one.` |

   and the component comment with
   `/** One watch: the selected period (the latest by default), what happened, the last periods and why it changed. */`.

- [ ] **Step 7: `src/CheckView.tsx`**

1. Imports: replace `import { formatRange } from '../worker/period'` and the Task 3 import of
   `shortLabel`, `granularityOf` with one
   `import { ADVERB, granularityOf, periodLabel, shortLabel } from '../worker/period'`.
2. In `HistoryChart`, `WeekStrip`, `WeekKpi`, `WhatHappened` and `WhyItChanged`, add
   `const unit = granularityOf(watch)` at the top and replace:

| Before | After |
| --- | --- |
| `` `${watch.name} by week: ` `` | `` `${watch.name} by ${unit}: ` `` |
| `shortLabel(granularityOf(watch), check.from)` | `shortLabel(unit, check.from)` |
| `formatRange(hovered.from, hovered.to)` | `periodLabel(unit, hovered.from, hovered.to)` |
| `vs the week before` (chart tip) | `vs the {unit} before` |
| `aria-label="Checked weeks"` | ``aria-label={`Checked ${unit}s`}`` |
| `` `${formatRange(check.from, check.to)}: ` `` (strip button) | `` `${periodLabel(unit, check.from, check.to)}: ` `` |
| `{formatRange(check.from, check.to)}` (KPI label) | `{periodLabel(unit, check.from, check.to)}` |
| `the week before` (KPI note) | `the {unit} before` |
| `'No week before to compare with.'` | `` `No ${unit} before to compare with.` `` |
| `` `… against the week before, too little to name a cause.` `` | `` `… against the ${unit} before, too little to name a cause.` `` |
| `Nothing to compare with the week before.` | `Nothing to compare with the {unit} before.` |
| `' by the weekly schedule'` | `` ` by the ${ADVERB[unit].toLowerCase()} schedule` `` |

   Replace "week"/"weeks" in these components' comments with "period"/"periods".

- [ ] **Step 8: `src/WatchCard.tsx`**

Import `import { ADVERB, granularityOf } from '../worker/period'` and replace
`<span className="dm-muted watch-source">{watch.dataMartTitle}</span>` with
`<span className="dm-muted watch-source">{watch.dataMartTitle} · {ADVERB[granularityOf(watch)]}</span>`.
Replace "week" with "period" in its two comments.

- [ ] **Step 9: Check that no weekly copy is left**

Run: `grep -n -i "week" src/*.tsx`
Expected: only identifiers kept on purpose (`WeekStrip`, `WeekKpi`, `week-strip`, `weeks-chart`,
`week-bar`, `latest.weeks`, `check.weeks`, the `weeks` route comment and `kind === 'weeks'`), no
user-facing text.

- [ ] **Step 10: Run the tests, build and lint**

Run: `npm test && npm run build && npm run lint`
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add worker/watch.ts worker/watch.test.ts src/WatchForm.tsx src/App.tsx src/WatchPage.tsx src/CheckView.tsx src/WatchCard.tsx
git commit -m "feat: pick a watch's period and name it across the page"
```

---

### Task 7: A schedule adds each check to a Doc or Sheet

**Files:**
- Modify: `src/WatchPage.tsx` (`ScheduleMenu`, `ScheduleChange`, `onSchedule` prop)
- Modify: `src/App.tsx` (`changeSchedule` and its caller)

**Interfaces:**
- Consumes: Task 4 `exportTarget`, `exportLink`; Task 6 `ScheduleMenu` with `granularity`,
  `timeZone()`, `scheduleFor`.
- Produces: `type ScheduleChange = 'create' | 'pause' | 'resume' | 'delete' | 'target'`;
  `onSchedule: ((change: ScheduleChange, link: string) => Promise<void>) | undefined`.

- [ ] **Step 1: `src/WatchPage.tsx`**

1. Import `exportLink` next to `exportTarget` from `'../worker/google'`.
2. `export type ScheduleChange = 'create' | 'pause' | 'resume' | 'delete' | 'target'`.
3. Change the `onSchedule` prop of `WatchPage` to
   `onSchedule: ((change: ScheduleChange, link: string) => Promise<void>) | undefined` and
   `ScheduleMenu`'s `onChange` to `(change: ScheduleChange, link: string) => Promise<void>`.
4. In `ScheduleMenu`, replace its state and `change` with:

```tsx
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const saved = exportLink(schedule?.parameters)
  const [link, setLink] = useState(saved)
  const close = () => setOpen(false)
  // Each opening shows the saved target, so an unsaved edit is not mistaken for it.
  const toggle = () => {
    if (!open) setLink(saved)
    setOpen(!open)
  }
  const ref = useDismiss(open, close)
  const target = exportTarget(link)
  const invalid = link.trim() !== '' && !target
  const changed = !invalid && (target ? exportLink(target.input) : '') !== saved
  const change = (next: ScheduleChange) => {
    setBusy(true)
    void onChange(next, target ? link : '').finally(() => setBusy(false))
  }
```

   and the trigger button's `onClick={() => setOpen(!open)}` with `onClick={toggle}`.

5. Add the field once, after the schedule's text and before the action buttons in both branches
   (with a schedule, and without one), as a fragment rendered by a local const:

```tsx
  const exportField = (
    <>
      <label className="field">
        Also add each check to
        <input type="url" value={link} onChange={event => setLink(event.target.value)} placeholder="Google Doc or Sheet link (optional)" />
      </label>
      <p role={invalid ? 'alert' : undefined} className={invalid ? 'alert' : 'dm-muted hint flush'}>
        {invalid
          ? 'Paste the link of a Google Doc or Sheet.'
          : "A Doc gets each check at its end, a Sheet as a row. Share it with the plugin's service account first."}
      </p>
    </>
  )
```

   Define `exportField` after `change`, and render `{exportField}` right before each
   `<div className="actions end">` inside the popover.

6. With a schedule, the actions become:

```tsx
              <div className="actions end">
                <button className="button danger" onClick={() => change('delete')} disabled={busy}>
                  Delete
                </button>
                <button className="button secondary" onClick={() => change(schedule.enabled ? 'pause' : 'resume')} disabled={busy}>
                  {schedule.enabled ? 'Pause' : 'Resume'}
                </button>
                <button className="button" onClick={() => change('target')} disabled={busy || !changed}>
                  Save
                </button>
              </div>
```

   Without one, add `|| invalid` to the create button's `disabled`.

- [ ] **Step 2: `src/App.tsx`**

1. Import `exportTarget` is already there; keep it.
2. Replace `changeSchedule` with:

```ts
  /** Creates, pauses, resumes or deletes a watch's scheduled check, or changes where it adds each check. */
  const changeSchedule = async (watchId: string, watch: Watch, change: ScheduleChange, link: string) => {
    const store = ctx.schedules
    if (!store) return
    const schedule = scheduleOf(watchId)
    const target = exportTarget(link)?.input ?? {}
    if (change === 'create') {
      const zone = timeZone()
      await store.create({ action: 'check-metric', parameters: { watchId, timeZone: zone, ...target }, timeZone: zone, ...scheduleFor(watch) })
    } else if (schedule) {
      if (change === 'target') {
        // The rest of the parameters stay: a schedule made before periods keeps checking by UTC.
        const { documentId: _doc, spreadsheetId: _sheet, ...kept } = (schedule.parameters ?? {}) as Record<string, unknown>
        await store.update(schedule.id, { parameters: { ...kept, ...target } })
      } else if (change === 'delete') {
        await store.delete(schedule.id)
      } else {
        await store[change](schedule.id)
      }
    }
    await reload()
  }
```

3. In the `onSchedule` prop passed to `WatchPage`, pass the link through:

```tsx
        onSchedule={
          ctx.schedules &&
          ((change, link) =>
            saved
              ? changeSchedule(saved.id, saved.document, change, link).catch((failure: unknown) => setError(errorMessage(failure)))
              : Promise.resolve())
        }
```

- [ ] **Step 3: Build and lint**

Run: `npm test && npm run build && npm run lint`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/WatchPage.tsx src/App.tsx
git commit -m "feat: add each scheduled check to a Google Doc or Sheet"
```

---

### Task 8: Roll out and check on the stand (controller, with Yevhen)

Not for a subagent: it deploys, publishes and runs billed Data Mart queries. Ask Yevhen before
each of steps 2, 3 and 5, and keep Data Mart runs to the ones listed.

- [ ] **Step 1: Full checks on the final tree**

Run: `npm test && npm run build && npm run lint`, and `git status --short` (only
`worker/stand-callback.ts` is untracked).

- [ ] **Step 2: Deploy the Worker (ask first)**

Ask Yevhen. On a yes, deploy with the Cloudflare credentials from `~/.zshrc`, sourced inside the
command and never printed: `npx wrangler deploy`. Check `https://owox-plugin-backend-actions-example.e-zapolskiy.workers.dev/`
serves the new page (its bundle name changes).

- [ ] **Step 3: Release (ask first)**

Find the latest release with `git ls-remote --tags origin` and pick the next minor version. Ask
Yevhen to push `main` and the tag (`! git -C ~/projects/owox/owox-plugin-backend-actions-example push origin main` and
`git tag vX.Y.0` + `push origin vX.Y.0`), then publish it on the stand with `owox-ctl` and
`ctl.env` from the #7097 runtime directory, as the earlier releases were.

- [ ] **Step 4: Page checks without Data Mart runs**

On `http://localhost:3000/ui/0/plugins`, open Metric Watch: the existing ROAS watch reads
"Weekly", its edit form shows Period = Week, and saving it unchanged does not start a check.
An old `/weeks/<asOf>` link opens its period.

- [ ] **Step 5: Stand runs (ask first; five Data Mart runs)**

1. New Day watch on the demo Data Mart: one run, 14 days; labels `19 Oct`, text "the day before".
2. New Month watch: one run, 12 months, through `dateTrunc`; the checked month is September 2026.
   If HTTP Data rejects `dateTrunc`, stop and apply the spec's fallback.
3. Monthly schedule on the Month watch with the demo Sheet link: back up `stand.db`, set the
   schedule's next run to now as in the #7097 schedule checks, wait for the run: a row in the
   Sheet, the run Succeeded in Plugins → Schedules → Run History.
4. Change the target to the demo Doc and run again: the check, its chart and the link at the end
   of the Doc.
5. Change the target to a Doc the service account cannot open and run again: the run Failed with
   `EXPORT_FAILED` and "Checked Sep 2026, but could not add it to the Doc: …", and the check is
   still on the page.

Then reset the demo Doc and Sheet with `reference/gdemo-files.cjs`, restore the schedule's time,
and report what was run.
