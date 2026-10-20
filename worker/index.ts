import { docs_v1 } from '@googleapis/docs'
import { sheets_v4 } from '@googleapis/sheets'
import { createBackend, exactCredential, type BackendActionContext } from '@owox/plugin-sdk/server'
import { CHART_PATH, CHART_PERIODS, chartLink, chartOf, chartSvg, chartWeeks, type ChartData } from './chart'
import { docRequests, exportFailure, exportToOf, periodLink, sheetCells, sheetRow } from './google'
import { png } from './png'
import { asOfFor, firstDayFor, granularityOf, periodLabel, shiftDay, shiftPeriod, today, type Granularity } from './period'
import { checkPeriod, missingColumnsMessage, placesOf, type Check, type SumRow, type Watch } from './watch'

type Env = {
  /** Signs chart links; set with `npx wrangler secret put CHART_KEY`. Without it a Doc gets no chart. */
  CHART_KEY?: string
}

/** What a chart link needs: this Worker's origin and the key that signs it. */
type Charts = { worker: string; key: string | null }

const failure = (code: string, message: string) => Object.assign(new Error(message), { code })

/**
 * Sums of the watched columns between two days, per day for a day or week watch and per month or
 * quarter for those, per combination of the watch's dimensions, in one Data Mart run: totals and
 * each dimension's split are summed from the same rows. A truncated date keeps its column's name,
 * so each row's `day` is its period's first day.
 * ponytail: rows grow with the product of the dimensions' values (periods × channels × campaigns × …);
 * fine for tens of thousands, switch back to one run per dimension for high-cardinality columns.
 */
async function readSums(ctx: BackendActionContext, watch: Watch, from: string, to: string, granularity: Granularity) {
  const summed = [watch.numerator, ...(watch.denominator ? [watch.denominator] : [])]
  const unit = granularity === 'month' ? 'MONTH' : granularity === 'quarter' ? 'QUARTER' : null
  const data = await ctx.owox.dataMarts.traverseData(watch.dataMartId, {
    column: [watch.dateColumn, ...watch.dimensions, ...summed],
    aggregation: summed.map(column => ({ column, function: 'SUM' as const })),
    ...(unit ? { dateTrunc: [{ column: watch.dateColumn, unit }] } : {}),
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

/** The chart of a check as the page draws it: the watch's last weeks up to the check's, the check highlighted. */
async function chartOfCheck(ctx: BackendActionContext, check: Check, watch: Watch): Promise<ChartData> {
  const history: Check[] = []
  let cursor: string | null = null
  do {
    const page = await ctx.collections<Check>('checks').list({ limit: 100, ...(cursor ? { cursor } : {}) })
    history.push(...page.items.map(item => item.document).filter(item => item.watchId === check.watchId && item.asOf <= check.asOf))
    cursor = page.nextCursor
  } while (cursor)
  const recent = history.sort((a, b) => a.asOf.localeCompare(b.asOf)).slice(-CHART_PERIODS)
  return {
    format: watch.format,
    granularity: granularityOf(watch),
    places: placesOf(check, watch),
    weeks: chartWeeks(recent, watch),
    selected: recent.findIndex(item => item.asOf === check.asOf),
  }
}

/** A link to a check's period on the plugin's page in OWOX. */
const linkOf = (ctx: BackendActionContext, check: Check) =>
  periodLink(ctx.host, ctx.execution.projectId, ctx.execution.plugin.id, check)

/**
 * Appends a check at the end of a Google Doc shared with the service account: its text, its chart
 * and a link back to the period. Docs fetches the chart from this Worker while the request runs.
 */
async function addToDoc(ctx: BackendActionContext, charts: Charts, check: Check, documentId: string) {
  const watch = (await ctx.collections<Watch>('watches').get(check.watchId))?.document
  const docs = new docs_v1.Docs(googleOptions(ctx))
  const chart = watch && charts.key ? await chartLink(charts.worker, await chartOfCheck(ctx, check, watch), charts.key) : null
  const { data } = await docs.documents.get({ documentId, fields: 'body(content(endIndex))' })
  const end = data.body?.content?.at(-1)?.endIndex ?? 1
  await docs.documents.batchUpdate({
    documentId,
    requestBody: { requests: docRequests(end - 1, check, chart, linkOf(ctx, check)) },
  })
}

/** Appends a check as one row of the first sheet of a Google Sheet shared with the service account. */
async function addToSheet(ctx: BackendActionContext, check: Check, spreadsheetId: string) {
  // The watch sets the value's decimal places and what the period means now.
  const watch = await ctx.collections<Watch>('watches').get(check.watchId)
  const sheets = new sheets_v4.Sheets(googleOptions(ctx))
  const { data } = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets(properties(sheetId))' })
  // Cells rather than values: only a cell can show a link under its own words.
  const row = sheetCells(sheetRow(check, watch?.document), linkOf(ctx, check))
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ appendCells: { sheetId: data.sheets?.[0]?.properties?.sheetId ?? 0, rows: [{ values: row }], fields: 'userEnteredValue,textFormatRuns' } }],
    },
  })
}

const backend = (charts: Charts) => createBackend({
  // This repository on GitHub: OWOX runs nothing here for an execution of another plugin.
  repositoryId: '1419740594',
  actions: {
    /**
     * Checks the watch's last full period, and with `periods` the ones before it too, into the
     * `checks` history; with a Doc or Sheet, adds the newest check there.
     */
    'check-metric': async (input, ctx) => {
      const { watchId, periods, weeks, timeZone, ...target } = input as {
        watchId: string
        periods?: number
        /** The old name of `periods`, sent by a page opened before periods. */
        weeks?: number
        timeZone?: string
        documentId?: string
        spreadsheetId?: string
      }
      const exportTo = exportToOf(target)
      const count = periods ?? weeks ?? 1
      const saved = await ctx.collections<Watch>('watches').get(watchId)
      if (!saved) throw failure('WATCH_NOT_FOUND', 'This watch no longer exists.')
      const watch = saved.document
      const dataMart = (await ctx.owox.dataMarts.list()).find(item => item.id === watch.dataMartId)
      if (!dataMart) throw failure('DATA_MART_NOT_FOUND', 'This Data Mart is not available to you.')

      const granularity = granularityOf(watch)
      const asOf = asOfFor(granularity, today(timeZone))
      const [from, to] = [firstDayFor(granularity, asOf, count), shiftDay(asOf, -1)]
      let sums: Awaited<ReturnType<typeof readSums>>
      try {
        sums = await readSums(ctx, watch, from, to, granularity)
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
      let newest: Check | null = null
      for (let k = 0; k < count; k++) {
        const check = { ...checkPeriod(watchId, watch, shiftPeriod(granularity, asOf, -k), totals, byDimension, checkedAt), trigger: ctx.execution.trigger }
        await history.put(`${watchId}~${check.asOf}`, check)
        newest ??= check
      }

      // After saving, so a failed export loses no check; the run fails so that the member sees it.
      if (exportTo && newest) {
        try {
          if (exportTo.kind === 'Doc') await addToDoc(ctx, charts, newest, exportTo.documentId)
          else await addToSheet(ctx, newest, exportTo.spreadsheetId)
        } catch (error) {
          if (ctx.signal.aborted) throw error
          const { code, message } = exportFailure(periodLabel(granularity, newest.from, newest.to), exportTo.kind, error)
          throw failure(code, message)
        }
      }
      return { checked: count }
    },

    /** Appends a check at the end of a Google Doc shared with the service account. */
    'export-check-to-doc': async (input, ctx) => {
      const { checkId, documentId } = input as { checkId: string; documentId: string }
      await addToDoc(ctx, charts, await savedCheck(ctx, checkId), documentId)
      return { documentId }
    },

    /** Appends a check as one row of the first sheet of a Google Sheet shared with the service account. */
    'export-check-to-sheet': async (input, ctx) => {
      const { checkId, spreadsheetId } = input as { checkId: string; spreadsheetId: string }
      await addToSheet(ctx, await savedCheck(ctx, checkId), spreadsheetId)
      return { spreadsheetId }
    },
  },
})

/** A chart link's picture; 404 for a link this Worker did not sign or one that has expired. */
async function chartImage(url: URL, env: Env) {
  const data = env.CHART_KEY ? await chartOf(url, env.CHART_KEY) : null
  const svg = data && chartSvg(data)
  if (!svg) return new Response('Not found', { status: 404 })
  return new Response(new Uint8Array(await png(svg)), { headers: { 'content-type': 'image/png', 'cache-control': 'private, max-age=600' } })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === CHART_PATH) return chartImage(url, env)
    return backend({ worker: url.origin, key: env.CHART_KEY ?? null }).fetch(request)
  },
}
