import assert from 'node:assert/strict'
import test from 'node:test'
import { exportTarget, sheetRow } from './google.ts'
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
