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

/** A check as a paragraph appended at the end of a Doc; its text starts with the metric and the week. */
export const docSection = (check: Check) => `\n${check.text}\n`

export const LINK_TEXT = 'Open in Metric Watch'

/** The plugin's page of a checked week in OWOX, as the host links to the plugin's routes. */
export const weekLink = (owox: string, projectId: string, pluginId: string, check: Pick<Check, 'watchId' | 'asOf'>) =>
  `${owox}/ui/${encodeURIComponent(projectId)}/plugins/${encodeURIComponent(pluginId)}/open/watches/${encodeURIComponent(check.watchId)}/weeks/${check.asOf}`

/**
 * Docs requests that add a check before `index`, the body's last newline: its text, then its
 * chart as a picture the width of the page, then a link back to the week. Each request's index
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

/** A row as Sheet cells, as RAW values would read, ending with a link back to the week when there is one. */
export function sheetCells(row: (string | number | null)[], link: string | null): sheets_v4.Schema$CellData[] {
  const cells: sheets_v4.Schema$CellData[] = row.map(value =>
    value === null ? {} : { userEnteredValue: typeof value === 'number' ? { numberValue: value } : { stringValue: value } },
  )
  if (link) cells.push({ userEnteredValue: { stringValue: LINK_TEXT }, textFormatRuns: [{ startIndex: 0, format: { link: { uri: link } } }] })
  return cells
}
