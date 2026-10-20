import assert from 'node:assert/strict'
import test from 'node:test'
import { chartLink, chartOf, chartSvg, type ChartData } from './chart.ts'

const weeks = Array.from({ length: 12 }, (_, i) => ({
  from: `2026-07-${String(i + 10).padStart(2, '0')}`,
  value: 0.0213456789123 + i / 7000,
  usual: i < 3 ? null : { low: 0.0211111111111, high: 0.0285555555555 },
  tone: i === 11 ? ('bad' as const) : ('usual' as const),
}))
const data: ChartData = { format: 'percent', places: 4, weeks, selected: 11 }
const now = Date.parse('2026-10-16T12:00:00Z')

test('a chart link carries the chart, fits a Docs picture link and reads back', async () => {
  const link = await chartLink('https://plugin.example', data, 'secret', now)
  assert.ok(link.length < 2000, `${link.length} characters`)
  const read = await chartOf(new URL(link), 'secret', now + 60_000)
  assert.equal(read?.weeks.length, 12)
  assert.equal(read?.weeks[0].usual, null)
  assert.deepEqual(read?.weeks[11], { ...weeks[11], value: Number(weeks[11].value.toPrecision(6)), usual: { low: 0.0211111, high: 0.0285556 } })
  assert.equal(read?.format, 'percent')
  assert.equal(read?.selected, 11)
})

test('a chart link draws nothing once expired, re-signed or tampered with', async () => {
  const link = new URL(await chartLink('https://plugin.example', data, 'secret', now))
  assert.equal(await chartOf(link, 'secret', now + 11 * 60_000), null)
  assert.equal(await chartOf(link, 'another secret', now), null)
  const tampered = new URL(link)
  tampered.searchParams.set('e', String(now + 3_600_000))
  assert.equal(await chartOf(tampered, 'secret', now), null)
  assert.equal(await chartOf(new URL('https://plugin.example/chart.png'), 'secret', now), null)
})

test('the chart draws each usual range, every point and the alert in red', () => {
  const svg = chartSvg(data)!
  assert.equal(svg.match(/fill="#e3f2e8"/g)?.length, 9)
  assert.equal(svg.match(/<circle/g)?.length, 12)
  assert.match(svg, /<circle [^>]*r="6" fill="#e7000b"/)
  // Twelve columns leave room for every other date, ending on the newest week.
  assert.match(svg, />21 Jul</)
  assert.doesNotMatch(svg, />20 Jul</)
  assert.equal(chartSvg({ ...data, weeks: weeks.map(week => ({ ...week, value: null, usual: null })) }), null)
})

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
