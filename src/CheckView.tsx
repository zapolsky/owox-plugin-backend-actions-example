import { useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
import { CircleCheck, Lightbulb, Minus, TrendingDown, TrendingUp, TriangleAlert } from 'lucide-react'
import {
  drivers,
  explain,
  formatDelta,
  formatMetric,
  formatRange,
  leadDriver,
  placesOf,
  shareOf,
  signedPercent,
  standing,
  verdict,
  type Check,
  type Verdict,
  type Watch,
  type Week,
} from '../worker/watch'
import { chartLayout, chartWeeks, shortDay } from '../worker/chart'

/** `15 Oct, 16:29` in the member's time zone. */
export function CheckedAt({ iso }: { iso: string }) {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** A percent change, coloured by what it means for the watch rather than by its sign. */
export function Change({ value, tone }: { value: number | null; tone: Verdict['tone'] }) {
  if (value === null) return <span className="change">—</span>
  const Icon = value > 0 ? TrendingUp : value < 0 ? TrendingDown : Minus
  return (
    <span className={`change ${tone}`}>
      <Icon size={14} aria-hidden />
      {signedPercent(value)}
    </span>
  )
}

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const Icon = verdict.tone === 'bad' ? TriangleAlert : verdict.tone === 'good' ? TrendingUp : CircleCheck
  return (
    <span className={`badge ${verdict.tone}`}>
      {verdict.tone !== 'none' && <Icon size={13} aria-hidden />}
      {verdict.label}
    </span>
  )
}

/** Weekly values as a small line over the usual range; the last dot is the checked week. */
export function Sparkline({ weeks, usual, tone }: { weeks: Week[]; usual: Check['usual']; tone: Verdict['tone'] }) {
  const known = weeks.flatMap((week, i) => (week.value === null ? [] : [{ i, value: week.value }]))
  if (known.length < 2) return null
  const values = [...known.map(point => point.value), ...(usual ? [usual.low, usual.high] : [])]
  const [min, max] = [Math.min(...values), Math.max(...values)]
  const x = (i: number) => 4 + (i / (weeks.length - 1)) * 124
  const y = (value: number) => 44 - (max === min ? 20 : ((value - min) / (max - min)) * 40)
  const last = known.at(-1)!
  return (
    <svg className="sparkline" viewBox="0 0 132 48" aria-hidden>
      {usual && <rect className="usual" x="0" width="132" y={y(usual.high)} height={y(usual.low) - y(usual.high)} rx="4" />}
      <polyline points={known.map(point => `${x(point.i)},${y(point.value)}`).join(' ')} />
      <circle className={tone} cx={x(last.i)} cy={y(last.value)} r="3.5" />
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

const CHART_HEIGHT = 260

/**
 * The checked weeks, oldest first, each over its own usual range: the range moves as the weeks
 * before it change. Alerts are red, good news green; hovering shows a week, clicking opens it.
 */
export function HistoryChart({
  checks,
  watch,
  selected,
  onSelect,
}: {
  checks: Check[]
  watch: Watch
  selected: Check
  onSelect: (asOf: string) => void
}) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const places = placesOf(selected, watch)
  const at = checks.indexOf(selected)
  const layout = chartLayout({ format: watch.format, places, weeks: chartWeeks(checks, watch), selected: at }, width, CHART_HEIGHT)
  if (!layout) return null
  const { top, right, bottom, left, column, x, y, scale, points } = layout

  const indexAt = (event: MouseEvent<SVGSVGElement>) => {
    const offset = event.clientX - event.currentTarget.getBoundingClientRect().left
    return Math.min(checks.length - 1, Math.max(0, Math.floor((offset - left) / column)))
  }
  const hovered = hover === null ? null : checks[hover]

  return (
    <figure className="weeks-chart" ref={ref}>
      {width > 0 && (
        <svg
          width={width}
          height={CHART_HEIGHT}
          role="img"
          aria-label={`${watch.name} by week: ${checks.map(check => `${shortDay(check.from)} ${formatMetric(check.value, watch, places)}`).join(', ')}`}
          onPointerMove={event => setHover(indexAt(event))}
          onPointerLeave={() => setHover(null)}
          onClick={event => onSelect(checks[indexAt(event)].asOf)}
        >
          {at >= 0 && <rect className="selected" x={left + at * column} width={column} y={top - 6} height={bottom - top + 12} rx="6" />}
          {checks.map((check, i) => {
            const usual = watch.rule.kind === 'unusual' ? check.usual : null
            return usual ? (
              <rect
                key={`usual-${check.asOf}`}
                className="usual"
                x={left + i * column}
                width={column}
                y={y(usual.high)}
                height={Math.max(1, y(usual.low) - y(usual.high))}
              />
            ) : null
          })}
          {scale.map(tick => (
            <g key={tick.value}>
              <line className="grid" x1={left} x2={width - right} y1={y(tick.value)} y2={y(tick.value)} />
              <text className="tick" x={left - 8} y={y(tick.value)} dy="0.32em" textAnchor="end">
                {tick.label}
              </text>
            </g>
          ))}
          {checks.map((check, i) =>
            layout.dated(i) ? (
              <text key={check.asOf} className={i === at ? 'tick current' : 'tick'} x={x(i)} y={CHART_HEIGHT - 6} textAnchor="middle">
                {shortDay(check.from)}
              </text>
            ) : null,
          )}
          <polyline className="line" points={points.map(point => `${x(point.i)},${y(point.value)}`).join(' ')} />
          {points.map(point => (
            <circle
              key={point.i}
              className={`point ${point.tone}`}
              cx={x(point.i)}
              cy={y(point.value)}
              r={point.i === at || point.i === hover ? 6 : point.tone === 'bad' || point.tone === 'good' ? 5 : 3.5}
            />
          ))}
        </svg>
      )}
      {hovered && hover !== null && (
        // Beside the point, towards the middle, so it covers neither the point nor its neighbours' line.
        <div
          className={x(hover) > width / 2 ? 'chart-tip left' : 'chart-tip'}
          style={{ left: x(hover), top: Math.min(bottom - 60, Math.max(top + 60, hovered.value === null ? top : y(hovered.value))) }}
          aria-hidden
        >
          <span className="dm-muted">{formatRange(hovered.from, hovered.to)}</span>
          <strong>
            {watch.name} {formatMetric(hovered.value, watch, places)}
          </strong>
          {hovered.change !== null && (
            <span>
              <Change value={hovered.change} tone={verdict(hovered, watch).tone} /> vs the week before
            </span>
          )}
          <span>{standing(hovered, watch)}</span>
        </div>
      )}
    </figure>
  )
}

/** The checked weeks as buttons, oldest first: the chart's points, readable and reachable by keyboard. */
export function WeekStrip({
  checks,
  watch,
  selected,
  onSelect,
}: {
  checks: Check[]
  watch: Watch
  selected: Check
  onSelect: (asOf: string) => void
}) {
  const places = placesOf(selected, watch)
  const ref = useRef<HTMLDivElement>(null)
  // The newest weeks are on the right: keep the selected one in view when the strip scrolls.
  useLayoutEffect(() => {
    const strip = ref.current
    const button = strip?.querySelector<HTMLElement>('.week.selected')
    if (!strip || !button) return
    if (button.offsetLeft + button.offsetWidth > strip.scrollLeft + strip.clientWidth || button.offsetLeft < strip.scrollLeft) {
      strip.scrollLeft = button.offsetLeft + button.offsetWidth - strip.clientWidth
    }
  }, [selected])
  return (
    <div className="week-strip" role="group" aria-label="Checked weeks" ref={ref}>
      {checks.map(check => {
        const result = verdict(check, watch)
        return (
          <button
            key={check.asOf}
            className={check === selected ? 'week selected' : 'week'}
            aria-pressed={check === selected}
            aria-label={`${formatRange(check.from, check.to)}: ${formatMetric(check.value, watch, places)}, ${result.label}`}
            onClick={() => onSelect(check.asOf)}
          >
            <span className="week-day">
              <i className={`dot ${result.tone}`} aria-hidden />
              {shortDay(check.from)}
            </span>
            <span className="week-value">{formatMetric(check.value, watch, places)}</span>
            <Change value={check.change} tone={result.tone} />
          </button>
        )
      })}
    </div>
  )
}

/** The checked week's value and where it stands. */
export function WeekKpi({ check, watch }: { check: Check; watch: Watch }) {
  const places = placesOf(check, watch)
  const result = verdict(check, watch)
  return (
    <section className="dm-card kpi-card" aria-labelledby="kpi-title">
      <span id="kpi-title" className="kpi-label">
        {formatRange(check.from, check.to)}
      </span>
      <span className="big-value">{formatMetric(check.value, watch, places)}</span>
      <span className="kpi-note">
        <Change value={check.change} tone={result.tone} /> vs {formatMetric(check.previousValue, watch, places)} the week before
      </span>
      <span className={`badge large ${result.tone}`}>
        {result.tone === 'bad' ? <TriangleAlert size={14} aria-hidden /> : result.tone === 'good' ? <TrendingUp size={14} aria-hidden /> : null}
        {standing(check, watch)}
      </span>
    </section>
  )
}

/** The week's change in words: what drove it and what each column adds. */
export function WhatHappened({ check, watch }: { check: Check; watch: Watch }) {
  const explanation = explain(check, watch)
  const fallback =
    check.value === null
      ? check.reason
      : check.previousValue === null
        ? 'No week before to compare with.'
        : `${watch.name} moved ${signedPercent(check.change ?? 0)} against the week before, too little to name a cause.`
  return (
    <section className="happened" aria-labelledby="happened-title">
      <span id="happened-title" className="happened-label">
        <Lightbulb size={16} aria-hidden /> What happened
      </span>
      <p className="happened-headline">{explanation?.headline ?? fallback}</p>
      {explanation && explanation.points.length > 0 && (
        <ul>
          {explanation.points.map(point => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** A column's percent change, bold when it moved by a quarter or more. */
function Percent({ value }: { value: number | null }) {
  if (value === null) return <span className="dm-muted">—</span>
  return <span className={Math.abs(value) >= 25 ? 'big-change' : undefined}>{signedPercent(value)}</span>
}

/** Which values of one column moved the metric, a column at a time, starting with the one the headline names. */
export function WhyItChanged({ check, watch }: { check: Check; watch: Watch }) {
  const places = placesOf(check, watch)
  const ratio = watch.denominator !== null
  const change = check.value !== null && check.previousValue !== null ? check.value - check.previousValue : 0
  const found = drivers(check)
  const [dimension, setDimension] = useState(() => leadDriver(found)?.dimension ?? check.breakdowns[0]?.dimension)
  const selected = check.breakdowns.find(breakdown => breakdown.dimension === dimension) ?? check.breakdowns[0]
  if (!selected) return null
  const largest = Math.max(...selected.segments.map(segment => Math.abs(segment.contribution)), Number.EPSILON)
  const leadOf = (name: string) => {
    const driver = found.find(item => item.dimension === name)
    if (!driver) return 'Nothing to name'
    return driver.share >= 50 ? driver.top.name : 'No single value'
  }
  const goodWeek = verdict(check, watch).tone === 'good'

  return (
    <section className="dm-card" aria-labelledby="why-title">
      <h2 id="why-title" className="card-title">
        Why it changed
      </h2>
      {selected.segments.length === 0 ? (
        <p className="dm-muted hint flush">Nothing to compare with the week before.</p>
      ) : (
        <>
          <p className="dm-muted hint flush">
            How much each {selected.dimension} moved {watch.name} from {formatMetric(check.previousValue, watch, places)} to{' '}
            {formatMetric(check.value, watch, places)}. The parts add up to {formatDelta(change, watch, places)}.
          </p>
          {check.breakdowns.length > 1 && (
            <div className="dimension-tabs" role="group" aria-label="Explain by">
              {check.breakdowns.map(breakdown => (
                <button key={breakdown.dimension} aria-pressed={breakdown === selected} onClick={() => setDimension(breakdown.dimension)}>
                  <span className="dm-muted">{breakdown.dimension}</span>
                  <strong>{leadOf(breakdown.dimension)}</strong>
                </button>
              ))}
            </div>
          )}
          <div className="table-wrap">
            <table className="why-table">
              <thead>
                <tr>
                  <th scope="col">{selected.dimension}</th>
                  <th scope="col" className="num">
                    {watch.name}, before → now
                  </th>
                  {ratio && (
                    <th scope="col" className="num">
                      {watch.denominator}
                    </th>
                  )}
                  <th scope="col" className="num">
                    {ratio ? watch.numerator : 'Change'}
                  </th>
                  <th scope="col">Part of the change</th>
                </tr>
              </thead>
              <tbody>
                {selected.segments.map(segment => {
                  const part = shareOf(segment, selected.segments, change)
                  const width = `${(Math.abs(segment.contribution) / largest) * 50}%`
                  const impact = formatDelta(segment.contribution, watch, places)
                  const zero = !/[1-9]/.test(impact)
                  // Green when the value pushed the watch the good way, by its rise setting; red when the bad way.
                  const helped = segment.contribution > 0 === ((watch.rise ?? 'good') === 'good')
                  return (
                    <tr key={segment.name} className={part !== null && part >= 50 && !goodWeek ? 'driver' : undefined}>
                      <th scope="row">{segment.name}</th>
                      <td className="num">
                        {segment.value === null && segment.previousValue === null ? (
                          <span className="dm-muted">—</span>
                        ) : (
                          <>
                            <span className="dm-muted">{formatMetric(segment.previousValue, watch, places)} → </span>
                            {formatMetric(segment.value, watch, places)}
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
                            {!zero && (
                              <span
                                className={helped ? 'good' : 'bad'}
                                style={segment.contribution < 0 ? { right: '50%', width } : { left: '50%', width }}
                              />
                            )}
                          </span>
                          <span className="num">
                            {impact}
                            {part !== null && part > 0 && !zero && <span className="dm-muted"> · {part}%</span>}
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
      <p className="dm-muted hint">
        Checked <CheckedAt iso={check.checkedAt} />
      </p>
    </section>
  )
}
