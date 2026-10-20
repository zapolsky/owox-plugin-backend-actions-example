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
