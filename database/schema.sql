CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id BIGSERIAL PRIMARY KEY,
  external_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  department TEXT,
  region TEXT,
  topic TEXT,
  keywords TEXT,
  source_url TEXT NOT NULL,
  source_notice_url TEXT,
  verified_at DATE,
  version_note TEXT,
  priority TEXT,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id BIGSERIAL PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  search_text TEXT NOT NULL,
  embedding vector(1024),
  token_estimate INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(document_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS knowledge_documents_status_idx ON knowledge_documents(status);
CREATE INDEX IF NOT EXISTS knowledge_documents_topic_idx ON knowledge_documents(topic);
CREATE INDEX IF NOT EXISTS knowledge_chunks_search_trgm_idx ON knowledge_chunks USING gin(search_text gin_trgm_ops);
CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_idx ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);
