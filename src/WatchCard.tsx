import { ChevronRight } from 'lucide-react'
import { formatRange, formatValue, type Check, type Watch } from '../worker/watch'
import { Change, Sparkline, StatusBadge } from './CheckView'

/** A watch in the list, with its latest checked week. */
export function WatchCard({ watch, latest, onOpen }: { watch: Watch; latest: Check | undefined; onOpen: () => void }) {
  const ratio = watch.denominator !== null
  return (
    <button className="dm-card watch-card" onClick={onOpen}>
      <span className="watch-card-head">
        <span>
          <span className="watch-name">{watch.name}</span>
          <span className="dm-muted watch-source">{watch.dataMartTitle}</span>
        </span>
        {latest ? <StatusBadge alert={latest.alert} /> : <span className="badge">Not checked</span>}
      </span>
      {latest && (
        <span className="watch-card-body">
          <span>
            <span className="big-value small">{formatValue(latest.value, ratio)}</span>
            <span className="kpi-note">
              <Change value={latest.change} /> {formatRange(latest.from, latest.to)}
            </span>
          </span>
          <Sparkline weeks={latest.weeks} alert={latest.alert} />
        </span>
      )}
      <span className="watch-card-foot dm-muted">
        {watch.rule.kind === 'unusual' ? 'Alerts on unusual weeks' : `Alerts on a ${watch.rule.percent}% change`}
        <ChevronRight size={16} aria-hidden />
      </span>
    </button>
  )
}
