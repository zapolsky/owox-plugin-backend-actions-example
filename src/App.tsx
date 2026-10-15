import { useEffect, useState } from 'react'
import type { PluginContext } from '@owox/plugin-sdk'
import type { SavedDigest } from '../worker/index'

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
        setDataMarts(items.map(({ id, title }) => ({ id, title })))
        setDataMartId(current => current || items[0]?.id || '')
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

  return (
    <main>
      <h1>Weekly sales digest</h1>
      <p className="hint">
        Compares the last seven days with the week before. The Data Mart needs{' '}
        <code>order_date</code>, <code>city</code> and <code>revenue</code> columns.
      </p>

      {/* No <form>: the plugin frame has no allow-forms, so a submit never fires. */}
      <div className="row">
        <label>
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
        <button disabled={!dataMartId || status.kind === 'writing'} onClick={write}>
          Write digest
        </button>
      </div>

      <div aria-live="polite">
        {status.kind === 'writing' && (
          <div className="row">
            <p className="hint">
              Writing the digest… You can close the plugin: the digest is saved when it is ready.
            </p>
            <button
              className="secondary"
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
          <p role="alert" className="error">
            {status.message}
          </p>
        )}
      </div>

      <h2>Digests</h2>
      {history.length === 0 ? (
        <p className="hint">No digests yet.</p>
      ) : (
        <ol className="digests">
          {history.map(entry => (
            <li key={entry.id}>
              <span className="hint">{new Date(entry.createdAt).toLocaleString()}</span>
              <p>{entry.digest.text}</p>
            </li>
          ))}
        </ol>
      )}
    </main>
  )
}
