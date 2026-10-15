import { Fragment } from 'react'
import { CalendarDays, MapPin, Minus, TrendingDown, TrendingUp, Wallet } from 'lucide-react'
import { amount, dayLabel, formatRange } from '../worker/digest'
import type { SavedDigest } from '../worker/index'

/** `15 Oct, 16:29` in the member's time zone. */
export function WrittenAt({ iso }: { iso: string }) {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function Change({ value }: { value: number | null }) {
  if (value === null) return <span className="change">no week before</span>
  const [Icon, kind] =
    value > 0 ? [TrendingUp, 'up'] : value < 0 ? [TrendingDown, 'down'] : [Minus, 'flat']
  return (
    <span className={`change ${kind}`} aria-label={`${kind} ${Math.abs(value)}%`}>
      <Icon size={14} aria-hidden />
      {Math.abs(value)}%
    </span>
  )
}

/** The latest digest: four figures, revenue by city for both weeks, and the digest text. */
export function DigestCard({ digest, createdAt }: { digest: SavedDigest; createdAt: string }) {
  const { topCity, fall, bestDay, cities } = digest
  const max = Math.max(1, ...(cities ?? []).flatMap(city => [city.revenue, city.previousRevenue]))
  const width = (value: number) => ({ width: `${(value / max) * 100}%` })

  return (
    <section className="dm-card" aria-labelledby="latest-title">
      <h2 id="latest-title" className="card-title">
        {digest.title} · {formatRange(digest.from, digest.to)}
        <span className="dm-muted">
          Written <WrittenAt iso={createdAt} />
        </span>
      </h2>

      {topCity && bestDay && cities && (
        <>
          <div className="kpis">
            <div className="kpi">
              <div className="kpi-label">
                <Wallet size={14} aria-hidden /> Revenue
              </div>
              <div className="kpi-value">{amount(digest.revenue)}</div>
              <div className="kpi-note">
                <Change value={digest.change} /> vs {amount(digest.previousRevenue)}
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-label">
                <MapPin size={14} aria-hidden /> Top city
              </div>
              <div className="kpi-value">{topCity.city}</div>
              <div className="kpi-note">
                {amount(topCity.revenue)} <Change value={topCity.change} />
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-label">
                <TrendingDown size={14} aria-hidden /> Biggest fall
              </div>
              <div className="kpi-value">{fall ? fall.city : 'None'}</div>
              <div className="kpi-note">
                {fall ? (
                  <>
                    {amount(fall.revenue)} <Change value={fall.change} />
                  </>
                ) : (
                  'No city fell'
                )}
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-label">
                <CalendarDays size={14} aria-hidden /> Best day
              </div>
              <div className="kpi-value">{dayLabel(bestDay.day, true)}</div>
              <div className="kpi-note">{amount(bestDay.revenue)}</div>
            </div>
          </div>

          <div className="bars-head">
            Revenue by city
            <span className="legend">
              <span>
                <i aria-hidden />
                This week
              </span>
              <span>
                <i className="previous" aria-hidden />
                Week before
              </span>
            </span>
          </div>
          <div className="bars">
            {cities.map(city => (
              <Fragment key={city.city}>
                <span>{city.city}</span>
                <div className="bar-pair">
                  <div className="bar">
                    <span style={width(city.revenue)} />
                    {amount(city.revenue)}
                  </div>
                  <div className="bar previous">
                    <span style={width(city.previousRevenue)} />
                    {amount(city.previousRevenue)}
                  </div>
                </div>
              </Fragment>
            ))}
          </div>
        </>
      )}

      <p className="quote">{digest.text}</p>
    </section>
  )
}
