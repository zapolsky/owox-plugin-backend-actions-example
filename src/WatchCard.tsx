import { ChevronRight, LoaderCircle } from 'lucide-react'
import { driverChanges, drivers, formatMetric, leadDriver, placesOf, standing, verdict, type Check, type Watch } from '../worker/watch'
import { ADVERB, granularityOf } from '../worker/period'
import { Change, Sparkline, VerdictBadge } from './CheckView'

/** The card's last line: what moved an unusual period, or where an ordinary one stands. */
function footnote(watch: Watch, latest: Check): { why: string; detail: string } | string {
  const tone = verdict(latest, watch).tone
  const lead = tone === 'bad' || tone === 'good' ? leadDriver(drivers(latest)) : null
  if (lead && lead.share >= 50) return { why: lead.top.name, detail: driverChanges(watch, lead.top) }
  return standing(latest, watch)
}

/** A watch in the list, with its latest checked period. */
export function WatchCard({
  watch,
  running,
  latest,
  onOpen,
}: {
  watch: Watch
  running: boolean
  latest: Check | undefined
  onOpen: () => void
}) {
  const result = latest ? verdict(latest, watch) : null
  const note = latest ? footnote(watch, latest) : null
  return (
    <button className="dm-card watch-card" onClick={onOpen}>
      <span className="watch-card-head">
        <span>
          <span className="watch-name">{watch.name}</span>
          <span className="dm-muted watch-source">{watch.dataMartTitle} · {ADVERB[granularityOf(watch)]}</span>
        </span>
        {running ? (
          <span className="badge">
            <LoaderCircle className="spin" size={13} aria-hidden /> Checking
          </span>
        ) : result ? (
          <VerdictBadge verdict={result} />
        ) : (
          <span className="badge">Not checked</span>
        )}
      </span>
      {latest && result && (
        <span className="watch-card-body">
          <span>
            <span className="big-value small">{formatMetric(latest.value, watch, placesOf(latest, watch))}</span>
            <span className="kpi-note">
              <Change value={latest.change} tone={result.tone} /> vs {formatMetric(latest.previousValue, watch, placesOf(latest, watch))}
            </span>
          </span>
          <Sparkline weeks={latest.weeks} usual={watch.rule.kind === 'unusual' ? latest.usual : null} tone={result.tone} />
        </span>
      )}
      <span className="watch-card-foot dm-muted">
        <span>
          {running ? (
            'The result is saved here when the check ends.'
          ) : note === null ? (
            'Not checked yet.'
          ) : typeof note === 'string' ? (
            note
          ) : (
            <>
              Why: <strong>{note.why}</strong> · {note.detail}
            </>
          )}
        </span>
        <ChevronRight size={16} aria-hidden />
      </span>
    </button>
  )
}
