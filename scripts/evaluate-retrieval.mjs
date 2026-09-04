import { createKnowledgeDatabase } from '../server/database.js'
import { classify_intent } from '../server/agent-tools.js'
import { retrievalCases } from '../evaluation/retrieval-cases.js'
import { chunkRetrievalCases } from '../evaluation/chunk-retrieval-cases.js'
import { createKnowledgeReranker } from '../server/reranker.js'

const database = await createKnowledgeDatabase()
if (!database) throw new Error('请配置 DATABASE_URL')
const reranker = createKnowledgeReranker()

let intentCorrect = 0
let top1Correct = 0
let top3Correct = 0
let chunkTop1Correct = 0
let chunkTop3Correct = 0
const failures = []

try {
  for (const [index, item] of retrievalCases.entries()) {
    const classified = classify_intent({ message: item.question })
    if (classified.intent === item.expectedIntent) intentCorrect += 1
    const candidates = await database.search(item.question, { limit: reranker.enabled ? 10 : 3, intent: classified.intent === 'unknown' ? null : classified.intent, region: '江苏' })
    let results = candidates
    if (reranker.enabled) {
      try {
        results = await reranker.rerank(item.question, candidates, { topN: 3 })
      } catch (error) {
        console.warn(`Rerank failed for ${item.id}, using RRF order: ${error.message}`)
        results = candidates.slice(0, 3)
      }
    }
    const acceptableDocuments = item.acceptableDocuments || [item.expectedDocument]
    if (acceptableDocuments.includes(results[0]?.documentId)) top1Correct += 1
    if (results.some(result => acceptableDocuments.includes(result.documentId))) top3Correct += 1
    if (classified.intent !== item.expectedIntent || !acceptableDocuments.includes(results[0]?.documentId)) {
      failures.push({ id: item.id, expectedIntent: item.expectedIntent, actualIntent: classified.intent, expectedDocument: item.expectedDocument, actualDocument: results[0]?.documentId })
    }
    if ((index + 1) % 10 === 0) console.log(`Evaluated ${index + 1}/${retrievalCases.length}`)
  }
  for (const item of chunkRetrievalCases) {
    const results = await database.search(item.question, { limit: 3, intent: item.expectedIntent, region: '江苏' })
    const matches = result => result.documentId === item.expectedDocument && result.sectionType === item.expectedSectionType
    if (matches(results[0])) chunkTop1Correct += 1
    if (results.some(matches)) chunkTop3Correct += 1
    if (!matches(results[0])) failures.push({ id: item.id, expectedDocument: item.expectedDocument, expectedSectionType: item.expectedSectionType, actualDocument: results[0]?.documentId, actualSectionType: results[0]?.sectionType })
  }
} finally {
  await database.pool.end()
}

const total = retrievalCases.length
const chunkTotal = chunkRetrievalCases.length
console.log(JSON.stringify({ total, chunkTotal, reranker: { enabled: reranker.enabled, model: reranker.model }, intentAccuracy: intentCorrect / total, documentTop1Accuracy: top1Correct / total, documentTop3Recall: top3Correct / total, chunkTop1Accuracy: chunkTop1Correct / chunkTotal, chunkTop3Recall: chunkTop3Correct / chunkTotal, failures }, null, 2))
if (intentCorrect / total < 0.95 || top1Correct / total < 0.9 || top3Correct / total < 0.95 || chunkTop1Correct / chunkTotal < 0.8 || chunkTop3Correct / chunkTotal < 0.95) process.exitCode = 1
