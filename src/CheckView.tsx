import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { CircleCheck, Minus, TrendingDown, TrendingUp, TriangleAlert } from 'lucide-react'
import {
  formatRange,
  formatValue,
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
function WeeksChart({ check, ratio }: { check: Check; ratio: boolean }) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const { weeks, usual } = check
  const values = weeks.flatMap(week => (week.value === null ? [] : [week.value]))
  if (values.length === 0) return null

  const bounds = [...values, ...(usual ? [usual.low, usual.high] : [])]
  const pad = (Math.max(...bounds) - Math.min(...bounds)) * 0.1 || Math.abs(bounds[0]) * 0.1 || 1
  const [min, max] = [Math.min(...bounds) - pad, Math.max(...bounds) + pad]
  const scale = ticks(min, max)
  const labels = scale.map(tick => formatValue(tick, ratio))
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
          aria-label={`${check.name} by week: ${weeks.map(week => `${shortDay(week.from)} ${formatValue(week.value, ratio)}`).join(', ')}`}
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
            {check.name} {formatValue(hovered.value, ratio)}
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
          <i aria-hidden /> Usual range {formatValue(usual.low, ratio)}–{formatValue(usual.high, ratio)}, from the eight weeks before
        </figcaption>
      )}
    </figure>
  )
}

/** Each value's part of the change as a bar left (down) or right (up) of zero. */
function Drivers({ breakdown, watch, change }: { breakdown: Breakdown; watch: Watch; change: number }) {
  const ratio = watch.denominator !== null
  const largest = Math.max(...breakdown.segments.map(segment => Math.abs(segment.contribution)), Number.EPSILON)
  return (
    <section className="drivers" aria-labelledby={`by-${breakdown.dimension}`}>
      <h3 id={`by-${breakdown.dimension}`}>By {breakdown.dimension}</h3>
      {breakdown.segments.length === 0 ? (
        <p className="dm-muted hint">Nothing to compare with the week before.</p>
      ) : (
        <ul>
          {breakdown.segments.map(segment => {
            const width = `${(Math.abs(segment.contribution) / largest) * 50}%`
            const sides = [
              segment.denominatorChange === null ? null : `${watch.denominator} ${signedPercent(segment.denominatorChange)}`,
              segment.numeratorChange === null ? null : `${watch.numerator} ${signedPercent(segment.numeratorChange)}`,
            ].filter(Boolean)
            return (
              <li key={segment.name}>
                <span className="driver-name">
                  {segment.name}
                  {sides.length > 0 && <span className="dm-muted">{sides.join(' · ')}</span>}
                </span>
                <span className="driver-bar" aria-hidden>
                  <span
                    className={segment.contribution < 0 ? 'down' : 'up'}
                    style={segment.contribution < 0 ? { right: '50%', width } : { left: '50%', width }}
                  />
                </span>
                <span className="driver-value">
                  {signed(segment.contribution, ratio)}
                  {/* A share only for values that moved the metric the way it went, so the shares read as parts of it. */}
                  {segment.contribution * change > 0 && (
                    <span className="dm-muted"> {Math.round((segment.contribution / change) * 100)}%</span>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** One checked week: the value, the usual range, and what moved it. */
export function CheckView({ check, watch }: { check: Check; watch: Watch }) {
  const ratio = watch.denominator !== null
  const change = check.value !== null && check.previousValue !== null ? check.value - check.previousValue : 0
  return (
    <section className="dm-card" aria-labelledby="check-title">
      <div className="headline">
        <div>
          <div id="check-title" className="kpi-label">
            {check.name} · {formatRange(check.from, check.to)}
          </div>
          <div className="big-value">{formatValue(check.value, ratio)}</div>
          <div className="kpi-note">
            <Change value={check.change} /> vs {formatValue(check.previousValue, ratio)} the week before
          </div>
        </div>
        <StatusBadge alert={check.alert} />
      </div>
      <p className={check.alert ? 'reason alert-text' : 'reason dm-muted'}>{check.reason}</p>
      <WeeksChart check={check} ratio={ratio} />
      <p className="quote">{check.text}</p>
      {check.breakdowns.length > 0 && (
        <>
          <h2 className="section-title">Why it changed</h2>
          <div className="drivers-grid">
            {check.breakdowns.map(breakdown => (
              <Drivers key={breakdown.dimension} breakdown={breakdown} watch={watch} change={change} />
            ))}
          </div>
        </>
      )}
      <p className="dm-muted hint">
        Checked <CheckedAt iso={check.checkedAt} />
      </p>
    </section>
  )
}
