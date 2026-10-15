import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { CircleCheck, Minus, TrendingDown, TrendingUp, TriangleAlert } from 'lucide-react'
import {
  formatRange,
  formatValue,
  placesFor,
  shareOf,
  signed,
  signedPercent,
  type Breakdown,
  type Check,
  type Watch,
  type Week,
} from '../worker/watch'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const shortDay = (day: string) => {
  const date = new Date(`${day}T00:00:00Z`)
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`
}

/** `15 Oct, 16:29` in the member's time zone. */
export function CheckedAt({ iso }: { iso: string }) {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function Change({ value }: { value: number | null }) {
  if (value === null) return <span className="change">—</span>
  const [Icon, kind] = value > 0 ? [TrendingUp, 'up'] : value < 0 ? [TrendingDown, 'down'] : [Minus, 'flat']
  return (
    <span className={`change ${kind}`}>
      <Icon size={14} aria-hidden />
      {signedPercent(value)}
    </span>
  )
}

export function StatusBadge({ alert }: { alert: boolean }) {
  return alert ? (
    <span className="badge alert">
      <TriangleAlert size={13} aria-hidden /> Alert
    </span>
  ) : (
    <span className="badge ok">
      <CircleCheck size={13} aria-hidden /> OK
    </span>
  )
}

/** Weekly values as a small line; the last dot is the checked week. */
export function Sparkline({ weeks, alert }: { weeks: Week[]; alert: boolean }) {
  const known = weeks.flatMap((week, i) => (week.value === null ? [] : [{ i, value: week.value }]))
  if (known.length < 2) return null
  const values = known.map(point => point.value)
  const [min, max] = [Math.min(...values), Math.max(...values)]
  const x = (i: number) => 2 + (i / (weeks.length - 1)) * 116
  const y = (value: number) => 30 - (max === min ? 14 : ((value - min) / (max - min)) * 28)
  const last = known.at(-1)!
  return (
    <svg className="sparkline" viewBox="0 0 120 32" aria-hidden>
      <polyline points={known.map(point => `${x(point.i)},${y(point.value)}`).join(' ')} />
      <circle className={alert ? 'alert' : 'ok'} cx={x(last.i)} cy={y(last.value)} r="3" />
    </svg>
  )
}

/** The width of an element, followed as it resizes, so the chart draws in real pixels. */
function useWidth() {
  const ref = useRef<HTMLElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

/** Steps of 1, 2, 2.5 or 5 times a power of ten, about four of them between `min` and `max`. */
function ticks(min: number, max: number): number[] {
  const raw = (max - min) / 4
  const power = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map(multiple => multiple * power).find(candidate => candidate >= raw)!
  const values: number[] = []
  for (let value = Math.ceil(min / step) * step; value <= max; value += step) values.push(value)
  return values
}

const CHART_HEIGHT = 240

/** Nine weeks with a value scale and the usual range shaded; hovering a week shows its numbers. */
function WeeksChart({ check, places }: { check: Check; places: number | null }) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const { weeks, usual } = check
  const values = weeks.flatMap(week => (week.value === null ? [] : [week.value]))
  if (values.length === 0) return null

  const bounds = [...values, ...(usual ? [usual.low, usual.high] : [])]
  const pad = (Math.max(...bounds) - Math.min(...bounds)) * 0.1 || Math.abs(bounds[0]) * 0.1 || 1
  const [min, max] = [Math.min(...bounds) - pad, Math.max(...bounds) + pad]
  const scale = ticks(min, max)
  const labels = scale.map(tick => formatValue(tick, places))
  const [top, right, bottom, left] = [12, 16, CHART_HEIGHT - 28, 16 + Math.max(...labels.map(label => label.length)) * 7]
  const last = weeks.length - 1
  const x = (i: number) => left + (i / last) * (width - left - right)
  const y = (value: number) => bottom - ((value - min) / (max - min)) * (bottom - top)
  const points = weeks.flatMap((week, i) => (week.value === null ? [] : [{ i, value: week.value }]))
  // Nine dates do not fit side by side on a phone: keep every other one, ending on the checked week.
  const every = width < 520 ? 2 : 1

  const move = (event: PointerEvent<SVGSVGElement>) => {
    const offset = event.clientX - event.currentTarget.getBoundingClientRect().left
    setHover(Math.min(last, Math.max(0, Math.round(((offset - left) / (width - left - right)) * last))))
  }
  const hovered = hover === null ? null : weeks[hover]
  const before = hover ? weeks[hover - 1].value : null
  const change = hovered?.value != null && before ? Math.round((hovered.value / before - 1) * 100) : null
  const tipY = hovered?.value != null ? y(hovered.value) : top

  return (
    <figure className="weeks-chart" ref={ref}>
      {width > 0 && (
        <svg
          width={width}
          height={CHART_HEIGHT}
          role="img"
          aria-label={`${check.name} by week: ${weeks.map(week => `${shortDay(week.from)} ${formatValue(week.value, places)}`).join(', ')}`}
          onPointerMove={move}
          onPointerLeave={() => setHover(null)}
        >
          {scale.map((tick, i) => (
            <g key={tick}>
              <line className="grid" x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} />
              <text className="tick" x={left - 8} y={y(tick)} dy="0.32em" textAnchor="end">
                {labels[i]}
              </text>
            </g>
          ))}
          {usual && <rect className="usual" x={left} width={width - left - right} y={y(usual.high)} height={y(usual.low) - y(usual.high)} rx="4" />}
          {weeks.map((week, i) =>
            i % every === last % every ? (
              <text key={week.from} className={i === last ? 'tick current' : 'tick'} x={x(i)} y={CHART_HEIGHT - 6} textAnchor="middle">
                {shortDay(week.from)}
              </text>
            ) : null,
          )}
          {hover !== null && <line className="guide" x1={x(hover)} x2={x(hover)} y1={top} y2={bottom} />}
          <polyline className="line" points={points.map(point => `${x(point.i)},${y(point.value)}`).join(' ')} />
          {points.map(point => (
            <circle
              key={point.i}
              className={point.i === last ? (check.alert ? 'point alert' : 'point ok') : 'point'}
              cx={x(point.i)}
              cy={y(point.value)}
              r={point.i === last || point.i === hover ? 6 : 3.5}
            />
          ))}
        </svg>
      )}
      {hovered && hover !== null && (
        // Beside the point, towards the middle, so it covers neither the point nor its neighbours' line.
        <div
          className={x(hover) > width / 2 ? 'chart-tip left' : 'chart-tip'}
          style={{ left: x(hover), top: Math.min(bottom - 60, Math.max(top + 60, tipY)) }}
          aria-hidden
        >
          <span className="dm-muted">{formatRange(hovered.from, hovered.to)}</span>
          <strong>
            {check.name} {formatValue(hovered.value, places)}
          </strong>
          {change !== null && (
            <span>
              <Change value={change} /> vs the week before
            </span>
          )}
          {hover === last && <span className={check.alert ? 'alert-text' : 'dm-muted'}>{check.reason}</span>}
        </div>
      )}
      {usual && (
        <figcaption className="legend dm-muted">
          <i aria-hidden /> Usual range {formatValue(usual.low, places)}–{formatValue(usual.high, places)}, from the eight weeks before
        </figcaption>
      )}
    </figure>
  )
}

/** A column's percent change, bold when it moved by a quarter or more. */
function Percent({ value }: { value: number | null }) {
  if (value === null) return <span className="dm-muted">—</span>
  return <span className={Math.abs(value) >= 25 ? 'big-change' : undefined}>{signedPercent(value)}</span>
}

/** Which values of one column moved the metric, a column at a time, starting with the strongest driver. */
function WhyItChanged({ check, watch, places }: { check: Check; watch: Watch; places: number | null }) {
  const ratio = watch.denominator !== null
  const change = check.value !== null && check.previousValue !== null ? check.value - check.previousValue : 0
  const strongest = (breakdown: Breakdown) =>
    Math.max(0, ...breakdown.segments.map(segment => shareOf(segment, breakdown.segments, change) ?? 0))
  const [dimension, setDimension] = useState(() => [...check.breakdowns].sort((a, b) => strongest(b) - strongest(a))[0]?.dimension)
  const selected = check.breakdowns.find(breakdown => breakdown.dimension === dimension) ?? check.breakdowns[0]
  if (!selected) return null
  const largest = Math.max(...selected.segments.map(segment => Math.abs(segment.contribution)), Number.EPSILON)

  return (
    <section aria-labelledby="why-title">
      <div className="why-head">
        <h2 id="why-title" className="section-title">
          Why it changed
        </h2>
        {check.breakdowns.length > 1 && (
          <div className="segmented" role="group" aria-label="Explain by">
            {check.breakdowns.map(breakdown => (
              <button key={breakdown.dimension} aria-pressed={breakdown === selected} onClick={() => setDimension(breakdown.dimension)}>
                {breakdown.dimension}
              </button>
            ))}
          </div>
        )}
      </div>
      {selected.segments.length === 0 ? (
        <p className="dm-muted hint">Nothing to compare with the week before.</p>
      ) : (
        <>
          <p className="dm-muted hint">
            Impact is how much each {selected.dimension} moved {check.name} from {formatValue(check.previousValue, places)} to{' '}
            {formatValue(check.value, places)}. The impacts add up to {signed(change, places)}.
          </p>
          <div className="table-wrap">
            <table className="why-table">
              <thead>
                <tr>
                  <th scope="col">{selected.dimension}</th>
                  <th scope="col" className="num">
                    {check.name}, before → now
                  </th>
                  {ratio && (
                    <th scope="col" className="num">
                      {watch.denominator}
                    </th>
                  )}
                  <th scope="col" className="num">
                    {ratio ? watch.numerator : 'Change'}
                  </th>
                  <th scope="col">Impact on {check.name}</th>
                </tr>
              </thead>
              <tbody>
                {selected.segments.map(segment => {
                  const part = shareOf(segment, selected.segments, change)
                  const width = `${(Math.abs(segment.contribution) / largest) * 50}%`
                  const impact = signed(segment.contribution, places)
                  return (
                    <tr key={segment.name} className={part !== null && part >= 50 ? 'driver' : undefined}>
                      <th scope="row">{segment.name}</th>
                      <td className="num">
                        {segment.value === null && segment.previousValue === null ? (
                          <span className="dm-muted">—</span>
                        ) : (
                          <>
                            <span className="dm-muted">{formatValue(segment.previousValue, places)} → </span>
                            {formatValue(segment.value, places)}
                          </>
                        )}
                      </td>
                      {ratio && (
                        <td className="num">
                          <Percent value={segment.denominatorChange} />
                        </td>
                      )}
                      <td className="num">
                        <Percent value={segment.numeratorChange} />
                      </td>
                      <td>
                        <span className="impact">
                          <span className="driver-bar" aria-hidden>
                            {impact !== formatValue(0, places) && (
                              <span
                                className={segment.contribution < 0 ? 'down' : 'up'}
                                style={segment.contribution < 0 ? { right: '50%', width } : { left: '50%', width }}
                              />
                            )}
                          </span>
                          <span className="num">
                            {impact}
                            {part !== null && part > 0 && impact !== formatValue(0, places) && (
                              <span className="dm-muted"> · {part}%</span>
                            )}
                          </span>
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

/** One checked week: the value, the usual range, and what moved it. */
export function CheckView({ check, watch }: { check: Check; watch: Watch }) {
  const places = placesFor(watch.denominator !== null, check.value ?? check.previousValue)
  return (
    <section className="dm-card" aria-labelledby="check-title">
      <div className="headline">
        <div>
          <div id="check-title" className="kpi-label">
            {check.name} · {formatRange(check.from, check.to)}
          </div>
          <div className="big-value">{formatValue(check.value, places)}</div>
          <div className="kpi-note">
            <Change value={check.change} /> vs {formatValue(check.previousValue, places)} the week before
          </div>
        </div>
        <StatusBadge alert={check.alert} />
      </div>
      <p className={check.alert ? 'reason alert-text' : 'reason dm-muted'}>{check.reason}</p>
      <WeeksChart check={check} places={places} />
      <p className="quote">{check.text}</p>
      <WhyItChanged check={check} watch={watch} places={places} />
      <p className="dm-muted hint">
        Checked <CheckedAt iso={check.checkedAt} />
      </p>
    </section>
  )
}
