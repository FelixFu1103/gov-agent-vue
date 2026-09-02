import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import pg from 'pg'
import { createEmbedding } from '../server/database.js'
import { loadKnowledge } from '../server/knowledge.js'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('请先配置 DATABASE_URL')

function splitText(text, size = 800, overlap = 120) {
  const normalized = text.replace(/\r/g, '').trim()
  const chunks = []
  let start = 0
  while (start < normalized.length) {
    let end = Math.min(start + size, normalized.length)
    if (end < normalized.length) {
      const boundary = Math.max(normalized.lastIndexOf('\n', end), normalized.lastIndexOf('。', end))
      if (boundary > start + size / 2) end = boundary + 1
    }
    chunks.push(normalized.slice(start, end).trim())
    if (end >= normalized.length) break
    start = Math.max(start + 1, end - overlap)
  }
  return chunks.filter(Boolean)
}

function vectorLiteral(values) {
  return values ? `[${values.map(value => Number(value).toFixed(8)).join(',')}]` : null
}

const pool = new Pool({ connectionString: databaseUrl, max: 3 })
const documents = await loadKnowledge(resolve('knowledge/documents'))
let chunkCount = 0

try {
  for (const document of documents) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const contentHash = createHash('sha256').update(document.body).digest('hex')
      const { rows } = await client.query(`
        INSERT INTO knowledge_documents
          (external_id, title, department, region, topic, keywords, source_url, source_notice_url, verified_at, version_note, priority, content_hash, status, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'published',NOW())
        ON CONFLICT (external_id) DO UPDATE SET
          title=EXCLUDED.title, department=EXCLUDED.department, region=EXCLUDED.region,
          topic=EXCLUDED.topic, keywords=EXCLUDED.keywords, source_url=EXCLUDED.source_url,
          source_notice_url=EXCLUDED.source_notice_url, verified_at=EXCLUDED.verified_at,
          version_note=EXCLUDED.version_note, priority=EXCLUDED.priority,
          content_hash=EXCLUDED.content_hash, status='published', updated_at=NOW()
        RETURNING id
      `, [document.filename, document.title, document.department, document.region, document.topic, document.keywords, document.source, document.source_notice, document.verified_at, document.version_note, document.priority, contentHash])
      const documentId = rows[0].id
      await client.query('DELETE FROM knowledge_chunks WHERE document_id = $1', [documentId])
      const chunks = splitText(document.body)
      for (let index = 0; index < chunks.length; index += 1) {
        const content = chunks[index]
        const searchable = `${document.title} ${document.topic || ''} ${document.keywords || ''} ${content}`
        let embedding = null
        try { embedding = await createEmbedding(searchable) } catch (error) { console.warn(`Embedding skipped for ${document.filename}#${index}: ${error.message}`) }
        await client.query(`
          INSERT INTO knowledge_chunks (document_id, chunk_index, content, search_text, embedding, token_estimate)
          VALUES ($1,$2,$3,$4,$5::vector,$6)
        `, [documentId, index, content, searchable, vectorLiteral(embedding), Math.ceil(content.length / 2)])
        chunkCount += 1
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
  console.log(`Imported ${documents.length} documents and ${chunkCount} chunks.`)
} finally {
  await pool.end()
}
