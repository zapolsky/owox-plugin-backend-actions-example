import assert from 'node:assert/strict'
import test from 'node:test'
import { exportTarget, sheetRow } from './google.ts'
import type { Check } from './watch.ts'

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

test('a Sheet row rounds the value as the check text does', () => {
  const check = { name: 'ROAS', from: '2026-10-08', to: '2026-10-14', change: -25, alert: true, reason: 'Below' } as Check
  assert.equal(sheetRow({ ...check, value: 1.989461297 }, true)[3], 1.99)
  assert.equal(sheetRow({ ...check, value: 0.0196321 }, true)[3], 0.0196)
  assert.equal(sheetRow({ ...check, value: 54138.4 }, false)[3], 54138)
  assert.equal(sheetRow({ ...check, value: null }, true)[3], null)
})
