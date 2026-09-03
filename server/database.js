import pg from 'pg'

const { Pool } = pg

function vectorLiteral(values) {
  return `[${values.map(value => Number(value).toFixed(8)).join(',')}]`
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
    async search(query, limit = 3) {
      let embedding = null
      try {
        embedding = await createEmbedding(query)
      } catch (error) {
        console.warn('Embedding request failed, using text search:', error.message)
      }
      const params = [query, limit]
      const vectorScore = embedding ? 'CASE WHEN kc.embedding IS NULL THEN 0 ELSE 1 - (kc.embedding <=> $3::vector) END' : '0'
      if (embedding) params.push(vectorLiteral(embedding))
      const { rows } = await pool.query(`
        WITH candidates AS (
        SELECT
          kd.external_id AS "documentId", kd.title, kd.department, kd.region,
          kd.verified_at AS "verifiedAt", kd.version_note AS "versionNote",
          kd.source_url AS source, kc.content AS body,
          (similarity(kc.search_text, $1) * 0.35 + ${vectorScore} * 0.65 +
            CASE WHEN kc.search_text ILIKE '%' || $1 || '%' THEN 0.25 ELSE 0 END) AS score,
          kd.id AS internal_document_id
        FROM knowledge_chunks kc
        JOIN knowledge_documents kd ON kd.id = kc.document_id
        WHERE kd.status = 'published'
        ), ranked AS (
          SELECT *, ROW_NUMBER() OVER (PARTITION BY internal_document_id ORDER BY score DESC) AS row_number
          FROM candidates
        )
        SELECT "documentId", title, department, region, "verifiedAt", "versionNote", source, body, score
        FROM ranked
        WHERE row_number = 1
        ORDER BY score DESC
        LIMIT $2
      `, params)
      return rows
    },
    async health() {
      const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM knowledge_documents WHERE status = $1', ['published'])
      const vectorResult = await pool.query('SELECT COUNT(embedding)::int AS count FROM knowledge_chunks')
      return { connected: true, documents: rows[0].count, vectorEnabled: vectorResult.rows[0].count > 0, vectorizedChunks: vectorResult.rows[0].count }
    }
  }
}
