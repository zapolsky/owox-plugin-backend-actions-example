import assert from 'node:assert/strict'
import test from 'node:test'
import { docRequests, exportFailure, exportLink, exportTarget, exportToOf, LINK_TEXT, periodLink, sheetCells, sheetRow } from './google.ts'
import type { Check, Watch } from './watch.ts'

test('a Doc link exports to the Doc and a Sheet link to the Sheet', () => {
  assert.deepEqual(exportTarget(' https://docs.google.com/document/d/abc_D-1/edit?tab=t.0 '), {
    action: 'export-check-to-doc',
    input: { documentId: 'abc_D-1' },
  })
  assert.deepEqual(exportTarget('https://docs.google.com/spreadsheets/d/xyz-2/edit#gid=0'), {
    action: 'export-check-to-sheet',
    input: { spreadsheetId: 'xyz-2' },
  })
})

test('any other link exports nowhere', () => {
  for (const link of [
    '',
    'abc',
    'http://docs.google.com/document/d/abc/edit',
    'https://docs.google.com/presentation/d/abc/edit',
    'https://docs.google.com.evil.example/document/d/abc',
  ]) {
    assert.equal(exportTarget(link), null, link)
  }
})

const roas = { name: 'ROAS', numerator: 'revenue', denominator: 'cost', rule: { kind: 'unusual' } } as Watch

test('a Sheet row rounds the value as the check text does', () => {
  const check = { name: 'ROAS', from: '2026-10-08', to: '2026-10-14', change: -25, alert: true, reason: 'Below', usual: { low: 2.2, high: 3.08 } } as Check
  assert.equal(sheetRow({ ...check, value: 1.989461297 }, roas)[3], 1.99)
  assert.equal(sheetRow({ ...check, value: 0.0196321 }, roas)[3], 0.0196)
  assert.equal(sheetRow({ ...check, value: 54138.4 }, { ...roas, denominator: null })[3], 54138)
  assert.equal(sheetRow({ ...check, value: null }, roas)[3], null)
})

test('a Sheet row says what the week means for the watch now', () => {
  const check = { name: 'Old name', from: '2026-08-27', to: '2026-09-02', change: 32, alert: true, reason: 'Above', usual: { low: 2.05, high: 3.09 }, value: 3.48 } as Check
  const row = sheetRow(check, roas)
  assert.equal(row[0], 'ROAS')
  assert.equal(row[5], 'Above usual')
  assert.equal(sheetRow(check, undefined)[5], 'Alert')
})

test('a Sheet row keeps its values as they are and ends with a link under words', () => {
  const cells = sheetCells(['ROAS', '2026-10-08', 1.99, null], 'https://app.owox.com/w')
  assert.deepEqual(cells.slice(0, 4), [
    { userEnteredValue: { stringValue: 'ROAS' } },
    { userEnteredValue: { stringValue: '2026-10-08' } },
    { userEnteredValue: { numberValue: 1.99 } },
    {},
  ])
  assert.deepEqual(cells[4], {
    userEnteredValue: { stringValue: LINK_TEXT },
    textFormatRuns: [{ startIndex: 0, format: { link: { uri: 'https://app.owox.com/w' } } }],
  })
  assert.equal(sheetCells(['ROAS'], null).length, 1)
})

test('a period links to the plugin page that shows it', () => {
  assert.equal(
    periodLink('https://app.owox.com', 'p1', 'plug 1', { watchId: 'w/1', asOf: '2026-10-15' }),
    'https://app.owox.com/ui/p1/plugins/plug%201/open/watches/w%2F1/periods/2026-10-15',
  )
})

test('a Doc gets the text, then the chart, then the link, each at the index the one before left', () => {
  const check = { text: 'ROAS, 8–14 Oct 2026: 1.99' } as Check
  const text = `\n${check.text}\n`
  const requests = docRequests(40, check, 'https://plugin.example/chart.png?d=1', 'https://app.owox.com/w')
  assert.deepEqual(requests.map(request => Object.keys(request)[0]), ['insertText', 'updateTextStyle', 'insertInlineImage', 'insertText', 'updateTextStyle'])
  assert.equal(requests[2].insertInlineImage?.location?.index, 40 + text.length)
  assert.equal(requests[3].insertText?.location?.index, 40 + text.length + 1)
  assert.equal(requests[3].insertText?.text, `\n${LINK_TEXT}`)
  assert.deepEqual(requests[4].updateTextStyle?.range, { startIndex: 40 + text.length + 2, endIndex: 40 + text.length + 2 + LINK_TEXT.length })

  const linkOnly = docRequests(40, check, null, 'https://app.owox.com/w')
  assert.equal(linkOnly[2].insertText?.text, LINK_TEXT)
  assert.deepEqual(linkOnly[3].updateTextStyle?.range, { startIndex: 40 + text.length, endIndex: 40 + text.length + LINK_TEXT.length })
  assert.equal(docRequests(40, check, null, null).length, 2)
})

test("a schedule's export target shows back as a link that exports to the same place", () => {
  assert.equal(exportLink({ watchId: 'w1' }), '')
  assert.equal(exportLink(null), '')
  assert.equal(exportLink({ watchId: 'w1', documentId: 7 }), '')
  assert.deepEqual(exportTarget(exportLink({ watchId: 'w1', documentId: 'abc_D-1' }))?.input, { documentId: 'abc_D-1' })
  assert.deepEqual(exportTarget(exportLink({ watchId: 'w1', spreadsheetId: 'xyz-2' }))?.input, { spreadsheetId: 'xyz-2' })
})

test('a check goes to a Doc or a Sheet, never both', () => {
  assert.equal(exportToOf({}), null)
  assert.deepEqual(exportToOf({ documentId: 'd1' }), { kind: 'Doc', documentId: 'd1' })
  assert.deepEqual(exportToOf({ spreadsheetId: 's1' }), { kind: 'Sheet', spreadsheetId: 's1' })
  assert.throws(() => exportToOf({ documentId: 'd1', spreadsheetId: 's1' }), { code: 'INVALID_EXPORT' })
})

test('a failed export says what was saved, keeps a missing credential its own code and fits the host', () => {
  const missing = Object.assign(new Error('Choose a Google Service Account Credential.'), { code: 'GOOGLE_NOT_CONFIGURED' })
  assert.deepEqual(exportFailure('Sep 2026', 'Doc', missing), {
    code: 'GOOGLE_NOT_CONFIGURED',
    message: 'Checked Sep 2026, but could not add it to the Doc: Choose a Google Service Account Credential.',
  })
  const long = exportFailure('Q3 2026', 'Sheet', new Error('x'.repeat(5000)))
  assert.equal(long.code, 'EXPORT_FAILED')
  assert.equal(long.message.length, 1000)
  assert.ok(long.message.startsWith('Checked Q3 2026, but could not add it to the Sheet: x'))
  assert.equal(exportFailure('19 Oct 2026', 'Doc', 'refused').message, 'Checked 19 Oct 2026, but could not add it to the Doc: refused')
})
