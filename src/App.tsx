import { useEffect, useState } from 'react'
import { ChartColumn, FileText, LoaderCircle, Sparkles } from 'lucide-react'
import type { PluginContext } from '@owox/plugin-sdk'
import { amount } from '../worker/digest'
import type { SavedDigest } from '../worker/index'
import { Change, DigestCard, WrittenAt } from './DigestCard'

type DataMartOption = { id: string; title: string }
type SavedEntry = { id: string; createdAt: string; digest: SavedDigest }
type Status =
  | { kind: 'idle' }
  | { kind: 'writing'; id: string }
  | { kind: 'error'; message: string }

// The page keeps no storage, so a started digest's execution id lives in the plugin's route.
const EXECUTION_ROUTE = '/executions/'

/** PluginActionError and PluginTransportError are matched by code, not imported as values. */
function errorMessage(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  if (code === 'CANCELLED') return 'The digest was cancelled.'
  if (code === 'TIMED_OUT') return 'The digest took too long. Try again.'
  return error instanceof Error ? error.message : String(error)
}

export default function App({ ctx }: { ctx: PluginContext }) {
  const [dataMarts, setDataMarts] = useState<DataMartOption[] | null>(null)
  const [dataMartId, setDataMartId] = useState('')
  const [history, setHistory] = useState<SavedEntry[]>([])
  const [status, setStatus] = useState<Status>(() =>
    ctx.route?.startsWith(EXECUTION_ROUTE)
      ? { kind: 'writing', id: decodeURIComponent(ctx.route.slice(EXECUTION_ROUTE.length)) }
      : { kind: 'idle' },
  )
  const actions = ctx.actions

  const loadHistory = () =>
    ctx
      .collections<SavedDigest>('digests')
      .list({ limit: 20 })
      .then(page =>
        setHistory(
          page.items
            .map(item => ({ id: item.id, createdAt: item.createdAt, digest: item.document }))
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        ),
      )
      .catch((error: unknown) => setStatus({ kind: 'error', message: errorMessage(error) }))

  const follow = (id: string) =>
    actions
      ?.wait(id)
      .then(
        () => setStatus({ kind: 'idle' }),
        (error: unknown) => setStatus({ kind: 'error', message: errorMessage(error) }),
      )
      .finally(() => {
        ctx.ui.setRoute('/')
        return loadHistory()
      })

  useEffect(() => {
    ctx.owox.dataMarts.list().then(
      items => {
        const options = items
          .map(({ id, title }) => ({ id, title }))
          .sort((a, b) => a.title.localeCompare(b.title))
        setDataMarts(options)
        setDataMartId(current => current || options[0]?.id || '')
      },
      (error: unknown) => setStatus({ kind: 'error', message: errorMessage(error) }),
    )
    void loadHistory()
    // A digest started before the plugin closed may still be running.
    if (status.kind === 'writing') void follow(status.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once, when the plugin opens
  }, [])

  if (!actions) {
    return <p role="alert">This OWOX Data Marts deployment does not support backend actions.</p>
  }

  const write = async () => {
    try {
      const { id } = await actions.start('write-digest', { dataMartId })
      setStatus({ kind: 'writing', id })
      ctx.ui.setRoute(EXECUTION_ROUTE + encodeURIComponent(id))
      void follow(id)
    } catch (error) {
      setStatus({ kind: 'error', message: errorMessage(error) })
    }
  }

  const [latest, ...earlier] = history

  return (
    <div className="dm-page">
      <header className="dm-page-header">
        <h1 className="dm-page-header-title">Weekly sales digest</h1>
        <p className="dm-muted subtitle">
          How did sales go this week? Pick a Data Mart and get revenue, the leading city, the
          biggest fall and the best day against the week before.
        </p>
      </header>

      <main className="dm-page-content">
        <section className="dm-card" aria-labelledby="write-title">
          <h2 id="write-title" className="card-title">
            <Sparkles size={16} aria-hidden /> Write a digest
          </h2>
          {/* No <form>: the plugin frame has no allow-forms, so a submit never fires. */}
          <div className="controls">
            <label className="field">
              Data Mart
              <select
                value={dataMartId}
                disabled={!dataMarts?.length}
                onChange={event => setDataMartId(event.target.value)}
              >
                {dataMarts === null && <option>Loading…</option>}
                {dataMarts?.length === 0 && <option>No Data Marts available</option>}
                {dataMarts?.map(dataMart => (
                  <option key={dataMart.id} value={dataMart.id}>
                    {dataMart.title}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button"
              disabled={!dataMartId || status.kind === 'writing'}
              onClick={write}
            >
              <FileText size={16} aria-hidden /> Write digest
            </button>
          </div>
          <p className="dm-muted hint">
            The Data Mart needs <code>order_date</code>, <code>city</code> and <code>revenue</code>{' '}
            columns.
          </p>

          <div aria-live="polite">
            {status.kind === 'writing' && (
              <div className="status">
                <LoaderCircle className="spin" size={16} aria-hidden />
                <span>
                  Writing the digest… You can close the plugin: the digest is saved when it is
                  ready.
                </span>
                <button
                  className="button secondary"
                  onClick={() =>
                    actions
                      .cancel(status.id)
                      .catch((error: unknown) =>
                        setStatus({ kind: 'error', message: errorMessage(error) }),
                      )
                  }
                >
                  Cancel
                </button>
              </div>
            )}
            {status.kind === 'error' && (
              <p role="alert" className="alert">
                {status.message}
              </p>
            )}
          </div>
        </section>

        {latest ? (
          <DigestCard digest={latest.digest} createdAt={latest.createdAt} />
        ) : (
          <section className="dm-card empty dm-muted">
            <ChartColumn size={16} aria-hidden /> No digests yet. Write the first one above.
          </section>
        )}

        {earlier.length > 0 && (
          <section className="dm-card" aria-labelledby="earlier-title">
            <h2 id="earlier-title" className="card-title">
              Earlier digests
            </h2>
            <ol className="history">
              {earlier.map(({ id, createdAt, digest }) => (
                <li key={id}>
                  <span className="dm-muted">
                    <WrittenAt iso={createdAt} />
                  </span>
                  <span>{digest.title}</span>
                  <span>{typeof digest.revenue === 'number' ? amount(digest.revenue) : ''}</span>
                  {typeof digest.revenue === 'number' ? <Change value={digest.change} /> : <span />}
                </li>
              ))}
            </ol>
          </section>
        )}
      </main>
    </div>
  )
}
