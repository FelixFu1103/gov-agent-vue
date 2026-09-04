import test from 'node:test'
import assert from 'node:assert/strict'
import { inferAudience, inferQuerySectionType, inferSectionType, splitBySections, splitIntoKnowledgeChunks } from '../server/chunking.js'
import { verifyGeneratedAnswer } from '../server/citation-verifier.js'
import { fuseRankedChunks } from '../server/database.js'
import { retrievalCases } from '../evaluation/retrieval-cases.js'
import { chunkRetrievalCases } from '../evaluation/chunk-retrieval-cases.js'
import { classify_intent } from '../server/agent-tools.js'

test('contains 165 fixed retrieval evaluation cases', () => {
  assert.equal(retrievalCases.length, 165)
  const correct = retrievalCases.filter(item => classify_intent({ message: item.question }).intent === item.expectedIntent)
  assert.ok(correct.length / retrievalCases.length >= 0.95)
})

test('contains section-level retrieval cases for every supported intent', () => {
  assert.equal(chunkRetrievalCases.length, 15)
  assert.equal(new Set(chunkRetrievalCases.map(item => item.expectedIntent)).size, 15)
  assert.ok(chunkRetrievalCases.every(item => item.expectedSectionType && item.expectedDocument))
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

test('chunk metadata classifies headings and audiences', () => {
  const chunks = splitIntoKnowledgeChunks('## 办理材料\n职工医保参保人员提交身份证明。\n## 办理时限和费用\n即时办结。')
  assert.equal(chunks[0].sectionType, 'materials')
  assert.equal(chunks[1].sectionType, 'deadline_fee')
  assert.equal(inferSectionType('回答边界'), 'cautions')
  assert.match(inferAudience(chunks[0].content), /职工医保参保人/)
  assert.equal(inferQuerySectionType('医保关系转移总共需要多长时间？'), 'deadline_fee')
  assert.equal(inferQuerySectionType('需要提交哪些票据和材料？'), 'materials')
})

test('RRF keeps multiple chunks from the same document and records channel ranks', () => {
  const keyword = [
    { chunkId: '1', documentId: 'same.md', chunkIndex: 0, rawScore: 0.8 },
    { chunkId: '2', documentId: 'same.md', chunkIndex: 1, rawScore: 0.7 }
  ]
  const vector = [
    { chunkId: '2', documentId: 'same.md', chunkIndex: 1, rawScore: 0.9 },
    { chunkId: '3', documentId: 'other.md', chunkIndex: 0, rawScore: 0.8 }
  ]
  const fused = fuseRankedChunks(keyword, vector)
  assert.deepEqual(fused.map(item => item.chunkId), ['2', '1', '3'])
  assert.equal(fused[0].keywordRank, 2)
  assert.equal(fused[0].vectorRank, 1)
})

test('citation verifier removes references outside the supplied chunk list', () => {
  const result = verifyGeneratedAnswer('结论：可以办理[资料1]。\n补充：另有规定[资料4]。', [{ body: '可以办理。' }])
  assert.match(result.answer, /\[资料1\]/)
  assert.doesNotMatch(result.answer, /资料4/)
  assert.deepEqual(result.invalidReferences, [4])
  assert.deepEqual(result.citedReferences, [1])
})
