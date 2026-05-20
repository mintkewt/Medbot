const CONSTANTS = require('../config/constants');
const logger = require('../utils/logger');
const { normalizeQuestion } = require('./normalizer.service');
const { validateDimension } = require('../config/embeddingContract');
const vectorStore = require('./vectorStore.service');

class RagService {
    async createEmbedding(text) {
        const { embedQuery } = require('../utils/embeddingProvider');
        const vec = await embedQuery(text);
        validateDimension(vec, 'query embedding');
        return vec;
    }

    async retrieve(question) {
        const { normalized, expansions } = await normalizeQuestion(question);
        const searchText = Object.keys(expansions).length > 0 ? normalized : question;

        const documents = await this.searchKnowledgeBase(searchText, CONSTANTS.RAG.MIN_RELEVANCE_SCORE);
        const ranked = this.rerankForQA(documents);
        const confidenceMeta = this.computeConfidence(ranked);

        return {
            documents: ranked,
            normalizedQuestion: normalized,
            expansions,
            confidence: confidenceMeta.value,
            confidenceMeta,
        };
    }

    /**
     * Weighted top-k confidence (favor strongest first hits).
     * This usually increases useful RAG usage versus flat average.
     */
    computeConfidence(rankedDocuments) {
        if (!rankedDocuments || rankedDocuments.length === 0) {
            return {
                value: 0,
                method: 'weighted_top_k',
                topScores: [],
                weights: [],
            };
        }

        const topScores = rankedDocuments
            .slice(0, 3)
            .map((doc) => Number(doc.similarity || 0));
        const weights = [0.6, 0.3, 0.1].slice(0, topScores.length);
        const weightedSum = topScores.reduce((sum, score, idx) => sum + score * weights[idx], 0);
        const totalWeight = weights.reduce((sum, w) => sum + w, 0) || 1;
        const value = weightedSum / totalWeight;

        return {
            value,
            method: 'weighted_top_k',
            topScores,
            weights,
        };
    }

    async searchKnowledgeBase(question, threshold = CONSTANTS.RAG.MIN_RELEVANCE_SCORE) {
        try {
            const embedding = await this.createEmbedding(question);

            return await vectorStore.search(embedding, {
                threshold,
                limit: CONSTANTS.RAG.MATCH_COUNT * 2,
            });
        } catch (err) {
            const msg = err.message || String(err);
            const code = err.code || err.cause?.code;
            const fromNomicLocal =
                msg.includes('@xenova/transformers') ||
                msg.includes('onnx') ||
                msg.includes('sharp') ||
                (msg.includes('expected') && msg.includes('-d vector'));
            const fromOpenRouter =
                msg.includes('OpenRouter') ||
                msg.includes('openrouter') ||
                msg.includes('OPENROUTER_API_KEY') ||
                msg.includes('401') ||
                msg.includes('402') ||
                msg.includes('Payment Required');
            const fromNetwork =
                msg.includes('fetch failed') ||
                msg.includes('ENOTFOUND') ||
                msg.includes('ECONNREFUSED') ||
                msg.includes('getaddrinfo');
            let hint =
                'RAG error (embedding provider or Zilliz vector search). Check EMBEDDING_PROVIDER, keys, EMBEDDING_DIM vs collection, and ZILLIZ_* .env.';
            if (fromNomicLocal) {
                hint =
                    'Local Nomic/ONNX embed error (model not loaded, RAM). RAG vector empty — chat runs without KB context.';
            } else if (fromOpenRouter) {
                hint =
                    'OpenRouter embed error (OPENROUTER_API_KEY, model id, quota, or EMBEDDING_DIM mismatch). RAG vector empty — chat runs without KB context.';
            } else if (fromNetwork) {
                hint =
                    'Network or Zilliz Cloud unreachable (ZILLIZ_ENDPOINT / ZILLIZ_TOKEN). Check .env and connectivity.';
            }
            logger.warn('rag.search.skip', { message: msg, code, hint });
            return [];
        }
    }

    /**
     * Lightweight rerank: boost answer-centric UMLS chunks, deduplicate
     * near-identical content, cap at MATCH_COUNT.
     */
    rerankForQA(documents) {
        if (!documents || documents.length === 0) return [];

        const seen = new Set();
        const unique = [];
        for (const doc of documents) {
            const fingerprint = doc.content.slice(0, 120).toLowerCase().replace(/\s+/g, ' ');
            if (seen.has(fingerprint)) continue;
            seen.add(fingerprint);

            let boost = 0;
            if (doc.source_type === 'umls') boost += 0.02;
            const meta = doc.metadata || {};
            if (meta.question && meta.answer) boost += 0.03;
            if (meta.cui) boost += 0.01;

            unique.push({ ...doc, similarity: (doc.similarity || 0) + boost });
        }

        unique.sort((a, b) => b.similarity - a.similarity);
        return unique.slice(0, CONSTANTS.RAG.MATCH_COUNT);
    }

    formatContext(documents) {
        if (!documents || documents.length === 0) return "";

        return documents.map(doc => {
            const meta = doc.metadata || {};
            const tag = doc.source_type === 'umls' ? '[UMLS] ' : '';
            const cuiTag = meta.cui ? `(${meta.cui}) ` : '';
            return `- ${tag}${cuiTag}${doc.content}`;
        }).join("\n");
    }
}

module.exports = new RagService();
