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

/** Nine weeks with the usual range shaded; the checked week is the last point. */
function WeeksChart({ check, ratio }: { check: Check; ratio: boolean }) {
  const { weeks, usual } = check
  const values = weeks.flatMap(week => (week.value === null ? [] : [week.value]))
  if (values.length === 0) return null
  const bounds = [...values, ...(usual ? [usual.low, usual.high] : [])]
  const pad = (Math.max(...bounds) - Math.min(...bounds)) * 0.12 || 1
  const [min, max] = [Math.min(...bounds) - pad, Math.max(...bounds) + pad]
  // Points sit 6.25% in from each side, so the HTML labels under them fit at any width.
  const [left, right, top, bottom] = [40, 600, 8, 152]
  const x = (i: number) => left + (i / (weeks.length - 1)) * (right - left)
  const y = (value: number) => bottom - ((value - min) / (max - min)) * (bottom - top)
  const points = weeks.flatMap((week, i) => (week.value === null ? [] : [{ i, value: week.value }]))
  const last = weeks.length - 1

  return (
    <figure className="weeks-chart">
      <svg
        viewBox="0 0 640 160"
        role="img"
        aria-label={`${check.name} by week: ${weeks.map(week => `${shortDay(week.from)} ${formatValue(week.value, ratio)}`).join(', ')}`}
      >
        {usual && <rect className="usual" x={left} width={right - left} y={y(usual.high)} height={y(usual.low) - y(usual.high)} rx="4" />}
        <polyline className="line" points={points.map(point => `${x(point.i)},${y(point.value)}`).join(' ')} />
        {points.map(point => (
          <circle
            key={point.i}
            className={point.i === last ? (check.alert ? 'point alert' : 'point ok') : 'point'}
            cx={x(point.i)}
            cy={y(point.value)}
            r={point.i === last ? 6 : 3.5}
          />
        ))}
      </svg>
      <div className="axis" aria-hidden>
        {weeks.map((week, i) => (
          <span key={week.from} className={i === last ? 'current' : undefined} style={{ left: `${(x(i) / 640) * 100}%` }}>
            {shortDay(week.from)}
          </span>
        ))}
      </div>
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
