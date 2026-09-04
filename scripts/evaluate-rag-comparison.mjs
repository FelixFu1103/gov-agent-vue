import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createKnowledgeDatabase } from '../server/database.js'
import { classify_intent } from '../server/agent-tools.js'
import { createKnowledgeReranker } from '../server/reranker.js'
import { retrievalCases } from '../evaluation/retrieval-cases.js'

function selectCases(cases, requestedLimit) {
  if (!requestedLimit || requestedLimit >= cases.length) return cases
  const groups = Map.groupBy(cases, item => item.expectedIntent)
  const selected = []
  let offset = 0
  while (selected.length < requestedLimit) {
    let added = false
    for (const group of groups.values()) {
      if (group[offset] && selected.length < requestedLimit) {
        selected.push(group[offset])
        added = true
      }
    }
    if (!added) break
    offset += 1
  }
  return selected
}

function createMetrics() {
  return { evaluated: 0, top1Hits: 0, top3Hits: 0, reciprocalRankSum: 0, latencyMs: 0, failures: [] }
}

function record(metrics, item, results, latencyMs) {
  const accepted = item.acceptableDocuments || [item.expectedDocument]
  const rank = results.findIndex(result => accepted.includes(result.documentId))
  metrics.evaluated += 1
  metrics.top1Hits += Number(rank === 0)
  metrics.top3Hits += Number(rank >= 0 && rank < 3)
  metrics.reciprocalRankSum += rank >= 0 ? 1 / (rank + 1) : 0
  metrics.latencyMs += latencyMs
  if (rank !== 0) metrics.failures.push({ id: item.id, expected: accepted, actual: results[0]?.documentId || null, rank: rank < 0 ? null : rank + 1 })
}

function finalize(metrics) {
  const count = metrics.evaluated || 1
  return {
    evaluated: metrics.evaluated,
    top1Accuracy: metrics.top1Hits / count,
    recallAt3: metrics.top3Hits / count,
    mrrAt10: metrics.reciprocalRankSum / count,
    averageLatencyMs: Math.round(metrics.latencyMs / count),
    failures: metrics.failures
  }
}

const requestedLimit = Number(process.env.RAG_EVAL_LIMIT || retrievalCases.length)
const outputPath = resolve(process.env.RAG_EVAL_OUTPUT || 'evaluation/results/rag-comparison-latest.json')
const cases = selectCases(retrievalCases, requestedLimit)
const database = await createKnowledgeDatabase()
if (!database) throw new Error('请配置 DATABASE_URL')
const reranker = createKnowledgeReranker()
const metrics = { keyword: createMetrics(), vector: createMetrics(), rrf: createMetrics(), rerank: createMetrics() }
let intentHits = 0

try {
  for (const [index, item] of cases.entries()) {
    const classified = classify_intent({ message: item.question })
    intentHits += Number(classified.intent === item.expectedIntent)
    const rrfCandidates = await database.search(item.question, {
      limit: 10,
      intent: classified.intent === 'unknown' ? null : classified.intent,
      region: '江苏',
      strategy: 'rrf'
    })
    const trace = rrfCandidates._retrievalTrace
    record(metrics.keyword, item, trace.keyword, trace.timings.keywordMs)
    record(metrics.vector, item, trace.vector, trace.timings.embeddingMs + trace.timings.vectorMs)
    record(metrics.rrf, item, trace.rrf, trace.timings.retrievalMs)

    if (reranker.enabled) {
      const startedAt = performance.now()
      const reranked = await reranker.rerank(item.question, rrfCandidates, { topN: 10, intent: classified.intent })
      record(metrics.rerank, item, reranked, trace.timings.retrievalMs + performance.now() - startedAt)
    }
    if ((index + 1) % 5 === 0 || index + 1 === cases.length) console.log(`Compared ${index + 1}/${cases.length}`)
  }
} finally {
  await database.pool.end()
}

const report = {
  generatedAt: new Date().toISOString(),
  dataset: { evaluated: cases.length, totalAvailable: retrievalCases.length, stratified: cases.length < retrievalCases.length },
  models: { embedding: process.env.EMBEDDING_MODEL || null, reranker: reranker.model, rerankerEnabled: reranker.enabled },
  intentAccuracy: intentHits / cases.length,
  strategies: {
    keyword: finalize(metrics.keyword),
    vector: finalize(metrics.vector),
    rrf: finalize(metrics.rrf),
    rerank: reranker.enabled ? finalize(metrics.rerank) : { available: false }
  }
}

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
console.log(`Report saved to ${outputPath}`)
