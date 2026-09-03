import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { buildRetrievalQuery, loadKnowledge, searchKnowledge } from '../server/knowledge.js'

const documents = await loadKnowledge(resolve('knowledge/documents'))

const cases = [
  ['单位给员工办理职工医保需要什么材料？', '09-medical-enrollment.md'],
  ['没有工作怎么参加居民医保？', '31-resident-medical-enrollment.md'],
  ['去外省看病如何备案？', '10-cross-region-medical.md'],
  ['住院没有直接结算怎么报销？', '11-medical-reimbursement.md'],
  ['生孩子医疗费怎么报销？', '32-maternity-medical-expense.md']
]

test('knowledge base contains the complete medical insurance slice', () => {
  assert.equal(documents.length, 5)
  for (const [, expected] of cases) assert.ok(documents.some(document => document.filename === expected))
})

for (const [query, expected] of cases) {
  test(`retrieves ${expected} for: ${query}`, () => {
    const results = searchKnowledge(documents, query)
    assert.equal(results[0]?.filename, expected)
  })
}

test('keeps the medical topic when the next turn only supplies cities and insurance type', () => {
  const history = [
    { role: 'user', content: '我准备去外省住院看病，需要提前办理什么手续？' },
    { role: 'assistant', content: '通常需要先办理异地就医备案。' }
  ]
  const query = buildRetrievalQuery(history, '我参加的是南京职工医保，准备去上海住院。')
  const results = searchKnowledge(documents, query)
  assert.equal(results[0]?.filename, '10-cross-region-medical.md')
})
