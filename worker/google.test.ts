import assert from 'node:assert/strict'
import test from 'node:test'
import { exportTarget } from './google.ts'

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
