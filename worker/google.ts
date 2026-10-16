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
