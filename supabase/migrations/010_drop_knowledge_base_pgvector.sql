-- =============================================================================
-- 010_drop_knowledge_base_pgvector.sql
-- One-shot cleanup for databases that still have the old Postgres/pgvector RAG.
-- Vector storage lives in Zilliz Cloud. Drop knowledge_base table,
-- associated RPCs, indexes, and the pgvector extension (if no other tables
-- depend on it).
-- Run AFTER all data has been re-ingested into Zilliz.
-- =============================================================================

DROP FUNCTION IF EXISTS match_documents_hybrid(vector(768), TEXT, FLOAT, INT);
DROP FUNCTION IF EXISTS match_documents_hybrid(vector(768), TEXT, FLOAT, INT, TEXT);
DROP FUNCTION IF EXISTS lookup_umls_metadata_str(TEXT);

DROP TABLE IF EXISTS knowledge_base CASCADE;

DROP EXTENSION IF EXISTS vector;
