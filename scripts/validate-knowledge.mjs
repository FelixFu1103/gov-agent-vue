import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { loadKnowledge } from '../server/knowledge.js'
import { splitIntoKnowledgeChunks } from '../server/chunking.js'

const documents = await loadKnowledge(resolve('knowledge/documents'))
const chunkSize = Number(process.env.KNOWLEDGE_CHUNK_SIZE || 180)
const chunkOverlap = Number(process.env.KNOWLEDGE_CHUNK_OVERLAP || 30)
const errors = []
const warnings = []
const hashes = new Map()
let chunks = 0

for (const document of documents) {
  const label = document.filename
  for (const field of ['title', 'department', 'region', 'source', 'verified_at', 'version_note']) {
    if (!document[field]) errors.push(`${label}: 缺少 ${field}`)
  }
  try {
    const source = new URL(document.source)
    if (source.protocol !== 'https:') errors.push(`${label}: source 必须使用 HTTPS`)
    if (!source.hostname.endsWith('.gov.cn') && source.hostname !== 'gov.cn') errors.push(`${label}: source 不是 gov.cn 官方域名`)
  } catch {
    errors.push(`${label}: source URL 无效`)
  }
  if (document.source_document) {
    try {
      const sourceDocument = new URL(document.source_document)
      if (!sourceDocument.hostname.endsWith('.gov.cn') && sourceDocument.hostname !== 'gov.cn') errors.push(`${label}: source_document 不是 gov.cn 官方域名`)
    } catch {
      errors.push(`${label}: source_document URL 无效`)
    }
  }
  const verified = Date.parse(document.verified_at)
  if (!Number.isFinite(verified)) errors.push(`${label}: verified_at 日期无效`)
  else if (Date.now() - verified > 400 * 24 * 60 * 60 * 1000) warnings.push(`${label}: 超过400天未核验`)
  if (document.effective_from && document.effective_to && document.effective_from > document.effective_to) errors.push(`${label}: 生效日期晚于失效日期`)
  if (document.body.length < 80) errors.push(`${label}: 正文过短`)
  const hash = createHash('sha256').update(document.body).digest('hex')
  if (hashes.has(hash)) warnings.push(`${label}: 与 ${hashes.get(hash)} 正文完全重复`)
  else hashes.set(hash, label)
  chunks += splitIntoKnowledgeChunks(document.body, chunkSize, chunkOverlap).length
}

const result = { documents: documents.length, estimatedChunks: chunks, chunkSize, chunkOverlap, errors, warnings }
console.log(JSON.stringify(result, null, 2))
if (errors.length) process.exitCode = 1
