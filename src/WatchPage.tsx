import { useState, type ReactNode } from 'react'
import { ArrowLeft, LoaderCircle, RefreshCw, Trash2 } from 'lucide-react'
import { formatRange, formatValue, type Check, type Watch } from '../worker/watch'
import { Change, CheckView, StatusBadge } from './CheckView'

const ruleText = (watch: Watch) =>
  watch.rule.kind === 'unusual'
    ? 'Alerts when a week is outside the usual range of the eight weeks before.'
    : `Alerts when it changes by more than ${watch.rule.percent}% ${
        watch.rule.direction === 'any' ? 'either way' : watch.rule.direction
      } against the week before.`

/** One watch: the selected week (the latest by default) and the history of checked weeks. */
export function WatchPage({
  watchId,
  watch,
  history,
  asOf,
  running,
  error,
  onBack,
  onSelect,
  onCheck,
  onCancel,
  onDelete,
}: {
  watchId: string
  watch: Watch | null
  history: Check[]
  asOf: string | undefined
  running: boolean
  error: ReactNode
  onBack: () => void
  onSelect: (asOf: string) => void
  onCheck: () => void
  onCancel: () => void
  onDelete: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const selected = history.find(check => check.asOf === asOf) ?? history[0]
  const alerts = history.filter(check => check.alert).length

  return (
    <div className="dm-page">
      <header className="dm-page-header with-action">
        <div>
          <button className="link" onClick={onBack}>
            <ArrowLeft size={14} aria-hidden /> All watches
          </button>
          <h1 className="dm-page-header-title">{watch?.name ?? 'Watch'}</h1>
          {watch && (
            <p className="dm-muted subtitle">
              {watch.dataMartTitle} · {ruleText(watch)}
            </p>
          )}
        </div>
        <div className="actions">
          {running ? (
            <button className="button secondary" onClick={onCancel}>
              Cancel check
            </button>
          ) : (
            <button className="button" onClick={onCheck} disabled={!watch}>
              <RefreshCw size={16} aria-hidden /> Check now
            </button>
          )}
          {confirming ? (
            <>
              <button className="button danger" onClick={onDelete}>
                Delete watch and history
              </button>
              <button className="button secondary" onClick={() => setConfirming(false)}>
                Keep
              </button>
            </>
          ) : (
            <button className="button secondary icon" onClick={() => setConfirming(true)} aria-label="Delete watch">
              <Trash2 size={16} aria-hidden />
            </button>
          )}
        </div>
      </header>
      <main className="dm-page-content">
        {error}
        {running && (
          <p className="dm-card status" role="status">
            <LoaderCircle className="spin" size={16} aria-hidden />
            Checking {history.length === 0 ? 'the last 12 weeks' : 'the last week'}. You can close the plugin: the result is
            saved here.
          </p>
        )}
        {watch && selected ? (
          <CheckView key={`${watchId}~${selected.asOf}`} check={selected} watch={watch} />
        ) : (
          !running && <section className="dm-card empty dm-muted">No checked weeks yet. Check now to see the last one.</section>
        )}
        {watch && history.length > 0 && (
          <section className="dm-card" aria-labelledby="history-title">
            <h2 id="history-title" className="card-title">
              History
              <span className="dm-muted">
                {history.length} {history.length === 1 ? 'week' : 'weeks'} · {alerts} {alerts === 1 ? 'alert' : 'alerts'}
              </span>
            </h2>
            <ul className="history">
              {history.map(check => (
                <li key={check.asOf}>
                  <button
                    className={check === selected ? 'history-row selected' : 'history-row'}
                    aria-current={check === selected ? 'true' : undefined}
                    onClick={() => {
                      onSelect(check.asOf)
                      // The week opens above the history, out of view from a row near the bottom.
                      window.scrollTo({ top: 0 })
                    }}
                  >
                    <span>{formatRange(check.from, check.to)}</span>
                    <span className="history-value">{formatValue(check.value, watch.denominator !== null)}</span>
                    <Change value={check.change} />
                    <StatusBadge alert={check.alert} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  )
}
