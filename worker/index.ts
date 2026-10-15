import { docs_v1 } from '@googleapis/docs'
import { sheets_v4 } from '@googleapis/sheets'
import { createBackend, exactCredential, type BackendActionContext } from '@owox/plugin-sdk/server'
import { docSection, sheetRow } from './google'
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

/**
 * Daily sums of the watched columns between two days, per combination of the watch's dimensions,
 * in one Data Mart run: totals and each dimension's split are summed from the same rows.
 * ponytail: rows grow with the product of the dimensions' values (days × channels × campaigns × …);
 * fine for tens of thousands, switch back to one run per dimension for high-cardinality columns.
 */
async function readSums(ctx: BackendActionContext, watch: Watch, from: string, to: string) {
  const summed = [watch.numerator, ...(watch.denominator ? [watch.denominator] : [])]
  const data = await ctx.owox.dataMarts.traverseData(watch.dataMartId, {
    column: [watch.dateColumn, ...watch.dimensions, ...summed],
    aggregation: summed.map(column => ({ column, function: 'SUM' as const })),
    filter: [{ column: watch.dateColumn, operator: 'between', value: { from, to } }],
  })
  const totals: SumRow[] = []
  const byDimension: Record<string, SumRow[]> = Object.fromEntries(watch.dimensions.map(dimension => [dimension, []]))
  for await (const chunk of data.rowChunks()) {
    for (const row of chunk) {
      const sums = {
        day: String(row[watch.dateColumn]).slice(0, 10),
        numerator: Number(row[`${watch.numerator} | SUM`]) || 0,
        denominator: watch.denominator ? Number(row[`${watch.denominator} | SUM`]) || 0 : 0,
      }
      totals.push(sums)
      for (const dimension of watch.dimensions) {
        byDimension[dimension].push({ ...sums, segment: String(row[dimension] ?? '(empty)') })
      }
    }
  }
  return { totals, byDimension }
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

/** Google's API clients send through OWOX, which adds the access token; the key never reaches the Worker. */
function googleOptions(ctx: BackendActionContext) {
  const google = exactCredential(ctx.credentials, 'google-service-account')
  if (!google) {
    throw failure('GOOGLE_NOT_CONFIGURED', 'Choose a Google Service Account Credential in the Metric Watch settings to export checks.')
  }
  return { fetchImplementation: google.asFetch(), signal: ctx.signal }
}

async function savedCheck(ctx: BackendActionContext, checkId: string) {
  const saved = await ctx.collections<Check>('checks').get(checkId)
  if (!saved) throw failure('CHECK_NOT_FOUND', 'This check no longer exists.')
  return saved.document
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
      let sums: Awaited<ReturnType<typeof readSums>>
      try {
        sums = await readSums(ctx, watch, from, to)
      } catch (error) {
        if (ctx.signal.aborted) throw error
        const missing = await missingColumns(ctx, watch).catch(() => [])
        if (missing.length === 0) throw error
        throw failure('MISSING_COLUMNS', missingColumnsMessage(dataMart.title, missing))
      }
      const { totals, byDimension } = sums
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

    /** Appends a check at the end of a Google Doc shared with the service account. */
    'export-check-to-doc': async (input, ctx) => {
      const { checkId, documentId } = input as { checkId: string; documentId: string }
      const check = await savedCheck(ctx, checkId)
      const docs = new docs_v1.Docs(googleOptions(ctx))
      await docs.documents.batchUpdate({
        documentId,
        requestBody: { requests: [{ insertText: { endOfSegmentLocation: {}, text: docSection(check) } }] },
      })
      return { documentId }
    },

    /** Appends a check as one row of a Google Sheet shared with the service account. */
    'export-check-to-sheet': async (input, ctx) => {
      const { checkId, spreadsheetId } = input as { checkId: string; spreadsheetId: string }
      const check = await savedCheck(ctx, checkId)
      // The watch says whether the value is a ratio, which sets its decimal places.
      const watch = await ctx.collections<Watch>('watches').get(check.watchId)
      const sheets = new sheets_v4.Sheets(googleOptions(ctx))
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'A1',
        valueInputOption: 'RAW',
        requestBody: { values: [sheetRow(check, watch?.document.denominator != null)] },
      })
      return { spreadsheetId }
    },
  },
})
