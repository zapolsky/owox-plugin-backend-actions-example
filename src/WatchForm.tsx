import { useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import type { PluginContext } from '@owox/plugin-sdk'
import type { Rule, Watch } from '../worker/watch'

export type DataMartOption = { id: string; title: string }

type Columns = { dates: string[]; numbers: string[]; texts: string[] }

const MAX_DIMENSIONS = 3

/** Sorts a Data Mart's columns by the values of its first row. */
function classify(row: Record<string, unknown>): Columns {
  const columns: Columns = { dates: [], numbers: [], texts: [] }
  for (const [name, value] of Object.entries(row)) {
    if (typeof value === 'number') columns.numbers.push(name)
    else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) columns.dates.push(name)
    else if (typeof value === 'string' && value !== '' && Number.isFinite(Number(value))) columns.numbers.push(name)
    else if (typeof value === 'string' || value === null) columns.texts.push(name)
  }
  return columns
}

const nameFor = (numerator: string, denominator: string) =>
  !denominator ? numerator : /revenue/i.test(numerator) && /cost|spend/i.test(denominator) ? 'ROAS' : `${numerator} / ${denominator}`

/** Picks a Data Mart, the columns of the metric and what explains it, and when to alert. */
export function WatchForm({
  ctx,
  dataMarts,
  onCancel,
  onCreate,
}: {
  ctx: PluginContext
  dataMarts: DataMartOption[] | null
  onCancel: () => void
  onCreate: (id: string, watch: Watch) => Promise<void>
}) {
  const [dataMartId, setDataMartId] = useState('')
  const [columns, setColumns] = useState<Columns | null>(null)
  const [loading, setLoading] = useState(false)
  const [dateColumn, setDateColumn] = useState('')
  const [numerator, setNumerator] = useState('')
  const [denominator, setDenominator] = useState('')
  const [name, setName] = useState('')
  const [dimensions, setDimensions] = useState<string[]>([])
  const [rule, setRule] = useState<Rule>({ kind: 'unusual' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pick = async (id: string) => {
    setDataMartId(id)
    setColumns(null)
    setError(null)
    if (!id) return
    setLoading(true)
    try {
      const data = await ctx.owox.dataMarts.traverseData(id, { columns: '*', limit: 1 })
      let row: Record<string, unknown> | undefined
      for await (const chunk of data.rowChunks()) row ??= chunk[0]
      if (!row) throw new Error('This Data Mart has no rows yet.')
      const found = classify(row)
      if (found.dates.length === 0 || found.numbers.length === 0) {
        throw new Error('A watch needs a date column and a number column. This Data Mart has no such pair.')
      }
      const num = found.numbers.find(column => /revenue|sales|value/i.test(column)) ?? found.numbers[0]
      const den = found.numbers.find(column => column !== num && /cost|spend/i.test(column)) ?? ''
      setColumns(found)
      setDateColumn(found.dates[0])
      setNumerator(num)
      setDenominator(den)
      setName(nameFor(num, den))
      setDimensions(found.texts.slice(0, MAX_DIMENSIONS))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setLoading(false)
    }
  }

  const toggle = (column: string) =>
    setDimensions(current => (current.includes(column) ? current.filter(item => item !== column) : [...current, column]))

  const invalid =
    !columns ||
    !name.trim() ||
    numerator === denominator ||
    (rule.kind === 'change' && !(rule.percent > 0 && rule.percent <= 1000))

  const submit = async () => {
    const dataMart = dataMarts?.find(item => item.id === dataMartId)
    if (invalid || !dataMart) return
    setSaving(true)
    setError(null)
    try {
      const id = `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
      await onCreate(id, {
        name: name.trim(),
        dataMartId,
        dataMartTitle: dataMart.title,
        dateColumn,
        numerator,
        denominator: denominator || null,
        dimensions,
        rule,
      })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
      setSaving(false)
    }
  }

  return (
    // Not a <form>: the plugin frame is sandboxed without allow-forms, so a submit event never fires.
    <div className="dm-card form">
      <label className="field">
        Data Mart
        <select value={dataMartId} onChange={event => void pick(event.target.value)} disabled={!dataMarts || saving}>
          <option value="">{dataMarts ? 'Choose a Data Mart' : 'Loading…'}</option>
          {dataMarts?.map(item => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
      </label>
      {loading && (
        <p className="dm-muted status">
          <LoaderCircle className="spin" size={16} aria-hidden /> Reading its columns…
        </p>
      )}
      {error && (
        <p role="alert" className="alert">
          {error}
        </p>
      )}

      {columns && (
        <>
          <fieldset>
            <legend>Metric</legend>
            <div className="controls">
              <label className="field">
                Sum of
                <select
                  value={numerator}
                  onChange={event => {
                    // The divisor list leaves out the summed column, so a divisor equal to it shows as Nothing.
                    const divisor = denominator === event.target.value ? '' : denominator
                    setNumerator(event.target.value)
                    setDenominator(divisor)
                    setName(nameFor(event.target.value, divisor))
                  }}
                >
                  {columns.numbers.map(column => (
                    <option key={column}>{column}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                Divided by the sum of
                <select
                  value={denominator}
                  onChange={event => {
                    setDenominator(event.target.value)
                    setName(nameFor(numerator, event.target.value))
                  }}
                >
                  <option value="">Nothing</option>
                  {columns.numbers
                    .filter(column => column !== numerator)
                    .map(column => (
                      <option key={column}>{column}</option>
                    ))}
                </select>
              </label>
              <label className="field">
                By day of
                <select value={dateColumn} onChange={event => setDateColumn(event.target.value)}>
                  {columns.dates.map(column => (
                    <option key={column}>{column}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                Called
                <input value={name} onChange={event => setName(event.target.value)} maxLength={60} required />
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend>Explain a change by</legend>
            {columns.texts.length === 0 ? (
              <p className="dm-muted hint">This Data Mart has no text columns to explain a change by.</p>
            ) : (
              <div className="checks">
                {columns.texts.map(column => (
                  <label key={column} className="check">
                    <input
                      type="checkbox"
                      checked={dimensions.includes(column)}
                      disabled={!dimensions.includes(column) && dimensions.length >= MAX_DIMENSIONS}
                      onChange={() => toggle(column)}
                    />
                    {column}
                  </label>
                ))}
              </div>
            )}
            <p className="dm-muted hint">Up to three columns. Each one is a query when the watch checks a week.</p>
          </fieldset>

          <fieldset>
            <legend>Alert when</legend>
            <label className="check">
              <input type="radio" name="rule" checked={rule.kind === 'unusual'} onChange={() => setRule({ kind: 'unusual' })} />
              The week is outside the usual range of the eight weeks before
            </label>
            <label className="check">
              <input
                type="radio"
                name="rule"
                checked={rule.kind === 'change'}
                onChange={() => setRule({ kind: 'change', percent: 20, direction: 'down' })}
              />
              It changes against the week before by more than
              {rule.kind === 'change' && (
                <>
                  <input
                    className="percent"
                    type="number"
                    min={1}
                    max={1000}
                    value={rule.percent}
                    aria-label="Percent"
                    onChange={event => setRule({ ...rule, percent: Number(event.target.value) })}
                  />
                  %
                  <select
                    className="direction"
                    value={rule.direction}
                    aria-label="Direction"
                    onChange={event => setRule({ ...rule, direction: event.target.value as typeof rule.direction })}
                  >
                    <option value="down">down</option>
                    <option value="up">up</option>
                    <option value="any">either way</option>
                  </select>
                </>
              )}
            </label>
          </fieldset>
        </>
      )}

      <div className="actions">
        <button className="button" type="button" onClick={() => void submit()} disabled={invalid || saving}>
          {saving && <LoaderCircle className="spin" size={16} aria-hidden />} Create and check 12 weeks
        </button>
        <button className="button secondary" type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </div>
  )
}
