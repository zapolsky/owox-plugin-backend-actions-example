import { useRef, useState } from 'react'
import type { PluginContext } from '@owox/plugin-sdk'

type Entry = {
  id: number
  label: string
  at: string
  state: 'running' | 'ok' | 'error'
  value?: unknown
}

// The page keeps no storage, so a started execution's id lives in the plugin's route.
const EXECUTION_ROUTE = '/executions/'

/** PluginActionError and PluginTransportError are matched by name, not imported as values. */
function describeError(error: unknown): unknown {
  if (!(error instanceof Error)) return { error: String(error) }
  const { code, executionId, errors, payload } = error as Error & Record<string, unknown>
  return { name: error.name, code, message: error.message, executionId, errors, payload }
}

export default function App({ ctx }: { ctx: PluginContext }) {
  const [log, setLog] = useState<Entry[]>([])
  const [dataMartId, setDataMartId] = useState('')
  const [executionId, setExecutionId] = useState(() =>
    ctx.route?.startsWith(EXECUTION_ROUTE)
      ? decodeURIComponent(ctx.route.slice(EXECUTION_ROUTE.length))
      : '',
  )
  const nextId = useRef(0)
  const actions = ctx.actions

  if (!actions) {
    return <p role="alert">This OWOX Data Marts deployment does not support backend actions.</p>
  }

  async function run(label: string, task: () => Promise<unknown>) {
    const id = ++nextId.current
    const update = (patch: Partial<Entry>) =>
      setLog(entries => entries.map(entry => (entry.id === id ? { ...entry, ...patch } : entry)))
    setLog(entries => [
      { id, label, at: new Date().toLocaleTimeString(), state: 'running' },
      ...entries,
    ])
    try {
      update({ state: 'ok', value: await task() })
    } catch (error) {
      update({ state: 'error', value: describeError(error) })
    }
  }

  const startSlowCount = () =>
    run('start slow-count', async () => {
      const started = await actions.start('slow-count')
      setExecutionId(started.id)
      ctx.ui.setRoute(EXECUTION_ROUTE + encodeURIComponent(started.id))
      return started
    })

  const id = executionId.trim()

  return (
    <main>
      <h1>Backend actions example</h1>

      <section>
        <h2>Invoke and wait for the result</h2>
        <div className="row">
          <button onClick={() => run('list-data-marts', () => actions.invoke('list-data-marts'))}>
            List Data Marts
          </button>
          <button onClick={() => run('slow-count', () => actions.invoke('slow-count'))}>
            Count for 120 seconds
          </button>
          <button onClick={() => run('fail', () => actions.invoke('fail'))}>Fail</button>
        </div>
        <form
          className="row"
          onSubmit={event => {
            event.preventDefault()
            void run(`read-rows ${dataMartId}`, () => actions.invoke('read-rows', { dataMartId }))
          }}
        >
          <label>
            Data Mart ID
            <input value={dataMartId} onChange={event => setDataMartId(event.target.value)} />
          </label>
          <button type="submit">Read 10 rows</button>
        </form>
      </section>

      <section>
        <h2>Start now, read later</h2>
        <p className="hint">
          A started execution keeps running after you close the plugin. Paste its ID here to read
          it again.
        </p>
        <div className="row">
          <button onClick={startSlowCount}>Start slow-count</button>
        </div>
        <div className="row">
          <label>
            Execution ID
            <input value={executionId} onChange={event => setExecutionId(event.target.value)} />
          </label>
          <button disabled={!id} onClick={() => run(`get ${id}`, () => actions.get(id))}>
            Get
          </button>
          <button disabled={!id} onClick={() => run(`wait ${id}`, () => actions.wait(id))}>
            Wait
          </button>
          <button disabled={!id} onClick={() => run(`cancel ${id}`, () => actions.cancel(id))}>
            Cancel
          </button>
        </div>
      </section>

      <section aria-live="polite">
        <h2>Results</h2>
        {log.length === 0 ? (
          <p className="hint">Nothing has run yet.</p>
        ) : (
          <ol className="log">
            {log.map(entry => (
              <li key={entry.id} className={entry.state}>
                <strong>{entry.label}</strong> <span className="hint">{entry.at}</span>{' '}
                <span className="state">{entry.state}</span>
                {entry.state !== 'running' && <pre>{JSON.stringify(entry.value, null, 2)}</pre>}
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  )
}
