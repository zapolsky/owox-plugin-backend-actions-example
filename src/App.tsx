import { useEffect, useRef, useState } from 'react'
import { Activity, ArrowLeft, Plus } from 'lucide-react'
import type { PluginCollection, PluginCollectionDocument, PluginContext, PluginSchedule } from '@owox/plugin-sdk'
import { exportTarget } from '../worker/google'
import { FIRST_CHECK, granularityOf, scheduleFor } from '../worker/period'
import { verdict, type Check, type Watch } from '../worker/watch'
import { CheckedAt } from './CheckView'
import { WatchCard } from './WatchCard'
import { WatchForm, type DataMartOption } from './WatchForm'
import { WatchPage, type ScheduleChange } from './WatchPage'

type Saved<T> = PluginCollectionDocument<T>

/**
 * A check the page started, kept on its watch: a page opened later, from anywhere, follows it until
 * it ends. The Worker reads the watch and ignores this field.
 */
type Run = { executionId: string; periods: number }
type StoredWatch = Watch & { run?: Run }

// The page keeps no storage, so where the member is lives in the plugin's route.
type Route =
  | { page: 'list' }
  | { page: 'new' }
  | { page: 'watch'; watchId: string; asOf?: string }
  | { page: 'edit'; watchId: string }

function parseRoute(path: string | undefined): Route {
  const [first, watchId, kind, value] = (path ?? '/').split('/').filter(Boolean).map(decodeURIComponent)
  if (first === 'new') return { page: 'new' }
  if (first !== 'watches' || !watchId) return { page: 'list' }
  if (kind === 'edit') return { page: 'edit', watchId }
  // `weeks` is where the links in exports made before periods point.
  if ((kind === 'periods' || kind === 'weeks') && value) return { page: 'watch', watchId, asOf: value }
  return { page: 'watch', watchId }
}

function routePath(route: Route): string {
  if (route.page === 'list') return '/'
  if (route.page === 'new') return '/new'
  const base = `/watches/${encodeURIComponent(route.watchId)}`
  if (route.page === 'edit') return `${base}/edit`
  return route.asOf ? `${base}/periods/${route.asOf}` : base
}

type Filter = 'all' | 'attention' | 'usual'

/** Every document of a collection, a page of 100 at a time. */
async function listAll<T>(collection: PluginCollection<T>): Promise<Saved<T>[]> {
  const items: Saved<T>[] = []
  let cursor: string | undefined
  do {
    const page = await collection.list({ limit: 100, ...(cursor ? { cursor } : {}) })
    items.push(...page.items)
    cursor = page.nextCursor ?? undefined
  } while (cursor)
  return items
}

/** PluginActionError and PluginTransportError are matched by code, not imported as values. */
function errorMessage(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  if (code === 'CANCELLED') return 'The check was cancelled.'
  if (code === 'TIMED_OUT') return 'The check took too long. Try again.'
  return error instanceof Error ? error.message : String(error)
}

/** The member's time zone: a check's day and a schedule's 09:00 are taken in it. */
const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone

export default function App({ ctx }: { ctx: PluginContext }) {
  const [route, setRoute] = useState(() => parseRoute(ctx.route))
  const [dataMarts, setDataMarts] = useState<DataMartOption[] | null>(null)
  const [watches, setWatches] = useState<Saved<StoredWatch>[] | null>(null)
  const [checks, setChecks] = useState<Saved<Check>[]>([])
  const [schedules, setSchedules] = useState<PluginSchedule[]>([])
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const actions = ctx.actions
  const watchStore = ctx.collections<StoredWatch>('watches')
  const checkStore = ctx.collections<Check>('checks')

  /** A watch's scheduled check: the schedule that starts `check-metric` for it. */
  const scheduleOf = (watchId: string) =>
    schedules.find(item => item.action === 'check-metric' && (item.parameters as { watchId?: unknown } | null)?.watchId === watchId)

  const go = (next: Route) => {
    setRoute(next)
    setError(null)
    ctx.ui.setRoute(routePath(next))
  }

  const reload = () =>
    Promise.all([listAll(watchStore), listAll(checkStore), ctx.schedules?.list() ?? []]).then(
      ([savedWatches, savedChecks, savedSchedules]) => {
        setWatches(savedWatches.sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
        setChecks(savedChecks)
        setSchedules(savedSchedules)
      },
      (failure: unknown) => setError(errorMessage(failure)),
    )

  useEffect(() => {
    ctx.owox.dataMarts.list().then(
      items => setDataMarts(items.map(({ id, title }) => ({ id, title })).sort((a, b) => a.title.localeCompare(b.title))),
      (failure: unknown) => setError(errorMessage(failure)),
    )
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once, when the plugin opens
  }, [])

  // Follows every running check once, including one started before the plugin last closed.
  const following = useRef(new Set<string>())
  useEffect(() => {
    if (!actions || !watches) return
    for (const { id, document } of watches) {
      const { run } = document
      if (!run || following.current.has(run.executionId)) continue
      following.current.add(run.executionId)
      actions
        .wait(run.executionId)
        .then(
          () => null,
          (failure: unknown) => errorMessage(failure),
        )
        .then(async message => {
          const latest = await watchStore.get(id)
          // Deleted meanwhile: nothing left to report.
          if (!latest) return reload()
          // Another tab may have started a newer check; that one is not this page's to clear.
          if (latest.document.run?.executionId === run.executionId) {
            const { run: _ended, ...watch } = latest.document
            await watchStore.put(id, watch)
          }
          if (message) setError(`${document.name}: ${message}`)
          return reload()
        })
        .catch((failure: unknown) => setError(errorMessage(failure)))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reacts to the saved watches only
  }, [watches])

  if (!actions) {
    return <p role="alert">This OWOX Data Marts deployment does not support backend actions.</p>
  }

  const check = async (watchId: string, watch: StoredWatch, periods: number) => {
    try {
      const { id: executionId } = await actions.start('check-metric', { watchId, periods, timeZone: timeZone() })
      await watchStore.put(watchId, { ...watch, run: { executionId, periods } })
      await reload()
    } catch (failure) {
      setError(errorMessage(failure))
    }
  }

  const exportCheck = async (checkId: string, link: string) => {
    const target = exportTarget(link)
    if (!target) throw new Error('Paste the link of a Google Doc or Sheet.')
    await actions.invoke(target.action, { checkId, ...target.input })
    return target.action === 'export-check-to-doc' ? 'Added at the end of the Doc.' : 'Added as a row of the Sheet.'
  }

  /**
   * Saves a new or edited watch. A change that makes its checked periods wrong replaces them with a
   * fresh first check; a new watch looks back the same way, so its history is not empty. Its
   * schedule follows its period and name.
   */
  const save = async (id: string, watch: Watch, recheck: boolean) => {
    const run = watches?.find(saved => saved.id === id)?.document.run
    if (recheck) {
      if (run) await actions.cancel(run.executionId).catch(() => undefined)
      await Promise.all(checks.filter(saved => saved.document.watchId === id).map(saved => checkStore.delete(saved.id)))
    }
    await watchStore.put(id, !recheck && run ? { ...watch, run } : watch)
    const schedule = scheduleOf(id)
    const wanted = scheduleFor(watch)
    if (schedule && (schedule.cron !== wanted.cron || schedule.name !== wanted.name)) {
      await ctx.schedules?.update(schedule.id, wanted)
    }
    await reload()
    go({ page: 'watch', watchId: id })
    if (recheck) await check(id, watch, FIRST_CHECK[granularityOf(watch)])
  }

  /** Creates, pauses, resumes or deletes a watch's scheduled check, or changes where it adds each check. */
  const changeSchedule = async (watchId: string, watch: Watch, change: ScheduleChange, link: string) => {
    const store = ctx.schedules
    if (!store) return
    const schedule = scheduleOf(watchId)
    const target = exportTarget(link)?.input ?? {}
    if (change === 'create') {
      const zone = timeZone()
      await store.create({ action: 'check-metric', parameters: { watchId, timeZone: zone, ...target }, timeZone: zone, ...scheduleFor(watch) })
    } else if (schedule) {
      if (change === 'target') {
        // The rest of the parameters stay: a schedule made before periods keeps checking by UTC.
        const { documentId: _doc, spreadsheetId: _sheet, ...kept } = (schedule.parameters ?? {}) as Record<string, unknown>
        await store.update(schedule.id, { parameters: { ...kept, ...target } })
      } else if (change === 'delete') {
        await store.delete(schedule.id)
      } else {
        await store[change](schedule.id)
      }
    }
    await reload()
  }

  const remove = async (watchId: string, run: Run | undefined) => {
    // First, so a failure leaves the watch and its scheduled check as they were.
    const schedule = scheduleOf(watchId)
    if (schedule) await ctx.schedules?.delete(schedule.id)
    if (run) await actions.cancel(run.executionId).catch(() => undefined)
    await Promise.all(
      checks.filter(saved => saved.document.watchId === watchId).map(saved => checkStore.delete(saved.id)),
    )
    await watchStore.delete(watchId)
    go({ page: 'list' })
    await reload()
  }

  const historyOf = (watchId: string) =>
    checks
      .filter(saved => saved.document.watchId === watchId)
      .map(saved => saved.document)
      .sort((a, b) => b.asOf.localeCompare(a.asOf))

  const alert = error && (
    <p role="alert" className="alert">
      {error}
    </p>
  )

  if (route.page === 'new' || route.page === 'edit') {
    const editing = route.page === 'edit' ? watches?.find(item => item.id === route.watchId) : undefined
    const back: Route = route.page === 'edit' ? { page: 'watch', watchId: route.watchId } : { page: 'list' }
    if (route.page === 'edit' && !editing) {
      return (
        <div className="dm-page">
          <main className="dm-page-content top">
            <p className="dm-muted">{watches ? 'This watch no longer exists.' : 'Loading the watch…'}</p>
            <button className="button secondary" onClick={() => go({ page: 'list' })}>All watches</button>
          </main>
        </div>
      )
    }
    return (
      <div className="dm-page">
        <header className="dm-page-header">
          <button className="link" onClick={() => go(back)}>
            <ArrowLeft size={14} aria-hidden /> {editing ? editing.document.name : 'All watches'}
          </button>
          <h1 className="dm-page-header-title">{editing ? `Edit ${editing.document.name}` : 'New watch'}</h1>
        </header>
        <main className="dm-page-content">
          {alert}
          <WatchForm
            ctx={ctx}
            dataMarts={dataMarts}
            initial={editing && { id: editing.id, watch: editing.document }}
            onCancel={() => go(back)}
            onSave={save}
          />
        </main>
      </div>
    )
  }

  if (route.page === 'watch') {
    const saved = watches?.find(item => item.id === route.watchId)
    if (watches && !saved) {
      return (
        <div className="dm-page">
          <main className="dm-page-content top">
            <p className="dm-muted">This watch no longer exists.</p>
            <button className="button secondary" onClick={() => go({ page: 'list' })}>All watches</button>
          </main>
        </div>
      )
    }
    const run = saved?.document.run
    return (
      <WatchPage
        watchId={route.watchId}
        watch={saved?.document ?? null}
        history={historyOf(route.watchId)}
        asOf={route.asOf}
        running={run !== undefined}
        error={alert}
        onBack={() => go({ page: 'list' })}
        onSelect={asOf => go({ page: 'watch', watchId: route.watchId, asOf })}
        onCheck={() => {
          if (saved) void check(saved.id, saved.document, historyOf(saved.id).length === 0 ? FIRST_CHECK[granularityOf(saved.document)] : 1)
        }}
        onCancel={() => {
          if (run) actions.cancel(run.executionId).catch((failure: unknown) => setError(errorMessage(failure)))
        }}
        onEdit={() => go({ page: 'edit', watchId: route.watchId })}
        onDelete={() => void remove(route.watchId, run).catch((failure: unknown) => setError(errorMessage(failure)))}
        onExport={exportCheck}
        schedule={scheduleOf(route.watchId)}
        onSchedule={
          ctx.schedules &&
          ((change, link) =>
            saved
              ? changeSchedule(saved.id, saved.document, change, link).catch((failure: unknown) => setError(errorMessage(failure)))
              : Promise.resolve())
        }
      />
    )
  }

  // Each watch with its latest check and how it reads: alerts first, the largest change first.
  const listed = (watches ?? []).map(saved => {
    const latest = historyOf(saved.id)[0]
    return { saved, latest, tone: latest ? verdict(latest, saved.document).tone : 'none' }
  })
  const attention = listed
    .filter(item => item.tone === 'bad')
    .sort((a, b) => Math.abs(b.latest?.change ?? 0) - Math.abs(a.latest?.change ?? 0))
  const usual = listed.filter(item => item.tone !== 'bad')
  const newest = listed
    .flatMap(item => (item.latest ? [item.latest] : []))
    .sort((a, b) => b.asOf.localeCompare(a.asOf) || b.checkedAt.localeCompare(a.checkedAt))[0]
  const groups = [
    { key: 'attention', title: 'Needs attention', items: attention },
    { key: 'usual', title: 'As usual', items: usual },
  ].filter(group => group.items.length > 0 && (filter === 'all' || filter === group.key))

  return (
    <div className="dm-page">
      <header className="dm-page-header with-action">
        <div>
          <h1 className="dm-page-header-title">Metric Watch</h1>
          <p className="dm-muted subtitle">Get told when a metric moves, and why.</p>
        </div>
        <button className="button" onClick={() => go({ page: 'new' })}>
          <Plus size={16} aria-hidden /> New watch
        </button>
      </header>
      <main className="dm-page-content">
        {alert}
        {watches === null ? (
          <section className="dm-card empty dm-muted">Loading watches…</section>
        ) : watches.length === 0 ? (
          <section className="dm-card empty-state">
            <Activity size={24} aria-hidden />
            <h2>Watch a metric</h2>
            <p className="dm-muted">
              Pick a metric such as ROAS or revenue. Each day, week, month or quarter it is compared with the eight before, and an unusual one comes with the
              channels, campaigns or countries that moved it.
            </p>
            <button className="button" onClick={() => go({ page: 'new' })}>
              <Plus size={16} aria-hidden /> New watch
            </button>
          </section>
        ) : (
          <>
            <div className="week-bar">
              <p className="flush">
                <span className={attention.length > 0 ? 'attention' : 'dm-muted'}>
                  {attention.length} {attention.length === 1 ? 'needs' : 'need'} attention
                </span>
                <span className="dm-muted">
                  {usual.length} as usual
                  {newest && (
                    <>
                      {' '}
                      · checked <CheckedAt iso={newest.checkedAt} />
                    </>
                  )}
                </span>
              </p>
              <div className="segmented" role="group" aria-label="Show">
                {(
                  [
                    ['all', `All ${listed.length}`],
                    ['attention', `Needs attention ${attention.length}`],
                    ['usual', `As usual ${usual.length}`],
                  ] as const
                ).map(([value, label]) => (
                  <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {groups.map(group => (
              <section key={group.key} className="watch-group" aria-labelledby={`group-${group.key}`}>
                <h2 id={`group-${group.key}`} className="group-title">
                  {group.title} · {group.items.length}
                </h2>
                <div className="watch-grid">
                  {group.items.map(({ saved, latest }) => (
                    <WatchCard
                      key={saved.id}
                      watch={saved.document}
                      running={saved.document.run !== undefined}
                      latest={latest}
                      onOpen={() => go({ page: 'watch', watchId: saved.id })}
                    />
                  ))}
                </div>
              </section>
            ))}
          </>
        )}
      </main>
    </div>
  )
}
