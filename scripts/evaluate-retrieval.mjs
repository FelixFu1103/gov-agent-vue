import { createKnowledgeDatabase } from '../server/database.js'
import { classify_intent } from '../server/agent-tools.js'
import { retrievalCases } from '../evaluation/retrieval-cases.js'

const database = await createKnowledgeDatabase()
if (!database) throw new Error('请配置 DATABASE_URL')

let intentCorrect = 0
let top1Correct = 0
let top3Correct = 0
const failures = []

try {
  for (const [index, item] of retrievalCases.entries()) {
    const classified = classify_intent({ message: item.question })
    if (classified.intent === item.expectedIntent) intentCorrect += 1
    const results = await database.search(item.question, { limit: 3, intent: classified.intent === 'unknown' ? null : classified.intent, region: '江苏' })
    if (results[0]?.documentId === item.expectedDocument) top1Correct += 1
    if (results.some(result => result.documentId === item.expectedDocument)) top3Correct += 1
    if (classified.intent !== item.expectedIntent || results[0]?.documentId !== item.expectedDocument) {
      failures.push({ id: item.id, expectedIntent: item.expectedIntent, actualIntent: classified.intent, expectedDocument: item.expectedDocument, actualDocument: results[0]?.documentId })
    }
    if ((index + 1) % 10 === 0) console.log(`Evaluated ${index + 1}/${retrievalCases.length}`)
  }
} finally {
  await database.pool.end()
}

const total = retrievalCases.length
console.log(JSON.stringify({ total, intentAccuracy: intentCorrect / total, top1Accuracy: top1Correct / total, top3Recall: top3Correct / total, failures }, null, 2))
if (intentCorrect / total < 0.95 || top1Correct / total < 0.9 || top3Correct / total < 0.95) process.exitCode = 1
