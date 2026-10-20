import { granularityOf, shortLabel, type Granularity } from './period.ts'
import { formatMetric, verdict, type Check, type Format, type Verdict, type Watch } from './watch.ts'

/** Periods a chart shows, on the page and in a Doc. */
export const CHART_PERIODS = 12

/** One week of the chart: its value over its own usual range, coloured by what it means. */
export type ChartWeek = {
  from: string
  value: number | null
  usual: { low: number; high: number } | null
  tone: Verdict['tone']
}

export type ChartData = {
  format: Format | undefined
  places: number | null
  weeks: ChartWeek[]
  /** The highlighted week, -1 for none. */
  selected: number
  /** Labels the periods; a week when unset. */
  granularity?: Granularity
}

/** The chart's weeks of checks, oldest first. A change rule ignores the usual range, so it is not drawn. */
export const chartWeeks = (checks: Check[], watch: Watch): ChartWeek[] =>
  checks.map(check => ({
    from: check.from,
    value: check.value,
    usual: watch.rule.kind === 'unusual' ? check.usual : null,
    tone: verdict(check, watch).tone,
  }))

/** Steps of 1, 2, 2.5 or 5 times a power of ten, about four of them between `min` and `max`. */
function ticks(min: number, max: number): number[] {
  const raw = (max - min) / 4
  const power = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map(multiple => multiple * power).find(candidate => candidate >= raw)!
  const values: number[] = []
  for (let value = Math.ceil(min / step) * step; value <= max; value += step) values.push(value)
  return values
}

/** Where everything goes on a chart `width` × `height` pixels; null when no week has a value. */
export function chartLayout(data: ChartData, width: number, height: number) {
  const bounds = data.weeks.flatMap(week => [
    ...(week.value === null ? [] : [week.value]),
    ...(week.usual ? [week.usual.low, week.usual.high] : []),
  ])
  if (bounds.length === 0) return null
  const pad = (Math.max(...bounds) - Math.min(...bounds)) * 0.1 || Math.abs(bounds[0]) * 0.1 || 1
  const [min, max] = [Math.min(...bounds) - pad, Math.max(...bounds) + pad]
  const scale = ticks(min, max).map(tick => ({ value: tick, label: formatMetric(tick, data, data.places) }))
  const [top, right, bottom] = [12, 8, height - 28]
  const left = 16 + Math.max(...scale.map(tick => tick.label.length)) * 7
  const column = (width - left - right) / data.weeks.length
  const x = (i: number) => left + (i + 0.5) * column
  const y = (value: number) => bottom - ((value - min) / (max - min)) * (bottom - top)
  const points = data.weeks.flatMap((week, i) => (week.value === null ? [] : [{ i, value: week.value, tone: week.tone }]))
  // Dates do not fit in narrow columns: keep every other one, ending on the newest week.
  const every = column < 56 ? 2 : 1
  const dated = (i: number) => (data.weeks.length - 1 - i) % every === 0
  return { top, right, bottom, left, width, height, column, x, y, scale, points, dated }
}

const COLORS = {
  background: '#ffffff',
  line: '#0084ff',
  tick: '#65676f',
  current: '#35363d',
  grid: '#e5e5e5',
  usual: '#e3f2e8',
  selected: '#ebf5ff',
  good: '#25984d',
  bad: '#e7000b',
}

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;')

/** The chart as an SVG document drawn like the page's, for a picture in a Doc. */
export function chartSvg(data: ChartData, width = 640, height = 260): string | null {
  const layout = chartLayout(data, width, height)
  if (!layout) return null
  const { top, right, bottom, left, column, x, y } = layout
  const parts = [`<rect width="${width}" height="${height}" fill="${COLORS.background}"/>`]
  if (data.selected >= 0) {
    parts.push(`<rect x="${left + data.selected * column}" y="${top - 6}" width="${column}" height="${bottom - top + 12}" rx="6" fill="${COLORS.selected}"/>`)
  }
  data.weeks.forEach((week, i) => {
    if (!week.usual) return
    const height = Math.max(1, y(week.usual.low) - y(week.usual.high))
    parts.push(`<rect x="${left + i * column}" y="${y(week.usual.high)}" width="${column}" height="${height}" fill="${COLORS.usual}"/>`)
  })
  for (const tick of layout.scale) {
    parts.push(
      `<line x1="${left}" x2="${width - right}" y1="${y(tick.value)}" y2="${y(tick.value)}" stroke="${COLORS.grid}"/>`,
      `<text x="${left - 8}" y="${y(tick.value) + 4}" text-anchor="end" font-size="11" fill="${COLORS.tick}">${escape(tick.label)}</text>`,
    )
  }
  data.weeks.forEach((week, i) => {
    if (!layout.dated(i)) return
    const current = i === data.selected
    parts.push(
      `<text x="${x(i)}" y="${height - 6}" text-anchor="middle" font-size="11" fill="${current ? COLORS.current : COLORS.tick}"${current ? ' font-weight="500"' : ''}>${shortLabel(granularityOf(data), week.from)}</text>`,
    )
  })
  const line = layout.points.map(point => `${x(point.i)},${y(point.value)}`).join(' ')
  parts.push(`<polyline points="${line}" fill="none" stroke="${COLORS.line}" stroke-width="2" stroke-linejoin="round"/>`)
  for (const point of layout.points) {
    const flagged = point.tone === 'bad' || point.tone === 'good'
    const radius = point.i === data.selected ? 6 : flagged ? 5 : 3.5
    const [fill, stroke] = flagged ? [COLORS[point.tone as 'bad' | 'good'], COLORS.background] : [COLORS.background, COLORS.line]
    parts.push(`<circle cx="${x(point.i)}" cy="${y(point.value)}" r="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`)
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="Roboto">${parts.join('')}</svg>`
}

export const CHART_PATH = '/chart.png'
/** How long a chart link works: Docs fetches the picture once, while the export runs. */
const CHART_LINK_MS = 10 * 60_000

const TONES: Verdict['tone'][] = ['bad', 'good', 'usual', 'none']
// Six significant digits draw the same chart and keep the link under the 2 KB Docs accepts.
const round = (value: number | null | undefined) => (value == null ? null : Number(value.toPrecision(6)))

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unbase64url = (text: string) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0))

const hmacKey = (secret: string) =>
  crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])

/** A link to the chart as a PNG on this Worker, signed so that nobody else can draw with it. */
export async function chartLink(origin: string, data: ChartData, secret: string, now = Date.now()): Promise<string> {
  const weeks = data.weeks.map(week => [week.from, round(week.value), round(week.usual?.low), round(week.usual?.high), TONES.indexOf(week.tone)])
  const payload = base64url(new TextEncoder().encode(JSON.stringify([data.format ?? null, data.places, data.selected, weeks, data.granularity ?? null])))
  const expires = String(now + CHART_LINK_MS)
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(`${payload}.${expires}`))
  return `${origin}${CHART_PATH}?d=${payload}&e=${expires}&s=${base64url(new Uint8Array(signature))}`
}

/** The chart a link signed with `secret` names; null when it is not signed with it or has expired. */
export async function chartOf(url: URL, secret: string, now = Date.now()): Promise<ChartData | null> {
  const [payload, expires, signature] = ['d', 'e', 's'].map(name => url.searchParams.get(name) ?? '')
  if (!payload || !(Number(expires) > now)) return null
  try {
    const signed = await crypto.subtle.verify('HMAC', await hmacKey(secret), unbase64url(signature), new TextEncoder().encode(`${payload}.${expires}`))
    if (!signed) return null
    const [format, places, selected, weeks, granularity] = JSON.parse(new TextDecoder().decode(unbase64url(payload)))
    return {
      format: format ?? undefined,
      places,
      granularity: granularity ?? undefined,
      selected,
      weeks: (weeks as [string, number | null, number | null, number | null, number][]).map(([from, value, low, high, tone]) => ({
        from,
        value,
        usual: low === null || high === null ? null : { low, high },
        tone: TONES[tone],
      })),
    }
  } catch {
    return null
  }
}
