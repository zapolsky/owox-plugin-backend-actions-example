import assert from 'node:assert/strict'
import test from 'node:test'
import {
  dayLabel,
  digestWindow,
  missingColumnsMessage,
  writeDigest,
  type RevenueRow,
} from './digest.ts'

const today = new Date('2026-10-15T09:30:00Z')

const twoWeeks: RevenueRow[] = [
  { day: '2026-10-13', city: 'Kyiv', revenue: 8000 },
  { day: '2026-10-09', city: 'Kyiv', revenue: 5484.4 },
  { day: '2026-10-13', city: 'Odesa', revenue: 1000 },
  { day: '2026-10-08', city: 'Odesa', revenue: 6254 },
  { day: '2026-10-14', city: 'Lviv', revenue: 10967 },
  { day: '2026-10-03', city: 'Kyiv', revenue: 10597 },
  { day: '2026-10-02', city: 'Odesa', revenue: 11129 },
  { day: '2026-10-01', city: 'Lviv', revenue: 10953 },
]

test('the window is the last seven full days and the seven before them', () => {
  assert.deepEqual(digestWindow(today), {
    from: '2026-10-08',
    to: '2026-10-14',
    previousFrom: '2026-10-01',
    previousTo: '2026-10-07',
  })
  assert.deepEqual(digestWindow(new Date('2026-10-03T00:00:00Z')), {
    from: '2026-09-26',
    to: '2026-10-02',
    previousFrom: '2026-09-19',
    previousTo: '2026-09-25',
  })
})

test('a digest names the total, the leading city, the biggest fall and the best day', () => {
  const digest = writeDigest('Demo Orders', twoWeeks, today)
  assert.equal(
    digest.text,
    'Demo Orders, 8–14 Oct 2026: revenue 31,705, down 3% on the week before (32,679). ' +
      'Kyiv brought the most: 13,484, up 27%. ' +
      'Odesa fell 35% to 7,254. ' +
      'Best day: Wednesday 14 Oct, 10,967.',
  )
  assert.deepEqual(
    { from: digest.from, to: digest.to, change: digest.change, bestDay: digest.bestDay },
    {
      from: '2026-10-08',
      to: '2026-10-14',
      change: -3,
      bestDay: { day: '2026-10-14', revenue: 10967 },
    },
  )
  assert.equal(Math.round(digest.revenue), 31705)
  assert.equal(digest.previousRevenue, 32679)
  assert.deepEqual(
    { ...digest.topCity, revenue: Math.round(digest.topCity!.revenue) },
    { city: 'Kyiv', revenue: 13484, change: 27 },
  )
  assert.deepEqual(digest.fall, { city: 'Odesa', revenue: 7254, change: -35 })
  assert.deepEqual(
    digest.cities.map(city => [city.city, Math.round(city.revenue), city.previousRevenue]),
    [
      ['Kyiv', 13484, 10597],
      ['Lviv', 10967, 10953],
      ['Odesa', 7254, 11129],
    ],
  )
})

test('a city that grew is not reported as a fall, and a flat total says so', () => {
  const rows: RevenueRow[] = [
    { day: '2026-10-10', city: 'Kyiv', revenue: 1000 },
    { day: '2026-10-03', city: 'Kyiv', revenue: 1004 },
  ]
  assert.equal(
    writeDigest('Sales', rows, today).text,
    'Sales, 8–14 Oct 2026: revenue 1,000, flat on the week before (1,004). ' +
      'Kyiv brought the most: 1,000. ' +
      'Best day: Saturday 10 Oct, 1,000.',
  )
})

test('a week without earlier revenue and a week without orders read naturally', () => {
  assert.equal(
    writeDigest('Sales', [{ day: '2026-10-12', city: 'Lviv', revenue: 250 }], today).text,
    'Sales, 8–14 Oct 2026: revenue 250, with no revenue the week before. ' +
      'Lviv brought the most: 250. ' +
      'Best day: Monday 12 Oct, 250.',
  )
  const empty = writeDigest('Sales', [{ day: '2026-10-02', city: 'Lviv', revenue: 250 }], today)
  assert.equal(empty.text, 'Sales, 8–14 Oct 2026: no orders. The week before brought 250.')
  assert.deepEqual([empty.topCity, empty.fall, empty.bestDay], [null, null, null])
  assert.deepEqual(empty.cities, [{ city: 'Lviv', revenue: 0, previousRevenue: 250 }])
})

test('a window across two months names both', () => {
  assert.match(
    writeDigest('Sales', [], new Date('2026-10-03T00:00:00Z')).text,
    /^Sales, 26 Sep – 2 Oct 2026: no orders\.$/,
  )
})

test('the missing-columns message lists every missing column', () => {
  assert.equal(
    missingColumnsMessage('Visits', ['revenue']),
    'Visits has no "revenue" column. A sales digest needs "order_date", "city" and "revenue".',
  )
  assert.equal(
    missingColumnsMessage('Visits', ['order_date', 'city', 'revenue']).split('.')[0],
    'Visits has no "order_date", "city" or "revenue" column',
  )
})

test('a day label is long by default and short on request', () => {
  assert.equal(dayLabel('2026-10-09'), 'Friday 9 Oct')
  assert.equal(dayLabel('2026-10-09', true), 'Fri 9 Oct')
})
