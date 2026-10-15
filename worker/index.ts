import { createBackend, type BackendActionContext } from '@owox/plugin-sdk/server'
import { digestWindow, writeDigest, type Digest, type RevenueRow } from './digest'

/** The columns a sales Data Mart needs for the digest. */
const COLUMNS = ['order_date', 'city', 'revenue'] as const

export type SavedDigest = Digest & { dataMartId: string }

const failure = (code: string, message: string) => Object.assign(new Error(message), { code })

async function readRevenue(ctx: BackendActionContext, dataMartId: string, from: string, to: string) {
  const data = await ctx.owox.dataMarts.traverseData(dataMartId, {
    column: [...COLUMNS],
    aggregation: [{ column: 'revenue', function: 'SUM' }],
    filter: [{ column: 'order_date', operator: 'between', value: { from, to } }],
  })
  const rows: RevenueRow[] = []
  for await (const chunk of data.rowChunks()) {
    for (const row of chunk) {
      rows.push({
        day: String(row.order_date).slice(0, 10),
        city: String(row.city),
        revenue: Number(row['revenue | SUM']),
      })
    }
  }
  return rows
}

/** Names the digest columns a Data Mart lacks, judged by its first row. */
async function missingColumns(ctx: BackendActionContext, dataMartId: string) {
  const data = await ctx.owox.dataMarts.traverseData(dataMartId, { columns: '*', limit: 1 })
  for await (const [row] of data.rowChunks()) {
    if (row) return COLUMNS.filter(column => !(column in row))
  }
  return []
}

export default createBackend({
  actions: {
    'write-digest': async (input, ctx) => {
      const { dataMartId } = input as { dataMartId: string }
      const dataMart = (await ctx.owox.dataMarts.list()).find(item => item.id === dataMartId)
      if (!dataMart) throw failure('DATA_MART_NOT_FOUND', 'This Data Mart is not available to you.')

      const today = new Date()
      const window = digestWindow(today)
      let rows: RevenueRow[]
      try {
        rows = await readRevenue(ctx, dataMartId, window.previousFrom, window.to)
      } catch (error) {
        const missing = await missingColumns(ctx, dataMartId).catch(() => [])
        if (missing.length === 0) throw error
        throw failure(
          'MISSING_COLUMNS',
          `${dataMart.title} has no ${missing.map(column => `"${column}"`).join(', ')} column. ` +
            'A sales digest needs "order_date", "city" and "revenue".',
        )
      }

      const digest: SavedDigest = { ...writeDigest(dataMart.title, rows, today), dataMartId }
      // The Worker saves it, so a digest started before the plugin closed is there when it reopens.
      await ctx.collections<SavedDigest>('digests').put(ctx.execution.executionId, digest)
      return digest
    },
  },
})
