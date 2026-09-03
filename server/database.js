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
    async search(query, options = {}) {
      const { limit = 3, intent = null, region = null } = typeof options === 'number' ? { limit: options } : options
      const candidateLimit = 20
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
          AND ($3::text IS NULL OR kd.service_code = $3)
          AND ($4::text IS NULL OR kd.region = '江苏省' OR kd.region ILIKE '%' || $4 || '%')`
      const params = [query, candidateLimit, intent, region]
      const keywordResult = await pool.query(`
        SELECT kd.external_id AS "documentId", kd.title, kd.department, kd.region,
          kd.verified_at AS "verifiedAt", kd.version_note AS "versionNote", kd.source_url AS source,
          kc.content AS body, similarity(kc.search_text, $1) +
          CASE WHEN kc.search_text ILIKE '%' || $1 || '%' THEN 0.5 ELSE 0 END AS "rawScore"
        ${commonSql}
        ORDER BY "rawScore" DESC
        LIMIT $2`, params)

      let vectorRows = []
      if (embedding) {
        const vectorResult = await pool.query(`
          SELECT kd.external_id AS "documentId", kd.title, kd.department, kd.region,
            kd.verified_at AS "verifiedAt", kd.version_note AS "versionNote", kd.source_url AS source,
            kc.content AS body, 1 - (kc.embedding <=> $5::vector) AS "rawScore"
          ${commonSql}
            AND kc.embedding IS NOT NULL
          ORDER BY kc.embedding <=> $5::vector
          LIMIT $2`, [...params, vectorLiteral(embedding)])
        vectorRows = vectorResult.rows
      }

      const fused = new Map()
      const addRanked = (rows, channel) => {
        const uniqueRows = [...new Map(rows.map(row => [row.documentId, row])).values()]
        uniqueRows.forEach((row, index) => {
        const current = fused.get(row.documentId) || { ...row, score: 0, channels: [], keywordScore: 0, vectorScore: 0 }
        current.score += 1 / (60 + index + 1)
        current.channels.push(channel)
        current[`${channel}Score`] = Math.max(current[`${channel}Score`], Number(row.rawScore))
        if (!current.body || Number(row.rawScore) > Number(current.rawScore || 0)) Object.assign(current, row)
        fused.set(row.documentId, current)
        })
      }
      addRanked(keywordResult.rows, 'keyword')
      addRanked(vectorRows, 'vector')
      const minimumKeywordScore = Number(process.env.RETRIEVAL_MIN_KEYWORD_SCORE || 0.05)
      const minimumVectorScore = Number(process.env.RETRIEVAL_MIN_VECTOR_SCORE || 0.42)
      return [...fused.values()]
        .filter(row => row.keywordScore >= minimumKeywordScore || row.vectorScore >= minimumVectorScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(({ rawScore, keywordScore, vectorScore, ...row }) => row)
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
