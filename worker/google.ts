import type { docs_v1 } from '@googleapis/docs'
import type { sheets_v4 } from '@googleapis/sheets'
import { placesFor, verdict, type Check, type Watch } from './watch.ts'

export type ExportTarget =
  | { action: 'export-check-to-doc'; input: { documentId: string } }
  | { action: 'export-check-to-sheet'; input: { spreadsheetId: string } }

/** The export action for a Google Doc or Sheet link; null for any other link. */
export function exportTarget(link: string): ExportTarget | null {
  const match = /^https:\/\/docs\.google\.com\/(document|spreadsheets)\/d\/([\w-]+)/.exec(link.trim())
  if (!match) return null
  return match[1] === 'document'
    ? { action: 'export-check-to-doc', input: { documentId: match[2] } }
    : { action: 'export-check-to-sheet', input: { spreadsheetId: match[2] } }
}

/** A check as a paragraph appended at the end of a Doc; its text starts with the metric and the period. */
export const docSection = (check: Check) => `\n${check.text}\n`

export const LINK_TEXT = 'Open in Metric Watch'

/** The plugin's page of a checked period in OWOX, as the host links to the plugin's routes. */
export const periodLink = (owox: string, projectId: string, pluginId: string, check: Pick<Check, 'watchId' | 'asOf'>) =>
  `${owox}/ui/${encodeURIComponent(projectId)}/plugins/${encodeURIComponent(pluginId)}/open/watches/${encodeURIComponent(check.watchId)}/periods/${check.asOf}`

/**
 * Docs requests that add a check before `index`, the body's last newline: its text, then its
 * chart as a picture the width of the page, then a link back to the period. Each request's index
 * counts what the requests before it inserted.
 */
export function docRequests(index: number, check: Check, chart: string | null, link: string | null): docs_v1.Schema$Request[] {
  const text = docSection(check)
  // Typed text takes the style before it, so a check after an earlier one's link would be a link too.
  const requests: docs_v1.Schema$Request[] = [
    { insertText: { location: { index }, text } },
    { updateTextStyle: { range: { startIndex: index, endIndex: index + text.length }, textStyle: {}, fields: 'link,underline,foregroundColor' } },
  ]
  let at = index + text.length
  if (chart) {
    requests.push({ insertInlineImage: { location: { index: at }, uri: chart, objectSize: { width: { magnitude: 468, unit: 'PT' } } } })
    at += 1
  }
  if (link) {
    const start = chart ? at + 1 : at
    requests.push(
      { insertText: { location: { index: at }, text: chart ? `\n${LINK_TEXT}` : LINK_TEXT } },
      { updateTextStyle: { range: { startIndex: start, endIndex: start + LINK_TEXT.length }, textStyle: { link: { url: link } }, fields: 'link' } },
    )
  }
  return requests
}

/**
 * A check as one Sheet row; the value is rounded as in the check's text, two places for a ratio of
 * about 1. The status reads by the watch now, as on the page; without the watch, by the check.
 */
export const sheetRow = (check: Check, watch: Watch | undefined) => [
  watch?.name ?? check.name,
  check.from,
  check.to,
  check.value === null ? null : Number(check.value.toFixed(placesFor(watch?.denominator != null, check.value) ?? 0)),
  check.change,
  watch ? verdict(check, watch).label : check.alert ? 'Alert' : 'OK',
  check.reason,
]

/** A row as Sheet cells, as RAW values would read, ending with a link back to the period when there is one. */
export function sheetCells(row: (string | number | null)[], link: string | null): sheets_v4.Schema$CellData[] {
  const cells: sheets_v4.Schema$CellData[] = row.map(value =>
    value === null ? {} : { userEnteredValue: typeof value === 'number' ? { numberValue: value } : { stringValue: value } },
  )
  if (link) cells.push({ userEnteredValue: { stringValue: LINK_TEXT }, textFormatRuns: [{ startIndex: 0, format: { link: { uri: link } } }] })
  return cells
}

/** Where a schedule adds each check. */
export type ExportTo = { kind: 'Doc'; documentId: string } | { kind: 'Sheet'; spreadsheetId: string }

/** The export target in `check-metric`'s input; both at once is a mistake to report, not to guess. */
export function exportToOf(input: { documentId?: string; spreadsheetId?: string }): ExportTo | null {
  if (input.documentId && input.spreadsheetId) {
    throw Object.assign(new Error('Add each check to a Doc or to a Sheet, not both.'), { code: 'INVALID_EXPORT' })
  }
  if (input.documentId) return { kind: 'Doc', documentId: input.documentId }
  if (input.spreadsheetId) return { kind: 'Sheet', spreadsheetId: input.spreadsheetId }
  return null
}

/** The link of a schedule's export target, as the member pasted it; empty for none. */
export function exportLink(parameters: unknown): string {
  const { documentId, spreadsheetId } = (parameters ?? {}) as { documentId?: unknown; spreadsheetId?: unknown }
  if (typeof documentId === 'string') return `https://docs.google.com/document/d/${documentId}/edit`
  if (typeof spreadsheetId === 'string') return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
  return ''
}

/** A run's error after its check was saved but not exported; the host keeps 1000 characters. */
export function exportFailure(label: string, kind: 'Doc' | 'Sheet', error: unknown): { code: string; message: string } {
  const code = (error as { code?: unknown } | null)?.code === 'GOOGLE_NOT_CONFIGURED' ? 'GOOGLE_NOT_CONFIGURED' : 'EXPORT_FAILED'
  const reason = error instanceof Error ? error.message : String(error)
  return { code, message: `Checked ${label}, but could not add it to the ${kind}: ${reason}`.slice(0, 1000) }
}
