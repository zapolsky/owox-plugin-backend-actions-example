import { useEffect, useState, type ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'
import type { PluginContext } from '@owox/plugin-sdk'
import { formatMetric, type Format, type Rule, type Sensitivity, type Watch } from '../worker/watch'

export type DataMartOption = { id: string; title: string }

type Columns = { dates: string[]; numbers: string[]; texts: string[] }

const MAX_DIMENSIONS = 3
const FORMATS: [Format, string][] = [
  ['number', 'Number'],
  ['percent', 'Percent'],
  ['times', 'Times'],
]
const SENSITIVITIES: [Sensitivity, string][] = [
  ['low', 'Fewer alerts'],
  ['medium', 'Balanced'],
  ['high', 'More alerts'],
]

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

/** How a new metric probably reads: ROAS as 1.99×, a conversion as 1.96%, anything else as a number. */
function formatFor(numerator: string, denominator: string): Format {
  if (/revenue|value|sales/i.test(numerator) && /cost|spend/i.test(denominator)) return 'times'
  if (/session|visit|user|click|impression|signup|lead|view/i.test(denominator)) return 'percent'
  return 'number'
}

/** More cost is bad news; most other metrics are better higher. */
const riseFor = (numerator: string) => (/cost|spend/i.test(numerator) ? 'bad' : 'good')

/** What makes saved checks wrong when it changes, so saving checks the weeks again. */
const analysis = (watch: Watch) =>
  JSON.stringify([
    watch.dataMartId,
    watch.dateColumn,
    watch.numerator,
    watch.denominator,
    [...watch.dimensions].sort(),
    watch.rule,
    watch.sensitivity ?? 'medium',
  ])

/** A select's columns, keeping a saved one the Data Mart lacks so the member sees what to replace. */
const withSaved = (columns: string[], saved: string) => (saved && !columns.includes(saved) ? [saved, ...columns] : columns)

const listed = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items[0])

function Step({ n, title, note, children }: { n: number; title: string; note?: string; children: ReactNode }) {
  return (
    <section className="step" aria-labelledby={`step-${n}`}>
      <h2 id={`step-${n}`} className="step-title">
        <span className="step-number" aria-hidden>
          {n}
        </span>
        {title}
        {note && <span className="dm-muted step-note">{note}</span>}
      </h2>
      {children}
    </section>
  )
}

/** Creates a watch, or edits a saved one; the summary says what it will do and what saving costs. */
export function WatchForm({
  ctx,
  dataMarts,
  initial,
  onCancel,
  onSave,
}: {
  ctx: PluginContext
  dataMarts: DataMartOption[] | null
  initial?: { id: string; watch: Watch }
  onCancel: () => void
  onSave: (id: string, watch: Watch, recheck: boolean) => Promise<void>
}) {
  const saved = initial?.watch
  const [dataMartId, setDataMartId] = useState(saved?.dataMartId ?? '')
  const [columns, setColumns] = useState<Columns | null>(null)
  const [loading, setLoading] = useState(false)
  const [dateColumn, setDateColumn] = useState(saved?.dateColumn ?? '')
  const [numerator, setNumerator] = useState(saved?.numerator ?? '')
  const [denominator, setDenominator] = useState(saved?.denominator ?? '')
  const [name, setName] = useState(saved?.name ?? '')
  // A format this page no longer offers, such as money, reads as a number.
  const [format, setFormat] = useState<Format>(FORMATS.find(([value]) => value === saved?.format)?.[0] ?? 'number')
  const [rise, setRise] = useState<'good' | 'bad'>(saved?.rise ?? 'good')
  const [dimensions, setDimensions] = useState<string[]>(saved?.dimensions ?? [])
  const [rule, setRule] = useState<Rule>(saved?.rule ?? { kind: 'unusual' })
  const [sensitivity, setSensitivity] = useState<Sensitivity>(saved?.sensitivity ?? 'medium')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const read = async (id: string) => {
    const data = await ctx.owox.dataMarts.traverseData(id, { columns: '*', limit: 1 })
    let row: Record<string, unknown> | undefined
    for await (const chunk of data.rowChunks()) row ??= chunk[0]
    if (!row) throw new Error('This Data Mart has no rows yet.')
    const found = classify(row)
    if (found.dates.length === 0 || found.numbers.length === 0) {
      throw new Error('A watch needs a date column and a number column. This Data Mart has no such pair.')
    }
    return found
  }

  const load = (id: string, apply: (found: Columns) => void) => {
    setLoading(true)
    read(id)
      .then(
        found => {
          setColumns(found)
          apply(found)
        },
        (failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)),
      )
      .finally(() => setLoading(false))
  }

  // An edited watch reads its Data Mart's columns once and keeps what was saved.
  useEffect(() => {
    if (saved) load(saved.dataMartId, () => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once, when the form opens
  }, [])

  // A new watch follows its metric with a name, a format and which way is good; an edited one keeps the member's.
  const suggest = (num: string, den: string) => {
    if (saved) return
    setName(nameFor(num, den))
    setFormat(formatFor(num, den))
    setRise(riseFor(num))
  }

  const pick = (id: string) => {
    setDataMartId(id)
    setColumns(null)
    setError(null)
    if (!id) return
    load(id, found => {
      const num = found.numbers.find(column => /revenue|sales|value/i.test(column)) ?? found.numbers[0]
      const den = found.numbers.find(column => column !== num && /cost|spend/i.test(column)) ?? ''
      setDateColumn(found.dates[0])
      setNumerator(num)
      setDenominator(den)
      setDimensions(found.texts.slice(0, MAX_DIMENSIONS))
      suggest(num, den)
    })
  }

  const toggle = (column: string) =>
    setDimensions(current => (current.includes(column) ? current.filter(item => item !== column) : [...current, column]))

  const dataMartTitle = dataMarts?.find(item => item.id === dataMartId)?.title ?? (saved?.dataMartId === dataMartId ? saved.dataMartTitle : '')
  const draft: Watch = {
    name: name.trim(),
    dataMartId,
    dataMartTitle,
    dateColumn,
    numerator,
    denominator: denominator || null,
    dimensions,
    rule,
    format,
    rise,
    sensitivity,
  }
  const recheck = !saved || analysis(draft) !== analysis(saved)
  const invalid =
    !columns ||
    !dataMartTitle ||
    !draft.name ||
    numerator === denominator ||
    (rule.kind === 'change' && !(rule.percent > 0 && rule.percent <= 1000))

  const submit = async () => {
    if (invalid) return
    setSaving(true)
    setError(null)
    try {
      await onSave(initial?.id ?? `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, draft, recheck)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
      setSaving(false)
    }
  }

  const ratio = denominator !== ''
  const example =
    format === 'percent' ? 0.0196 : format === 'times' ? 1.99 : ratio ? 76.99 : 54138
  const ruleSentence =
    rule.kind === 'unusual'
      ? `Alerts when a week ${rise === 'good' ? 'falls below' : 'rises above'} its usual range${
          { low: ', with fewer alerts', medium: '', high: ', with more alerts' }[sensitivity]
        }. ${rise === 'good' ? 'A rise above it' : 'A drop below it'} shows as good news, without an alert.`
      : `Alerts when ${draft.name || 'it'} ${
          rule.direction === 'any' ? 'changes' : rule.direction === 'down' ? 'falls' : 'rises'
        } by more than ${rule.percent}% against the week before.`

  return (
    // Not a <form>: the plugin frame is sandboxed without allow-forms, so a submit event never fires.
    <div className="form-layout">
      <div className="dm-card form-steps">
        <Step n={1} title="Where the data is">
          <div className="controls grid">
            <label className="field">
              Data Mart
              <select value={dataMartId} onChange={event => pick(event.target.value)} disabled={!dataMarts || saving}>
                <option value="">{dataMarts ? 'Choose a Data Mart' : 'Loading…'}</option>
                {dataMarts?.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
            {columns && (
              <label className="field">
                Date column
                <select value={dateColumn} onChange={event => setDateColumn(event.target.value)}>
                  {withSaved(columns.dates, dateColumn).map(column => (
                    <option key={column}>{column}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
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
        </Step>

        {columns && (
          <>
            <Step n={2} title="What to watch">
              <div className="controls grid">
                <label className="field">
                  Name
                  <input value={name} onChange={event => setName(event.target.value)} maxLength={60} required />
                </label>
                <label className="field">
                  Sum of
                  <select
                    value={numerator}
                    onChange={event => {
                      // The divisor list leaves out the summed column, so a divisor equal to it shows as Nothing.
                      const divisor = denominator === event.target.value ? '' : denominator
                      setNumerator(event.target.value)
                      setDenominator(divisor)
                      suggest(event.target.value, divisor)
                    }}
                  >
                    {withSaved(columns.numbers, numerator).map(column => (
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
                      suggest(numerator, event.target.value)
                    }}
                  >
                    <option value="">Nothing</option>
                    {withSaved(columns.numbers, denominator)
                      .filter(column => column !== numerator)
                      .map(column => (
                        <option key={column}>{column}</option>
                      ))}
                  </select>
                </label>
              </div>
              <div className="controls grid">
                <div className="field">
                  <span id="show-as">Show as</span>
                  <div className="segmented wide" role="group" aria-labelledby="show-as">
                    {FORMATS.map(([value, label]) => (
                      <button key={value} aria-pressed={format === value} onClick={() => setFormat(value)}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <span id="rise-is">A rise is</span>
                  <div className="segmented wide" role="group" aria-labelledby="rise-is">
                    {(['good', 'bad'] as const).map(value => (
                      <button key={value} aria-pressed={rise === value} onClick={() => setRise(value)}>
                        {value === 'good' ? 'Good' : 'Bad'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </Step>

            <Step n={3} title="What can explain a change" note="up to three">
              {columns.texts.length === 0 ? (
                <p className="dm-muted hint flush">This Data Mart has no text columns to explain a change by.</p>
              ) : (
                <div className="chips">
                  {[...columns.texts, ...dimensions.filter(column => !columns.texts.includes(column))].map(column => {
                    const checked = dimensions.includes(column)
                    return (
                      <label key={column} className={checked ? 'chip checked' : 'chip'}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!checked && dimensions.length >= MAX_DIMENSIONS}
                          onChange={() => toggle(column)}
                        />
                        {column}
                      </label>
                    )
                  })}
                </div>
              )}
              <p className="dm-muted hint flush">A check reads them in one Data Mart run, so many values in each make it slower.</p>
            </Step>

            <Step n={4} title="When to alert">
              <div className="rule-cards">
                <div className={rule.kind === 'unusual' ? 'rule-card selected' : 'rule-card'}>
                  <label className="rule-title">
                    <input type="radio" name="rule" checked={rule.kind === 'unusual'} onChange={() => setRule({ kind: 'unusual' })} />A
                    week is unusual
                  </label>
                  <p className="dm-muted flush">Outside the usual range of the eight weeks before.</p>
                  {rule.kind === 'unusual' && (
                    <div className="field">
                      <span id="sensitivity">Sensitivity</span>
                      <div className="segmented wide" role="group" aria-labelledby="sensitivity">
                        {SENSITIVITIES.map(([value, label]) => (
                          <button key={value} aria-pressed={sensitivity === value} onClick={() => setSensitivity(value)}>
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div className={rule.kind === 'change' ? 'rule-card selected' : 'rule-card'}>
                  <label className="rule-title">
                    <input
                      type="radio"
                      name="rule"
                      checked={rule.kind === 'change'}
                      onChange={() => setRule({ kind: 'change', percent: 20, direction: rise === 'good' ? 'down' : 'up' })}
                    />
                    It changes a lot
                  </label>
                  {rule.kind === 'change' ? (
                    <p className="check flush">
                      By more than
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
                      against the week before
                    </p>
                  ) : (
                    <p className="dm-muted flush">By more than a percent you choose, against the week before.</p>
                  )}
                </div>
              </div>
            </Step>
          </>
        )}
      </div>

      <aside className="summary" aria-labelledby="summary-title">
        <span id="summary-title" className="happened-label">
          This watch
        </span>
        {columns ? (
          <>
            <p className="summary-lead">
              <strong>{draft.name || 'The metric'}</strong> = {ratio ? `${numerator} ÷ ${denominator}` : `sum of ${numerator}`} from{' '}
              <strong>{dataMartTitle}</strong>, shown as {formatMetric(example, { format }, ratio ? 2 : null)}.
            </p>
            <p className="flush">{ruleSentence}</p>
            <p className="flush">
              {dimensions.length > 0
                ? `A change is explained by ${listed(dimensions)}.`
                : 'Nothing will explain a change: pick up to three columns.'}
            </p>
          </>
        ) : (
          <p className="flush dm-muted">Pick a Data Mart to see what the watch will do.</p>
        )}
        <p className="dm-muted hint summary-cost">
          {!saved
            ? 'The first check reads 12 weeks in one Data Mart run. You can close the plugin while it runs.'
            : recheck
              ? 'Saving checks the last 12 weeks again in one Data Mart run and replaces the checked weeks.'
              : 'Saving keeps the checked weeks; only how they read changes.'}
        </p>
        <div className="actions">
          <button className="button" onClick={() => void submit()} disabled={invalid || saving}>
            {saving && <LoaderCircle className="spin" size={16} aria-hidden />}
            {!saved ? 'Create and check 12 weeks' : recheck ? 'Save and check 12 weeks' : 'Save'}
          </button>
          <button className="button secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
        </div>
      </aside>
    </div>
  )
}
