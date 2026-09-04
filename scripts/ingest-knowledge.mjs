import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import pg from 'pg'
import { createEmbedding } from '../server/database.js'
import { loadKnowledge } from '../server/knowledge.js'
import { inferAudience, splitIntoKnowledgeChunks } from '../server/chunking.js'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('请先配置 DATABASE_URL')

function vectorLiteral(values) {
  return values ? `[${values.map(value => Number(value).toFixed(8)).join(',')}]` : null
}

const pool = new Pool({ connectionString: databaseUrl, max: 3 })
const documents = await loadKnowledge(resolve('knowledge/documents'))
const embeddingDimensions = Number(process.env.EMBEDDING_DIMENSIONS || 1024)
const chunkSize = Number(process.env.KNOWLEDGE_CHUNK_SIZE || 180)
const chunkOverlap = Number(process.env.KNOWLEDGE_CHUNK_OVERLAP || 30)
const ingestVersion = `chunks-v2-${chunkSize}-${chunkOverlap}-${process.env.EMBEDDING_MODEL || 'none'}-${embeddingDimensions}`
const serviceCodes = {
  '09-medical-enrollment.md': 'medical_employee_enrollment',
  '10-cross-region-medical.md': 'cross_region_medical_filing',
  '11-medical-reimbursement.md': 'medical_expense_reimbursement',
  '31-resident-medical-enrollment.md': 'medical_resident_enrollment',
  '32-maternity-medical-expense.md': 'maternity_medical_payment',
  '33-family-mutual-aid.md': 'medical_family_mutual_aid',
  '34-unit-enrollment.md': 'medical_unit_enrollment',
  '35-insured-info-change.md': 'medical_insured_info_change',
  '36-contribution-base-declaration.md': 'medical_contribution_base_declaration',
  '37-insurance-info-query.md': 'medical_insurance_info_query',
  '38-personal-account-withdrawal.md': 'medical_personal_account_withdrawal',
  '39-insurance-transfer.md': 'medical_insurance_transfer',
  '40-outpatient-chronic-special.md': 'outpatient_chronic_special_disease',
  '41-dual-channel-drug.md': 'dual_channel_drug_qualification',
  '42-maternity-allowance.md': 'maternity_allowance_payment'
}
let chunkCount = 0
let embeddedChunkCount = 0
let unchangedDocumentCount = 0

try {
  if (!Number.isInteger(embeddingDimensions) || embeddingDimensions < 1 || embeddingDimensions > 16_000) throw new Error('EMBEDDING_DIMENSIONS 不合法')
  await pool.query('DROP INDEX IF EXISTS knowledge_chunks_embedding_idx')
  await pool.query('ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS service_code TEXT')
  await pool.query('ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS effective_from DATE')
  await pool.query('ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS effective_to DATE')
  await pool.query('ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS source_document_url TEXT')
  await pool.query('ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS policy_level TEXT')
  await pool.query('ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS content_kind TEXT')
  await pool.query('ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS publication_date DATE')
  await pool.query('ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS ingest_version TEXT')
  await pool.query("ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS section_title TEXT NOT NULL DEFAULT '正文'")
  await pool.query("ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS section_type TEXT NOT NULL DEFAULT 'general'")
  await pool.query('ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS audience TEXT')
  await pool.query('CREATE INDEX IF NOT EXISTS knowledge_documents_service_code_idx ON knowledge_documents(service_code)')
  await pool.query('CREATE INDEX IF NOT EXISTS knowledge_documents_effective_dates_idx ON knowledge_documents(effective_from, effective_to)')
  await pool.query('CREATE INDEX IF NOT EXISTS knowledge_chunks_section_type_idx ON knowledge_chunks(section_type)')
  await pool.query(`ALTER TABLE knowledge_chunks ALTER COLUMN embedding TYPE vector(${embeddingDimensions})`)
  await pool.query('CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_idx ON knowledge_chunks USING hnsw (embedding vector_cosine_ops)')
  const activeExternalIds = documents.map(document => document.filename)
  await pool.query("UPDATE knowledge_documents SET status = 'archived', updated_at = NOW() WHERE NOT (external_id = ANY($1::text[]))", [activeExternalIds])
  for (const document of documents) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const contentHash = createHash('sha256').update(document.body).digest('hex')
      const previous = await client.query('SELECT id, content_hash, ingest_version FROM knowledge_documents WHERE external_id = $1', [document.filename])
      const unchanged = previous.rows[0]?.content_hash === contentHash && previous.rows[0]?.ingest_version === ingestVersion
      const { rows } = await client.query(`
        INSERT INTO knowledge_documents
          (external_id, service_code, title, department, region, topic, keywords, policy_level, content_kind, source_url, source_notice_url, source_document_url, verified_at, publication_date, effective_from, effective_to, version_note, priority, content_hash, ingest_version, status, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'published',NOW())
        ON CONFLICT (external_id) DO UPDATE SET
          service_code=EXCLUDED.service_code, title=EXCLUDED.title, department=EXCLUDED.department, region=EXCLUDED.region,
          topic=EXCLUDED.topic, keywords=EXCLUDED.keywords, policy_level=EXCLUDED.policy_level, content_kind=EXCLUDED.content_kind, source_url=EXCLUDED.source_url,
          source_notice_url=EXCLUDED.source_notice_url, source_document_url=EXCLUDED.source_document_url, verified_at=EXCLUDED.verified_at,
          publication_date=EXCLUDED.publication_date, effective_from=EXCLUDED.effective_from, effective_to=EXCLUDED.effective_to,
          version_note=EXCLUDED.version_note, priority=EXCLUDED.priority,
          content_hash=EXCLUDED.content_hash, ingest_version=EXCLUDED.ingest_version, status='published', updated_at=NOW()
        RETURNING id
      `, [document.filename, document.service_code || serviceCodes[document.filename] || null, document.title, document.department, document.region, document.topic, document.keywords, document.policy_level || (document.region === '江苏省' ? '省级' : '市级'), document.content_kind || '办事指南', document.source, document.source_notice || null, document.source_document || null, document.verified_at, document.publication_date || null, document.effective_from || null, document.effective_to || null, document.version_note, document.priority, contentHash, ingestVersion])
      const documentId = rows[0].id
      if (unchanged) {
        const existing = await client.query('SELECT COUNT(*)::int AS count FROM knowledge_chunks WHERE document_id = $1', [documentId])
        if (existing.rows[0].count > 0) {
          chunkCount += existing.rows[0].count
          unchangedDocumentCount += 1
          await client.query('COMMIT')
          continue
        }
      }
      await client.query('DELETE FROM knowledge_chunks WHERE document_id = $1', [documentId])
      const chunks = splitIntoKnowledgeChunks(document.body, chunkSize, chunkOverlap)
      for (let index = 0; index < chunks.length; index += 1) {
        const { content, sectionTitle, sectionType } = chunks[index]
        const audience = document.audience || inferAudience(`${document.title} ${document.topic || ''} ${content}`)
        const searchable = `${document.title} ${document.topic || ''} ${document.keywords || ''} ${sectionTitle} ${audience || ''} ${content}`
        let embedding = null
        try { embedding = await createEmbedding(searchable) } catch (error) { console.warn(`Embedding skipped for ${document.filename}#${index}: ${error.message}`) }
        if (embedding) embeddedChunkCount += 1
        await client.query(`
          INSERT INTO knowledge_chunks (document_id, chunk_index, section_title, section_type, audience, content, search_text, embedding, token_estimate)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8::vector,$9)
        `, [documentId, index, sectionTitle, sectionType, audience, content, searchable, vectorLiteral(embedding), Math.ceil(content.length / 2)])
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
  console.log(`Imported ${documents.length} documents and ${chunkCount} chunks; embedded ${embeddedChunkCount} changed chunks; reused ${unchangedDocumentCount} unchanged documents.`)
} finally {
  await pool.end()
}
