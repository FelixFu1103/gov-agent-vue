import test from 'node:test'
import assert from 'node:assert/strict'
import { splitBySections } from '../server/chunking.js'
import { verifyGeneratedAnswer } from '../server/citation-verifier.js'
import { retrievalCases } from '../evaluation/retrieval-cases.js'
import { classify_intent } from '../server/agent-tools.js'

test('contains 165 fixed retrieval evaluation cases', () => {
  assert.equal(retrievalCases.length, 165)
  const correct = retrievalCases.filter(item => classify_intent({ message: item.question }).intent === item.expectedIntent)
  assert.ok(correct.length / retrievalCases.length >= 0.95)
})

test('section chunking preserves headings in long sections', () => {
  const content = `## 办理材料\n${'材料说明。'.repeat(220)}\n## 办理时限\n10个工作日。`
  const chunks = splitBySections(content, 300, 50)
  assert.ok(chunks.length > 2)
  assert.ok(chunks.every(chunk => chunk.startsWith('## ')))
  assert.ok(chunks.some(chunk => chunk.includes('办理时限')))
})

test('citation verifier removes unsupported hotline but keeps supported deadline', () => {
  const result = verifyGeneratedAnswer('结论：可以办理。\n1. 办理时限为10个工作日。\n2. 请拨打12393。', [{ body: '办理时限为10个工作日。' }])
  assert.match(result.answer, /10个工作日/)
  assert.doesNotMatch(result.answer, /12393/)
  assert.equal(result.passed, false)
})
