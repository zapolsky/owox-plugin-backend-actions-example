import { createBackend, type BackendActionContext } from '@owox/plugin-sdk/server'
import {
  checkWeek,
  firstDay,
  missingColumnsMessage,
  shiftDay,
  type Check,
  type SumRow,
  type Watch,
} from './watch'

const failure = (code: string, message: string) => Object.assign(new Error(message), { code })

/** Daily sums of the watched columns between two days, per value of `dimension` when it is set. */
async function readSums(
  ctx: BackendActionContext,
  watch: Watch,
  from: string,
  to: string,
  dimension?: string,
): Promise<SumRow[]> {
  const summed = [watch.numerator, ...(watch.denominator ? [watch.denominator] : [])]
  const data = await ctx.owox.dataMarts.traverseData(watch.dataMartId, {
    column: [watch.dateColumn, ...(dimension ? [dimension] : []), ...summed],
    aggregation: summed.map(column => ({ column, function: 'SUM' as const })),
    filter: [{ column: watch.dateColumn, operator: 'between', value: { from, to } }],
  })
  const rows: SumRow[] = []
  for await (const chunk of data.rowChunks()) {
    for (const row of chunk) {
      rows.push({
        day: String(row[watch.dateColumn]).slice(0, 10),
        ...(dimension ? { segment: String(row[dimension] ?? '(empty)') } : {}),
        numerator: Number(row[`${watch.numerator} | SUM`]) || 0,
        denominator: watch.denominator ? Number(row[`${watch.denominator} | SUM`]) || 0 : 0,
      })
    }
  }
  return rows
}

/** Names the watched columns a Data Mart lacks, judged by its first row. */
async function missingColumns(ctx: BackendActionContext, watch: Watch) {
  const data = await ctx.owox.dataMarts.traverseData(watch.dataMartId, { columns: '*', limit: 1 })
  const columns = [watch.dateColumn, watch.numerator, watch.denominator, ...watch.dimensions]
  for await (const [row] of data.rowChunks()) {
    if (row) return columns.filter((column): column is string => !!column && !(column in row))
  }
  return []
}

export default createBackend({
  actions: {
    /** Checks the last full week, and with `weeks` the weeks before it too, into the `checks` history. */
    'check-metric': async (input, ctx) => {
      const { watchId, weeks = 1 } = input as { watchId: string; weeks?: number }
      const saved = await ctx.collections<Watch>('watches').get(watchId)
      if (!saved) throw failure('WATCH_NOT_FOUND', 'This watch no longer exists.')
      const watch = saved.document
      const dataMart = (await ctx.owox.dataMarts.list()).find(item => item.id === watch.dataMartId)
      if (!dataMart) throw failure('DATA_MART_NOT_FOUND', 'This Data Mart is not available to you.')

      const asOf = new Date().toISOString().slice(0, 10)
      const [from, to] = [firstDay(asOf, weeks), shiftDay(asOf, -1)]
      let totals: SumRow[]
      const byDimension: Record<string, SumRow[]> = {}
      try {
        totals = await readSums(ctx, watch, from, to)
        // One query at a time: each is a Data Mart run, and a cancelled check stops between them.
        for (const dimension of watch.dimensions) {
          ctx.signal.throwIfAborted()
          byDimension[dimension] = await readSums(ctx, watch, from, to, dimension)
        }
      } catch (error) {
        if (ctx.signal.aborted) throw error
        const missing = await missingColumns(ctx, watch).catch(() => [])
        if (missing.length === 0) throw error
        throw failure('MISSING_COLUMNS', missingColumnsMessage(dataMart.title, missing))
      }
      if (totals.length === 0) {
        throw failure('NO_DATA', `${dataMart.title} has no rows between ${from} and ${to}.`)
      }

      // Saved by the Worker, so a check started before the plugin closed is there when it reopens.
      const checkedAt = new Date().toISOString()
      const history = ctx.collections<Check>('checks')
      for (let week = 0; week < weeks; week++) {
        const check = checkWeek(watchId, watch, shiftDay(asOf, -7 * week), totals, byDimension, checkedAt)
        await history.put(`${watchId}~${check.asOf}`, check)
      }
      return { checked: weeks }
    },
  },
})
