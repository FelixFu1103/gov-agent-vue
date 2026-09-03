function documentText(document) {
  return [document.title, document.body].filter(Boolean).join('\n')
}

export function createKnowledgeReranker({ env = process.env, fetchImpl = fetch } = {}) {
  const url = env.RERANK_API_URL?.trim()
  const model = env.RERANK_MODEL?.trim()
  const apiKey = env.RERANK_API_KEY?.trim()
  const enabled = Boolean(url && model)

  return {
    enabled,
    model: enabled ? model : null,
    async rerank(query, documents, { topN = 3 } = {}) {
      if (!enabled || documents.length < 2) return documents.slice(0, topN)
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          query,
          documents: documents.map(documentText),
          top_n: Math.min(topN, documents.length),
          return_documents: false
        }),
        signal: AbortSignal.timeout(Number(env.RERANK_TIMEOUT_MS || 15_000))
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(`Rerank API error: ${response.status}`)
      const results = payload.results || payload.data
      if (!Array.isArray(results)) throw new Error('Rerank API returned invalid results')
      const seen = new Set()
      return results
        .map(result => ({ index: Number(result.index), score: Number(result.relevance_score ?? result.score) }))
        .filter(result => Number.isInteger(result.index) && result.index >= 0 && result.index < documents.length && Number.isFinite(result.score) && !seen.has(result.index) && seen.add(result.index))
        .slice(0, topN)
        .map(result => ({ ...documents[result.index], rerankScore: result.score }))
    }
  }
}
