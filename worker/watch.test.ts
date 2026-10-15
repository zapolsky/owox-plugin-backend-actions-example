import assert from 'node:assert/strict'
import test from 'node:test'
import {
  breakdown,
  checkWeek,
  firstDay,
  shareOf,
  placesFor,
  shiftDay,
  signed,
  usualRange,
  weekAt,
  type SumRow,
  type Watch,
} from './watch.ts'

const asOf = '2026-10-15'

const roas: Watch = {
  name: 'ROAS',
  dataMartId: 'dm-1',
  dataMartTitle: 'Demo Ads Performance',
  dateColumn: 'date',
  numerator: 'revenue',
  denominator: 'cost',
  dimensions: ['channel'],
  rule: { kind: 'unusual' },
}

/** Daily rows for 70 days before `asOf`: two channels, cost 100 and revenue 300 a day each. */
function days(
  adjust: (row: SumRow, ago: number) => SumRow = row => row,
  segments = ['facebook / paid', 'google / cpc'],
): SumRow[] {
  return Array.from({ length: 70 }, (_, i) => i + 1).flatMap(ago =>
    segments.map(segment =>
      adjust({ day: shiftDay(asOf, -ago), segment, numerator: 300, denominator: 100 }, ago),
    ),
  )
}

const totals = (rows: SumRow[]) => rows.map(({ segment: _segment, ...row }) => row)

test('weeks end the day before the check and step back seven days', () => {
  assert.deepEqual(weekAt(asOf, 0), { from: '2026-10-08', to: '2026-10-14' })
  assert.deepEqual(weekAt(asOf, 1), { from: '2026-10-01', to: '2026-10-07' })
  // One check reads its week and the eight before it; twelve checks reach eleven weeks further.
  assert.equal(firstDay(asOf, 1), '2026-08-13')
  assert.equal(firstDay(asOf, 12), shiftDay('2026-08-13', -77))
})

test('the parts of a ratio change add up to the change and blame the value that moved', () => {
  // facebook doubles its cost this week and brings no more revenue.
  const rows = days((row, ago) =>
    ago <= 7 && row.segment === 'facebook / paid' ? { ...row, denominator: 200 } : row,
  )
  const segments = breakdown(rows, weekAt(asOf, 0), weekAt(asOf, 1), true)
  const sum = segments.reduce((all, segment) => all + segment.contribution, 0)
  // ROAS was 1200 / 400 = 3, now 1200 / 600 = 2.
  assert.ok(Math.abs(sum - (2 - 3)) < 1e-12)
  assert.equal(segments[0].name, 'facebook / paid')
  assert.ok(segments[0].contribution < -0.9)
  assert.equal(segments[0].denominatorChange, 100)
  assert.equal(segments[0].numeratorChange, 0)
})

test('a value that did not change gets no part of a ratio change', () => {
  // email earns 15 per unit of cost and stays the same while facebook doubles its cost.
  const rows = days(
    (row, ago) =>
      row.segment === 'email'
        ? { ...row, numerator: 1500 }
        : ago <= 7 ? { ...row, denominator: 200 } : row,
    ['facebook / paid', 'email'],
  )
  const segments = breakdown(rows, weekAt(asOf, 0), weekAt(asOf, 1), true)
  const email = segments.find(segment => segment.name === 'email')
  assert.equal(email?.contribution, 0)
  assert.ok(Math.abs(segments.reduce((all, segment) => all + segment.contribution, 0) - (1800 / 300 - 9)) < 1e-12)
})

test('a share is a part of what moved the metric its way, never more than all of it', () => {
  // facebook drops ROAS by 1.2 and google wins 0.2 back: facebook is all of the drop, not 120% of it.
  const segments = [
    { name: 'facebook', contribution: -1.2 },
    { name: 'google', contribution: 0.2 },
    { name: 'email', contribution: -0.0 },
  ]
  assert.equal(shareOf(segments[0], segments, -1), 100)
  assert.equal(shareOf(segments[1], segments, -1), null)
  assert.equal(shareOf(segments[2], segments, -1), null)
})

test('a signed value that rounds to zero has no sign', () => {
  assert.equal(signed(-0.004, 2), '0.00')
  assert.equal(signed(-0.7, 2), '−0.70')
  assert.equal(signed(1204.4, null), '+1,204')
})

test('a small ratio keeps three significant digits and a small change names no drivers', () => {
  assert.equal(placesFor(true, 1.96), 2)
  assert.equal(placesFor(true, 76.9), 2)
  assert.equal(placesFor(true, 0.104), 3)
  assert.equal(placesFor(true, 0.0231), 4)
  assert.equal(placesFor(false, 0.0231), null)
  // Orders per session: 3 of 120 a day, then 2.9 of 120 this week, about 3% less.
  const rate: Watch = { ...roas, name: 'Conversion rate', numerator: 'orders', denominator: 'sessions' }
  const rows = days((row, ago) => ({ ...row, numerator: ago <= 7 ? 2.9 : 3, denominator: 120 }))
  const check = checkWeek('w1', rate, asOf, totals(rows), { channel: rows }, '')
  assert.equal(check.text, 'Conversion rate, 8–14 Oct 2026: fell 3% to 0.0242 (0.0250 the week before).')
})

test('a sum splits by each value and folds the long tail into Other without losing any of it', () => {
  const rows: SumRow[] = Array.from({ length: 10 }, (_, i) => [
    { day: '2026-10-10', segment: `c${i}`, numerator: 10 + i, denominator: 0 },
    { day: '2026-10-03', segment: `c${i}`, numerator: 10, denominator: 0 },
  ]).flat()
  const segments = breakdown(rows, weekAt(asOf, 0), weekAt(asOf, 1), false)
  assert.equal(segments.length, 7)
  assert.equal(segments[0].name, 'c9')
  assert.equal(segments[0].contribution, 9)
  assert.equal(segments.at(-1)?.name, 'Other (4)')
  assert.equal(segments.reduce((all, segment) => all + segment.contribution, 0), 45)
})

test('three unusual weeks out of eight do not widen the usual range', () => {
  const range = usualRange([3, 3.02, 2.98, 3.01, 2.2, 2.1, 4.1, 3])
  assert.ok(range)
  assert.ok(range.low > 2.5 && range.high < 3.5)
  assert.equal(usualRange([3, 3, null, null, null]), null)
})

test('a week below the usual range alerts and names what drove it', () => {
  const rows = days((row, ago) =>
    ago <= 7 && row.segment === 'facebook / paid' ? { ...row, denominator: 250 } : row,
  )
  const check = checkWeek('w1', roas, asOf, totals(rows), { channel: rows }, '2026-10-15T09:00:00Z')
  assert.equal(check.from, '2026-10-08')
  assert.equal(check.weeks.length, 9)
  assert.equal(check.value, 600 * 7 / (350 * 7))
  assert.equal(check.previousValue, 3)
  assert.equal(check.change, -43)
  assert.equal(check.alert, true)
  assert.match(check.reason, /^Below the usual 2\.55–3\.45/)
  assert.equal(
    check.text,
    'ROAS, 8–14 Oct 2026: fell 43% to 1.71 (3.00 the week before). ' +
      'Below the usual 2.55–3.45 of the eight weeks before. ' +
      'Driven by channel "facebook / paid" (100%). In "facebook / paid", cost +150%, revenue 0%.',
  )
})

test('a change no single value explains says so and names the largest part', () => {
  // Both channels lose a little revenue, so each explains half of the drop.
  const rows = days((row, ago) => (ago <= 7 ? { ...row, numerator: 240 } : row))
  const check = checkWeek('w1', roas, asOf, totals(rows), { channel: rows }, '')
  assert.match(check.text, /Driven by channel "(facebook \/ paid|google \/ cpc)" \(50%\)\./)
  // Three channels lose 60, 50 and 40 a day: the largest explains 40% of the drop.
  const loss: Record<string, number> = { email: 240, tiktok: 250, bing: 260 }
  const spread = days(
    (row, ago) => (ago <= 7 ? { ...row, numerator: loss[row.segment!] } : row),
    Object.keys(loss),
  )
  const unclear = checkWeek('w1', roas, asOf, totals(spread), { channel: spread }, '')
  assert.match(unclear.text, /No single value explains most of it; the largest is channel "email" \(40%\)\. In "email", cost 0%, revenue −20%\.$/)
})

test('rows split by more columns than one give the same check', () => {
  // One Data Mart run returns a row per day and combination of every dimension; each split sums them.
  const rows = days((row, ago) => (ago <= 7 && row.segment === 'facebook / paid' ? { ...row, denominator: 250 } : row))
  const split = rows.flatMap(row => ['US', 'PL'].map(() => ({ ...row, numerator: row.numerator / 2, denominator: row.denominator / 2 })))
  const whole = checkWeek('w1', roas, asOf, totals(rows), { channel: rows }, '')
  const halves = checkWeek('w1', roas, asOf, totals(split), { channel: split }, '')
  assert.equal(halves.text, whole.text)
  assert.deepEqual(halves.weeks, whole.weeks)
})

test('an ordinary week does not alert', () => {
  const rows = days()
  const check = checkWeek('w1', roas, asOf, totals(rows), { channel: rows }, '2026-10-15T09:00:00Z')
  assert.equal(check.alert, false)
  assert.equal(check.change, 0)
  assert.match(check.text, /held at 3\.00/)
})

test('a change rule alerts only in its direction', () => {
  const rows = days((row, ago) => (ago <= 7 ? { ...row, numerator: 400 } : row))
  const rising = { ...roas, rule: { kind: 'change', percent: 15, direction: 'down' } } satisfies Watch
  const down = checkWeek('w1', rising, asOf, totals(rows), {}, '')
  assert.equal(down.alert, false)
  assert.equal(down.reason, 'Rose 33%, within 15%.')
  const either = checkWeek('w1', { ...rising, rule: { ...rising.rule, direction: 'any' } }, asOf, totals(rows), {}, '')
  assert.equal(either.alert, true)
  assert.equal(either.reason, 'Rose 33%, past the 15% the rule allows.')
})

test('weeks without rows have no value instead of zero and set no usual range', () => {
  const visits: Watch = { ...roas, name: 'visits', numerator: 'visits', denominator: null }
  // Data starts three weeks back: the five weeks before are empty, not zero.
  const rows = days().filter(row => row.day >= weekAt(asOf, 2).from)
  const check = checkWeek('w1', visits, asOf, totals(rows), { channel: rows }, '')
  assert.deepEqual(check.weeks.map(week => week.value), [null, null, null, null, null, null, 4200, 4200, 4200])
  assert.equal(check.usual, null)
  assert.equal(check.alert, false)
  assert.equal(check.reason, 'Needs four earlier weeks with data to know the usual range.')
  const empty = checkWeek('w1', visits, shiftDay(asOf, 21), totals(rows), {}, '')
  assert.equal(empty.value, null)
  assert.equal(empty.reason, 'No data this week.')
})

test('a week with no cost has no ROAS and says so instead of dividing by zero', () => {
  const rows = days((row, ago) => (ago <= 7 ? { ...row, denominator: 0 } : row))
  const check = checkWeek('w1', roas, asOf, totals(rows), { channel: rows }, '')
  assert.equal(check.value, null)
  assert.equal(check.alert, false)
  assert.deepEqual(check.breakdowns, [{ dimension: 'channel', segments: [] }])
  assert.equal(check.text, 'ROAS, 8–14 Oct 2026: No cost this week, so ROAS is undefined.')
})
