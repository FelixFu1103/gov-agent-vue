import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadKnowledge, searchKnowledge } from '../server/knowledge.js'

const documents = await loadKnowledge(resolve('knowledge/documents'))

const cases = [
  ['单位给员工办理职工医保需要什么材料？', '09-medical-enrollment.md'],
  ['没有工作怎么参加居民医保？', '31-resident-medical-enrollment.md'],
  ['去外省看病如何备案？', '10-cross-region-medical.md'],
  ['住院没有直接结算怎么报销？', '11-medical-reimbursement.md'],
  ['生孩子医疗费怎么报销？', '32-maternity-medical-expense.md']
]

test('knowledge base contains the complete medical insurance slice', () => {
  assert.equal(documents.length, 32)
  for (const [, expected] of cases) assert.ok(documents.some(document => document.filename === expected))
})

for (const [query, expected] of cases) {
  test(`retrieves ${expected} for: ${query}`, () => {
    const results = searchKnowledge(documents, query)
    assert.equal(results[0]?.filename, expected)
  })
}
