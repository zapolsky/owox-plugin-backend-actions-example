import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, CalendarClock, Ellipsis, FileUp, LoaderCircle, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import type { PluginSchedule } from '@owox/plugin-sdk'
import { CHART_PERIODS } from '../worker/chart'
import { exportTarget } from '../worker/google'
import { ADVERB, count, FIRST_CHECK, granularityOf, periodLabel, SCHEDULES, type Granularity } from '../worker/period'
import { verdict, type Check, type Watch } from '../worker/watch'
import { CheckedAt, HistoryChart, WeekKpi, WeekStrip, WhatHappened, WhyItChanged } from './CheckView'

export type ScheduleChange = 'create' | 'pause' | 'resume' | 'delete'

const formula = (watch: Watch) => (watch.denominator ? `${watch.numerator} ÷ ${watch.denominator}` : `sum of ${watch.numerator}`)

const ruleText = (watch: Watch) => {
  const unit = granularityOf(watch)
  if (watch.rule.kind === 'change') {
    return `alerts on a change of more than ${watch.rule.percent}% ${
      watch.rule.direction === 'any' ? 'either way' : watch.rule.direction
    } against the ${unit} before`
  }
  const side = (watch.rise ?? 'good') === 'good' ? 'falls below' : 'rises above'
  const sensitivity = { low: ', fewer alerts', medium: '', high: ', more alerts' }[watch.sensitivity ?? 'medium']
  return `alerts when a ${unit} ${side} its usual range${sensitivity}`
}

/** Closes a popover on a press outside it. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const press = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) close()
    }
    document.addEventListener('pointerdown', press)
    return () => document.removeEventListener('pointerdown', press)
  }, [open, close])
  return ref
}

/** Sends the selected period to a Google Doc or Sheet; a pasted link picks which. */
function ExportMenu({ range, unit, onExport }: { range: string; unit: Granularity; onExport: (link: string) => Promise<string> }) {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<'Doc' | 'Sheet'>('Doc')
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const close = () => setOpen(false)
  // Each opening starts empty, so a finished export cannot be sent twice by accident.
  const toggle = () => {
    if (!open) {
      setLink('')
      setResult(null)
    }
    setOpen(!open)
  }
  const ref = useDismiss(open, close)

  const paste = (value: string) => {
    setLink(value)
    setResult(null)
    const target = exportTarget(value)
    if (target) setKind(target.action === 'export-check-to-doc' ? 'Doc' : 'Sheet')
  }
  const submit = () => {
    setBusy(true)
    setResult(null)
    onExport(link)
      .then(
        text => setResult({ ok: true, text }),
        (failure: unknown) => setResult({ ok: false, text: failure instanceof Error ? failure.message : String(failure) }),
      )
      .finally(() => setBusy(false))
  }

  return (
    <div className="menu-anchor" ref={ref}>
      <button className="button secondary" aria-expanded={open} onClick={toggle}>
        <FileUp size={16} aria-hidden /> Export
      </button>
      {open && (
        // Not a form: the plugin frame's sandbox blocks form submission.
        <div className="popover" role="dialog" aria-label={`Export ${range}`} onKeyDown={event => event.key === 'Escape' && close()}>
          <strong>Export {range}</strong>
          <div className="segmented wide" role="group" aria-label="Export to">
            {(['Doc', 'Sheet'] as const).map(item => (
              <button key={item} aria-pressed={kind === item} onClick={() => setKind(item)}>
                Google {item}
              </button>
            ))}
          </div>
          <label className="field">
            Link to the {kind}
            <input
              type="url"
              autoFocus
              value={link}
              onChange={event => paste(event.target.value)}
              placeholder={`https://docs.google.com/${kind === 'Doc' ? 'document' : 'spreadsheets'}/d/…`}
            />
          </label>
          <p className="dm-muted hint flush">
            Share the {kind} with the plugin's service account first. The {unit} is added {kind === 'Doc' ? 'at the end' : 'as a row'}.
          </p>
          {result && (
            <p role={result.ok ? 'status' : 'alert'} className={result.ok ? 'dm-muted flush' : 'alert'}>
              {result.text}
            </p>
          )}
          <div className="actions end">
            <button className="button secondary" onClick={close}>
              {result?.ok ? 'Close' : 'Cancel'}
            </button>
            <button className="button" onClick={submit} disabled={busy || !link.trim()}>
              {busy && <LoaderCircle className="spin" size={16} aria-hidden />} Add to {kind}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const stoppedBecause: Record<NonNullable<PluginSchedule['disabledReason']>, string> = {
  OWNER_NOT_MEMBER: 'the member who installed Metric Watch left the project',
  ACTION_NOT_DECLARED: 'this version of Metric Watch no longer checks metrics',
  INVALID_PARAMETERS: 'this version of Metric Watch no longer accepts this watch',
}

/** The watch's scheduled check, which OWOX runs with the plugin closed. */
function ScheduleMenu({
  schedule,
  granularity,
  onChange,
}: {
  schedule: PluginSchedule | undefined
  granularity: Granularity
  onChange: (change: ScheduleChange) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const close = () => setOpen(false)
  const ref = useDismiss(open, close)
  const change = (next: ScheduleChange) => {
    setBusy(true)
    void onChange(next).finally(() => setBusy(false))
  }
  const last = schedule?.lastRun

  return (
    <div className="menu-anchor" ref={ref}>
      <button className="button secondary" aria-expanded={open} onClick={() => setOpen(!open)}>
        <CalendarClock size={16} aria-hidden /> {!schedule ? 'Schedule' : schedule.enabled ? ADVERB[granularity] : schedule.disabledReason ? 'Stopped' : 'Paused'}
      </button>
      {open && (
        <div className="popover" role="dialog" aria-label={`${ADVERB[granularity]} check`} onKeyDown={event => event.key === 'Escape' && close()}>
          <strong>{ADVERB[granularity]} check</strong>
          {schedule ? (
            <>
              <p className="dm-muted hint flush">
                {SCHEDULES[granularity].when}, {schedule.timeZone}.{' '}
                {schedule.enabled && schedule.nextRunAt ? (
                  <>
                    Next check <CheckedAt iso={schedule.nextRunAt} />.
                  </>
                ) : schedule.disabledReason ? (
                  `Stopped: ${stoppedBecause[schedule.disabledReason]}.`
                ) : (
                  'Paused.'
                )}
              </p>
              {last && (
                <p className="dm-muted hint flush">
                  Last run {last.status.toLowerCase().replace('_', ' ')}
                  {last.finishedAt && (
                    <>
                      {' '}
                      <CheckedAt iso={last.finishedAt} />
                    </>
                  )}
                  {last.errorCode && ` (${last.errorCode})`}.
                </p>
              )}
              <div className="actions end">
                <button className="button danger" onClick={() => change('delete')} disabled={busy}>
                  Delete
                </button>
                <button className="button secondary" onClick={() => change(schedule.enabled ? 'pause' : 'resume')} disabled={busy}>
                  {schedule.enabled ? 'Pause' : 'Resume'}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="dm-muted hint flush">
                {SCHEDULES[granularity].when}, your time, check the last {granularity}. The plugin can stay closed: the result is saved here.
              </p>
              <div className="actions end">
                <button className="button" onClick={() => change('create')} disabled={busy}>
                  {busy && <LoaderCircle className="spin" size={16} aria-hidden />} Check {ADVERB[granularity].toLowerCase()}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** Edit and Delete, behind one button; Delete asks once. */
function MoreMenu({
  name,
  checks,
  unit,
  onEdit,
  onDelete,
}: {
  name: string
  checks: number
  unit: Granularity
  onEdit: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const close = () => {
    setOpen(false)
    setConfirming(false)
  }
  const ref = useDismiss(open, close)
  return (
    <div className="menu-anchor" ref={ref}>
      <button className="button secondary icon" aria-label="More actions" aria-expanded={open} onClick={() => (open ? close() : setOpen(true))}>
        <Ellipsis size={18} aria-hidden />
      </button>
      {open && (
        <div className="popover menu" onKeyDown={event => event.key === 'Escape' && close()}>
          {confirming ? (
            <>
              <p className="flush">
                Delete {name} and its {checks} checked {checks === 1 ? unit : `${unit}s`}?
              </p>
              <div className="actions end">
                <button className="button secondary" onClick={() => setConfirming(false)}>
                  Keep
                </button>
                <button className="button danger" onClick={onDelete}>
                  Delete
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                className="menu-item"
                onClick={() => {
                  close()
                  onEdit()
                }}
              >
                <Pencil size={16} aria-hidden /> Edit watch
              </button>
              <button className="menu-item danger" onClick={() => setConfirming(true)}>
                <Trash2 size={16} aria-hidden /> Delete watch…
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** One watch: the selected period (the latest by default), what happened, the last periods and why it changed. */
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
  onEdit,
  onDelete,
  onExport,
  schedule,
  onSchedule,
}: {
  watchId: string
  watch: Watch | null
  history: Check[]
  asOf: string | undefined
  running: boolean
  error: ReactNode
  /** Undefined on a host without schedules. */
  onSchedule: ((change: ScheduleChange) => Promise<void>) | undefined
  schedule: PluginSchedule | undefined
  onBack: () => void
  onSelect: (asOf: string) => void
  onCheck: () => void
  onCancel: () => void
  onEdit: () => void
  onDelete: () => void
  onExport: (checkId: string, link: string) => Promise<string>
}) {
  const selected = history.find(check => check.asOf === asOf) ?? history[0]
  const recent = history.slice(0, CHART_PERIODS).reverse()
  const alerts = watch ? recent.filter(check => verdict(check, watch).tone === 'bad').length : 0
  const unit = granularityOf(watch)

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
              {watch.dataMartTitle} · {formula(watch)} · {ruleText(watch)}
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
          {watch && selected && (
            <ExportMenu
              key={selected.asOf}
              range={periodLabel(unit, selected.from, selected.to)}
              unit={unit}
              onExport={link => onExport(`${watchId}~${selected.asOf}`, link)}
            />
          )}
          {watch && onSchedule && <ScheduleMenu schedule={schedule} granularity={unit} onChange={onSchedule} />}
          {watch && <MoreMenu name={watch.name} checks={history.length} unit={unit} onEdit={onEdit} onDelete={onDelete} />}
        </div>
      </header>
      <main className="dm-page-content">
        {error}
        {running && (
          <p className="dm-card status" role="status">
            <LoaderCircle className="spin" size={16} aria-hidden />
            Checking {history.length === 0 ? `the last ${count(FIRST_CHECK[unit], unit)}` : `the last ${unit}`}. You can close the plugin: the result is saved
            here.
          </p>
        )}
        {watch && selected ? (
          <>
            <div className="hero">
              <WeekKpi check={selected} watch={watch} />
              <WhatHappened check={selected} watch={watch} />
            </div>
            <section className="dm-card" aria-labelledby="weeks-title">
              <div className="card-head">
                <h2 id="weeks-title" className="card-title">
                  Last {count(recent.length, unit)}
                  <span className="dm-muted">
                    {alerts} {alerts === 1 ? 'alert' : 'alerts'}
                  </span>
                </h2>
                <p className="legend dm-muted">
                  <span>
                    <i className="line" aria-hidden /> {watch.name}
                  </span>
                  {watch.rule.kind === 'unusual' && (
                    <span>
                      <i className="band" aria-hidden /> Usual range of each {unit}
                    </span>
                  )}
                  <span>
                    <i className="dot bad" aria-hidden /> Alert
                  </span>
                  {watch.rule.kind === 'unusual' && (
                    <span>
                      <i className="dot good" aria-hidden /> Good news
                    </span>
                  )}
                </p>
              </div>
              <HistoryChart checks={recent} watch={watch} selected={selected} onSelect={onSelect} />
              <WeekStrip checks={recent} watch={watch} selected={selected} onSelect={onSelect} />
            </section>
            <WhyItChanged key={`${watchId}~${selected.asOf}`} check={selected} watch={watch} />
          </>
        ) : (
          !running && <section className="dm-card empty dm-muted">No checked {unit}s yet. Check now to see the last one.</section>
        )}
      </main>
    </div>
  )
}
