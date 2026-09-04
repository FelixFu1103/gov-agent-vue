import test from 'node:test'
import assert from 'node:assert/strict'
import { createKnowledgeReranker } from '../server/reranker.js'

const documents = [
  { documentId: 'a', title: '参保登记', body: '职工医保参保登记材料' },
  { documentId: 'b', title: '家庭共济', body: '医保个人账户绑定父母' },
  { documentId: 'c', title: '异地备案', body: '跨省异地住院备案' }
]

test('reranks candidates using a compatible rerank API', async () => {
  let requestBody
  const reranker = createKnowledgeReranker({
    env: { RERANK_API_URL: 'https://rerank.example/v1/rerank', RERANK_MODEL: 'bge-reranker-v2-m3' },
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body)
      return { ok: true, json: async () => ({ results: [{ index: 1, relevance_score: 0.97 }, { index: 0, relevance_score: 0.32 }] }) }
    }
  })
  const results = await reranker.rerank('怎么给父母共济', documents, { topN: 2 })
  assert.equal(reranker.enabled, true)
  assert.equal(requestBody.documents.length, 3)
  assert.deepEqual(results.map(item => item.documentId), ['b', 'a'])
  assert.equal(results[0].rerankScore, 0.97)
})

test('disabled reranker preserves candidate order without a network call', async () => {
  const reranker = createKnowledgeReranker({ env: {}, fetchImpl: async () => { throw new Error('must not run') } })
  assert.equal(reranker.enabled, false)
  assert.deepEqual((await reranker.rerank('query', documents, { topN: 2 })).map(item => item.documentId), ['a', 'b'])
})

test('supports the local Hugging Face TEI rerank protocol', async () => {
  let requestBody
  const reranker = createKnowledgeReranker({
    env: {
      RERANK_API_URL: 'http://127.0.0.1:8081/rerank',
      RERANK_API_FORMAT: 'tei',
      RERANK_MODEL: 'BAAI/bge-reranker-v2-m3'
    },
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body)
      return { ok: true, json: async () => [{ index: 0, score: -1.2 }, { index: 2, score: 4.8 }] }
    }
  })
  const results = await reranker.rerank('异地住院', documents, { topN: 2 })
  assert.equal(reranker.apiFormat, 'tei')
  assert.equal(requestBody.texts.length, 3)
  assert.equal(requestBody.documents, undefined)
  assert.deepEqual(results.map(item => item.documentId), ['c', 'a'])
})

test('combines reranker relevance with an exact service intent boost', async () => {
  const candidates = [
    { documentId: 'generic', serviceCode: null, title: '综合指南', body: '零星报销' },
    { documentId: 'specific', serviceCode: 'medical_expense_reimbursement', title: '零星报销指南', body: '住院费用报销' }
  ]
  const reranker = createKnowledgeReranker({
    env: { RERANK_API_URL: 'http://rerank/rerank', RERANK_MODEL: 'bge-reranker-v2-m3' },
    fetchImpl: async () => ({ ok: true, json: async () => ({ results: [{ index: 0, relevance_score: 0.65 }, { index: 1, relevance_score: 0.4 }] }) })
  })
  const results = await reranker.rerank('住院费用怎么报销', candidates, { topN: 2, intent: 'medical_expense_reimbursement' })
  assert.equal(results[0].documentId, 'specific')
  assert.equal(results[0].rerankScore, 0.4)
  assert.equal(results[0].rerankFinalScore, 0.7)
})
