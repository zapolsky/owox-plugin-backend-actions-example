import { useEffect, useRef, useState } from 'react'
import { Activity, Plus } from 'lucide-react'
import type { PluginCollection, PluginCollectionDocument, PluginContext } from '@owox/plugin-sdk'
import type { Check, Watch } from '../worker/watch'
import { WatchCard } from './WatchCard'
import { WatchForm, type DataMartOption } from './WatchForm'
import { WatchPage } from './WatchPage'

type Saved<T> = PluginCollectionDocument<T>

/**
 * A check the page started, kept on its watch: a page opened later, from anywhere, follows it until
 * it ends. The Worker reads the watch and ignores this field.
 */
type Run = { executionId: string; weeks: number }
type StoredWatch = Watch & { run?: Run }

// The page keeps no storage, so where the member is lives in the plugin's route.
type Route = { page: 'list' } | { page: 'new' } | { page: 'watch'; watchId: string; asOf?: string }

function parseRoute(path: string | undefined): Route {
  const [first, watchId, kind, value] = (path ?? '/').split('/').filter(Boolean).map(decodeURIComponent)
  if (first === 'new') return { page: 'new' }
  if (first !== 'watches' || !watchId) return { page: 'list' }
  if (kind === 'weeks' && value) return { page: 'watch', watchId, asOf: value }
  return { page: 'watch', watchId }
}

function routePath(route: Route): string {
  if (route.page === 'list') return '/'
  if (route.page === 'new') return '/new'
  const base = `/watches/${encodeURIComponent(route.watchId)}`
  return route.asOf ? `${base}/weeks/${route.asOf}` : base
}

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

export default function App({ ctx }: { ctx: PluginContext }) {
  const [route, setRoute] = useState(() => parseRoute(ctx.route))
  const [dataMarts, setDataMarts] = useState<DataMartOption[] | null>(null)
  const [watches, setWatches] = useState<Saved<StoredWatch>[] | null>(null)
  const [checks, setChecks] = useState<Saved<Check>[]>([])
  const [error, setError] = useState<string | null>(null)
  const actions = ctx.actions
  const watchStore = ctx.collections<StoredWatch>('watches')
  const checkStore = ctx.collections<Check>('checks')

  const go = (next: Route) => {
    setRoute(next)
    setError(null)
    ctx.ui.setRoute(routePath(next))
  }

  const reload = () =>
    Promise.all([listAll(watchStore), listAll(checkStore)]).then(
      ([savedWatches, savedChecks]) => {
        setWatches(savedWatches.sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
        setChecks(savedChecks)
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

  const check = async (watchId: string, watch: StoredWatch, weeks: number) => {
    try {
      const { id: executionId } = await actions.start('check-metric', { watchId, weeks })
      await watchStore.put(watchId, { ...watch, run: { executionId, weeks } })
      await reload()
    } catch (failure) {
      setError(errorMessage(failure))
    }
  }

  const create = async (id: string, watch: Watch) => {
    await watchStore.put(id, watch)
    await reload()
    go({ page: 'watch', watchId: id })
    // The first check also looks back eleven weeks, so the history is not empty.
    await check(id, watch, 12)
  }

  const remove = async (watchId: string, run: Run | undefined) => {
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

  if (route.page === 'new') {
    return (
      <div className="dm-page">
        <header className="dm-page-header">
          <h1 className="dm-page-header-title">New watch</h1>
          <p className="dm-muted subtitle">Pick a Data Mart and the metric to watch. The first check also looks back eleven weeks.</p>
        </header>
        <main className="dm-page-content">
          {alert}
          <WatchForm ctx={ctx} dataMarts={dataMarts} onCancel={() => go({ page: 'list' })} onCreate={create} />
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
          if (saved) void check(saved.id, saved.document, historyOf(saved.id).length === 0 ? 12 : 1)
        }}
        onCancel={() => {
          if (run) actions.cancel(run.executionId).catch((failure: unknown) => setError(errorMessage(failure)))
        }}
        onDelete={() => void remove(route.watchId, run).catch((failure: unknown) => setError(errorMessage(failure)))}
      />
    )
  }

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
              Pick a metric such as ROAS or revenue. Each week it is compared with the eight weeks before, and an unusual week comes with the
              channels, campaigns or countries that moved it.
            </p>
            <button className="button" onClick={() => go({ page: 'new' })}>
              <Plus size={16} aria-hidden /> New watch
            </button>
          </section>
        ) : (
          <div className="watch-grid">
            {watches.map(saved => (
              <WatchCard
                key={saved.id}
                watch={saved.document}
                running={saved.document.run !== undefined}
                latest={historyOf(saved.id)[0]}
                onOpen={() => go({ page: 'watch', watchId: saved.id })}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
