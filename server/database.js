import pg from 'pg'
import { inferQuerySectionType } from './chunking.js'

const { Pool } = pg

function vectorLiteral(values) {
  return `[${values.map(value => Number(value).toFixed(8)).join(',')}]`
}

export function fuseRankedChunks(keywordRows, vectorRows, rrfK = 60) {
  const fused = new Map()
  const addRanked = (rows, channel) => {
    rows.forEach((row, index) => {
      const key = row.chunkId || `${row.documentId}:${row.chunkIndex}`
      const current = fused.get(key) || { ...row, score: 0, channels: [], keywordScore: 0, vectorScore: 0, keywordRank: null, vectorRank: null }
      current.score += 1 / (rrfK + index + 1)
      if (!current.channels.includes(channel)) current.channels.push(channel)
      current[`${channel}Score`] = Math.max(current[`${channel}Score`], Number(row.rawScore))
      current[`${channel}Rank`] = index + 1
      fused.set(key, current)
    })
  }
  addRanked(keywordRows, 'keyword')
  addRanked(vectorRows, 'vector')
  return [...fused.values()].sort((a, b) => b.score - a.score)
}

export async function createEmbedding(text) {
  const url = process.env.EMBEDDING_API_URL
  const apiKey = process.env.EMBEDDING_API_KEY
  const model = process.env.EMBEDDING_MODEL
  const dimensions = Number(process.env.EMBEDDING_DIMENSIONS || 1024)
  if (!url || !model) return null
  const isOllama = /\/api\/embed\/?$/.test(url)
  const response = await fetch(url, {
    method: 'POST',
    headers: { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify(isOllama ? { model, input: text } : { model, input: text, dimensions }),
    signal: AbortSignal.timeout(30_000)
  })
  const result = await response.json()
  const embedding = isOllama ? result.embeddings?.[0] : result.data?.[0]?.embedding
  if (!response.ok || !Array.isArray(embedding)) throw new Error(`Embedding API error: ${response.status}`)
  if (embedding.length !== dimensions) throw new Error(`Embedding dimension mismatch: expected ${dimensions}, got ${embedding.length}`)
  return embedding
}

export async function createKnowledgeDatabase() {
  if (!process.env.DATABASE_URL) return null
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 })
  await pool.query('SELECT 1 FROM knowledge_chunks LIMIT 1')

  return {
    pool,
    async search(query, options = {}) {
      const { limit = 3, intent = null, region = null } = typeof options === 'number' ? { limit: options } : options
      const candidateLimit = 20
      const requestedSectionType = inferQuerySectionType(query)
      let embedding = null
      try {
        embedding = await createEmbedding(query)
      } catch (error) {
        console.warn('Embedding request failed, using text search:', error.message)
      }
      const commonSql = `
        FROM knowledge_chunks kc
        JOIN knowledge_documents kd ON kd.id = kc.document_id
        WHERE kd.status = 'published'
          AND $1::text IS NOT NULL
          AND (kd.effective_from IS NULL OR kd.effective_from <= CURRENT_DATE)
          AND (kd.effective_to IS NULL OR kd.effective_to >= CURRENT_DATE)
          AND ($3::text IS NULL OR kd.service_code = $3 OR kd.service_code IS NULL)
          AND ($4::text IS NULL OR kd.region = '江苏省' OR kd.region ILIKE '%' || $4 || '%')`
      const params = [query, candidateLimit, intent, region, requestedSectionType]
      const keywordResult = await pool.query(`
        SELECT kc.id::text AS "chunkId", kc.chunk_index AS "chunkIndex",
          kc.section_title AS "sectionTitle", kc.section_type AS "sectionType", kc.audience,
          kd.external_id AS "documentId", kd.service_code AS "serviceCode", kd.title, kd.department, kd.region,
          kd.policy_level AS "policyLevel", kd.content_kind AS "contentKind", kd.publication_date AS "publicationDate",
          kd.effective_from AS "effectiveFrom", kd.effective_to AS "effectiveTo",
          kd.verified_at AS "verifiedAt", kd.version_note AS "versionNote", kd.source_url AS source,
          kd.source_document_url AS "sourceDocument",
          kc.content AS body, similarity(kc.search_text, $1) +
          CASE WHEN kc.search_text ILIKE '%' || $1 || '%' THEN 0.5 ELSE 0 END +
          CASE WHEN $5::text IS NOT NULL AND kc.section_type = $5 THEN 0.35 ELSE 0 END +
          CASE WHEN kd.priority = 'high' THEN 0.2 ELSE 0 END +
          CASE WHEN $4::text IS NOT NULL AND kd.region ILIKE '%' || $4 || '%' THEN 0.12 ELSE 0 END AS "rawScore"
        ${commonSql}
        ORDER BY "rawScore" DESC
        LIMIT $2`, params)

      let vectorRows = []
      if (embedding) {
        const vectorResult = await pool.query(`
          SELECT kc.id::text AS "chunkId", kc.chunk_index AS "chunkIndex",
            kc.section_title AS "sectionTitle", kc.section_type AS "sectionType", kc.audience,
            kd.external_id AS "documentId", kd.service_code AS "serviceCode", kd.title, kd.department, kd.region,
            kd.policy_level AS "policyLevel", kd.content_kind AS "contentKind", kd.publication_date AS "publicationDate",
            kd.effective_from AS "effectiveFrom", kd.effective_to AS "effectiveTo",
            kd.verified_at AS "verifiedAt", kd.version_note AS "versionNote", kd.source_url AS source,
            kd.source_document_url AS "sourceDocument",
            kc.content AS body, 1 - (kc.embedding <=> $6::vector) +
            CASE WHEN $5::text IS NOT NULL AND kc.section_type = $5 THEN 0.08 ELSE 0 END +
            CASE WHEN kd.priority = 'high' THEN 0.05 ELSE 0 END +
            CASE WHEN $4::text IS NOT NULL AND kd.region ILIKE '%' || $4 || '%' THEN 0.03 ELSE 0 END AS "rawScore"
          ${commonSql}
            AND kc.embedding IS NOT NULL
          ORDER BY "rawScore" DESC
          LIMIT $2`, [...params, vectorLiteral(embedding)])
        vectorRows = vectorResult.rows
      }

      const fused = fuseRankedChunks(keywordResult.rows, vectorRows)
      const minimumKeywordScore = Number(process.env.RETRIEVAL_MIN_KEYWORD_SCORE || 0.05)
      const minimumVectorScore = Number(process.env.RETRIEVAL_MIN_VECTOR_SCORE || 0.42)
      return fused
        .filter(row => row.keywordScore >= minimumKeywordScore || row.vectorScore >= minimumVectorScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(({ rawScore, ...row }) => row)
    },
    async health() {
      const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM knowledge_documents WHERE status = $1', ['published'])
      const vectorResult = await pool.query(`
        SELECT COUNT(kc.embedding)::int AS count
        FROM knowledge_chunks kc
        JOIN knowledge_documents kd ON kd.id = kc.document_id
        WHERE kd.status = 'published'`)
      return { connected: true, documents: rows[0].count, vectorEnabled: vectorResult.rows[0].count > 0, vectorizedChunks: vectorResult.rows[0].count }
    }
  }
}
