import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import pg from 'pg'
import { createEmbedding } from '../server/database.js'
import { loadKnowledge } from '../server/knowledge.js'
import { splitBySections } from '../server/chunking.js'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('请先配置 DATABASE_URL')

function vectorLiteral(values) {
  return values ? `[${values.map(value => Number(value).toFixed(8)).join(',')}]` : null
}

const pool = new Pool({ connectionString: databaseUrl, max: 3 })
const documents = await loadKnowledge(resolve('knowledge/documents'))
const embeddingDimensions = Number(process.env.EMBEDDING_DIMENSIONS || 1024)
const serviceCodes = {
  '09-medical-enrollment.md': 'medical_employee_enrollment',
  '10-cross-region-medical.md': 'cross_region_medical_filing',
  '11-medical-reimbursement.md': 'medical_expense_reimbursement',
  '31-resident-medical-enrollment.md': 'medical_resident_enrollment',
  '32-maternity-medical-expense.md': 'maternity_medical_payment'
}
let chunkCount = 0

try {
  if (!Number.isInteger(embeddingDimensions) || embeddingDimensions < 1 || embeddingDimensions > 16_000) throw new Error('EMBEDDING_DIMENSIONS 不合法')
  await pool.query('DROP INDEX IF EXISTS knowledge_chunks_embedding_idx')
  await pool.query('ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS service_code TEXT')
  await pool.query('ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS effective_from DATE')
  await pool.query('ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS effective_to DATE')
  await pool.query('CREATE INDEX IF NOT EXISTS knowledge_documents_service_code_idx ON knowledge_documents(service_code)')
  await pool.query('CREATE INDEX IF NOT EXISTS knowledge_documents_effective_dates_idx ON knowledge_documents(effective_from, effective_to)')
  await pool.query(`ALTER TABLE knowledge_chunks ALTER COLUMN embedding TYPE vector(${embeddingDimensions})`)
  await pool.query('CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_idx ON knowledge_chunks USING hnsw (embedding vector_cosine_ops)')
  for (const document of documents) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const contentHash = createHash('sha256').update(document.body).digest('hex')
      const { rows } = await client.query(`
        INSERT INTO knowledge_documents
          (external_id, service_code, title, department, region, topic, keywords, source_url, source_notice_url, verified_at, effective_from, effective_to, version_note, priority, content_hash, status, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'published',NOW())
        ON CONFLICT (external_id) DO UPDATE SET
          service_code=EXCLUDED.service_code, title=EXCLUDED.title, department=EXCLUDED.department, region=EXCLUDED.region,
          topic=EXCLUDED.topic, keywords=EXCLUDED.keywords, source_url=EXCLUDED.source_url,
          source_notice_url=EXCLUDED.source_notice_url, verified_at=EXCLUDED.verified_at,
          effective_from=EXCLUDED.effective_from, effective_to=EXCLUDED.effective_to,
          version_note=EXCLUDED.version_note, priority=EXCLUDED.priority,
          content_hash=EXCLUDED.content_hash, status='published', updated_at=NOW()
        RETURNING id
      `, [document.filename, serviceCodes[document.filename] || null, document.title, document.department, document.region, document.topic, document.keywords, document.source, document.source_notice, document.verified_at, document.effective_from || null, document.effective_to || null, document.version_note, document.priority, contentHash])
      const documentId = rows[0].id
      await client.query('DELETE FROM knowledge_chunks WHERE document_id = $1', [documentId])
      const chunks = splitBySections(document.body)
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
