const supabase = require('../config/supabase');
const logger = require('../utils/logger');
const ragService = require('./rag.service');
const GeminiProvider = require('../providers/gemini.provider');
const OneMinProvider = require('../providers/onemin.provider');
const CONSTANTS = require('../config/constants');
const PROMPTS = require('../config/prompts');

let providers = null;

function getProviders() {
    if (providers) return providers;
    providers = {
        gemini: new GeminiProvider(),
        onemin: new OneMinProvider()
    };
    return providers;
}

class ChatService {
    async processMessage(sessionId, question, onChunk = null, userId) {
        const startTime = Date.now();
        const normalizedInputQuestion = this.#normalizeQuestion(question);
        const logData = {
            session_id: sessionId,
            user_question: normalizedInputQuestion,
            provider: null,
            latency_ms: 0,
            handled_by_layer: 0,
            bot_response: ""
        };

        try {
            await this.#ensureChatSession(sessionId, userId);
            const answer = await this.#resolveAnswer(normalizedInputQuestion, sessionId, logData, onChunk);
            logData.bot_response = answer;
            await this.#saveLog(logData, startTime);

            // Generate title after streaming so the provider does not block the stream.
            this.#ensureConversationTitle(sessionId, normalizedInputQuestion).catch((err) => {
                logger.warn('chat.session.title.background_fail', {
                    message: err?.message,
                    code: err?.code,
                    sessionId,
                });
            });

            return answer;
        } catch (error) {
            logger.error('chat.processMessage.fail', { message: error.message, stack: error.stack });
            return PROMPTS.ERROR_SYSTEM;
        }
    }

    /**
     * Generate a short, user-friendly conversation title using AI
     * @param {string} firstQuestion - The first user question
     * @returns {Promise<string>} A concise title (≤40 chars)
     */
    async #generateConversationTitle(firstQuestion) {
        if (!firstQuestion) return CONSTANTS.CHAT.DEFAULT_SESSION_TITLE;
        // Avoid an extra provider call for very long pasted records.
        if (firstQuestion.length > 320) {
            return firstQuestion.slice(0, 37) + '...';
        }
        try {
            const prompt = `Create a short title (max 40 characters) for a chat that starts with this question: "${firstQuestion}".
Return only the title, no explanation. Examples: "Heart health Q&A", "Pain medication question"`;

            const title = await getProviders().onemin.generateResponse(prompt, '', [], { raw: true });
            
            // Clean and truncate
            const cleaned = title.trim().replace(/^["']|["']$/g, '');
            return cleaned.length > 40 ? cleaned.substring(0, 37) + '...' : cleaned;
        } catch (err) {
            logger.warn('chat.title.generation.fail', { message: err.message });
            // Fallback: use first 40 chars of the question
            const fallback = firstQuestion.length > 40 
                ? firstQuestion.substring(0, 37) + '...' 
                : firstQuestion;
            return fallback;
        }
    }

    #normalizeQuestion(question) {
        const text = String(question || '').trim();
        const maxChars = CONSTANTS.CHAT.MAX_QUESTION_CHARS || 1800;
        if (text.length <= maxChars) return text;
        return `${text.slice(0, maxChars)}\n\n[Content truncated to improve response speed]`;
    }

    #withTimeout(promise, ms, label) {
        let timeoutId;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
        });
        return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
    }

    #trimHistory(history) {
        const maxPerMessage = CONSTANTS.CHAT.MAX_HISTORY_CHARS_PER_MESSAGE || 600;
        return history.map((item) => ({
            ...item,
            content: String(item.content || '').slice(0, maxPerMessage),
        }));
    }

    // ── Layer 1: Rules ─────────────────────────────────────────────

    #checkGreeting(question) {
        return /^(hi|hello|hey)$/i.test(question);
    }

    async #retrieveContext(question) {
        return ragService.retrieve(question);
    }

    #isGeminiQuotaError(err) {
        const message = String(err?.message || '').toLowerCase();
        const status = err?.status || err?.response?.status;
        return (
            status === 429 ||
            message.includes('quota') ||
            message.includes('resource_exhausted') ||
            message.includes('rate limit')
        );
    }

    async #generateWithProvider(providerName, question, context, history, onChunk) {
        const timeoutMs = CONSTANTS.CHAT.PROVIDER_TIMEOUT_MS || 18000;
        const safeHistory = this.#trimHistory(history || []);
        const providers = getProviders();
        if (onChunk) {
            return this.#withTimeout(
                providers[providerName].generateResponseStream(question, context, safeHistory, onChunk),
                timeoutMs,
                providerName
            );
        }
        return this.#withTimeout(
            providers[providerName].generateResponse(question, context, safeHistory),
            timeoutMs,
            providerName
        );
    }

    async #generateAnswerByConfidence({
        confidence,
        confidenceMeta,
        threshold,
        question,
        history,
        contextForHighConfidence,
        onChunk,
    }) {
        if (confidence < threshold) {
            try {
                logger.info('chat.provider.route', {
                    provider: 'onemin',
                    confidence,
                    confidenceMethod: confidenceMeta?.method,
                    confidenceTopScores: confidenceMeta?.topScores,
                    threshold,
                    useRagContext: false,
                });
                const responseText = await this.#generateWithProvider(
                    'onemin',
                    question,
                    '',
                    history,
                    onChunk
                );
                return { providerName: 'onemin', responseText };
            } catch (err) {
                logger.warn('chat.provider.onemin.fallback_gemini', {
                    message: err.message,
                });
                const responseText = await this.#generateWithProvider(
                    'gemini',
                    question,
                    '',
                    history,
                    onChunk
                );
                return { providerName: 'gemini', responseText };
            }
        }

        try {
            logger.info('chat.provider.route', {
                provider: 'onemin',
                confidence,
                confidenceMethod: confidenceMeta?.method,
                confidenceTopScores: confidenceMeta?.topScores,
                threshold,
                useRagContext: true,
            });
            const responseText = await this.#generateWithProvider(
                'onemin',
                question,
                contextForHighConfidence,
                history,
                onChunk
            );
            return { providerName: 'onemin', responseText };
        } catch (err) {
            logger.error('chat.provider.onemin.error_no_fallback', { message: err.message });
            // No Gemini fallback: surface the provider error to the client.
            if (onChunk) {
                onChunk(`\n\n[Error from 1min.ai provider]: ${err.message}`);
            }
            return { providerName: 'onemin', responseText: `[System error]: ${err.message}` };
        }
    }

    async #resolveAnswer(question, sessionId, logData, onChunk) {
        if (this.#checkGreeting(question)) {
            logData.handled_by_layer = 1;
            logData.provider = 'rule_base';
            const greeting = PROMPTS.GREETING_RESPONSE;
            if (onChunk) onChunk(greeting);
            return greeting;
        }

        const [{ documents, normalizedQuestion, confidence, confidenceMeta }, history] = await Promise.all([
            this.#retrieveContext(question),
            this.#getHistory(sessionId),
        ]);
        const threshold = CONSTANTS.RAG.HIGH_RELEVANCE_SCORE;
        const contextForHighConfidence = ragService.formatContext(documents);
        const { providerName, responseText } = await this.#generateAnswerByConfidence({
            confidence,
            confidenceMeta,
            threshold,
            question: normalizedQuestion,
            history,
            contextForHighConfidence,
            onChunk,
        });

        logData.handled_by_layer = documents.length > 0 ? 3 : 2;
        logData.provider = providerName;
        return responseText;
    }

    async #getHistory(sessionId) {
        if (!sessionId) return [];

        try {
            const { data, error } = await supabase
                .from('chat_logs')
                .select('user_question, bot_response')
                .eq('session_id', sessionId)
                .order('created_at', { ascending: false })
                .limit(CONSTANTS.CHAT.HISTORY_LIMIT);

            if (error) throw error;

            return data.reverse().flatMap(log => [
                { role: 'user', content: log.user_question },
                { role: 'model', content: log.bot_response }
            ]);
        } catch (err) {
            logger.warn('chat.history.skip', { message: err.message });
            return [];
        }
    }

    async #ensureChatSession(sessionId, userId) {
        if (!sessionId) return;
        const ownerId = userId || 'anonymous';
        try {
            // Check if session already exists
            const { data: existing, error: fetchError } = await supabase
                .from('chat_sessions')
                .select('id')
                .eq('id', sessionId)
                .single();

            if (fetchError && fetchError.code !== 'PGRST116') {
                throw fetchError;
            }

            // If session exists, no need to update
            if (existing) return;

            const { error } = await supabase.from('chat_sessions').upsert(
                { 
                    id: sessionId, 
                    user_id: ownerId, 
                    title: CONSTANTS.CHAT.DEFAULT_SESSION_TITLE,
                    metadata: {} 
                },
                { onConflict: 'id', ignoreDuplicates: false }
            );
            if (error) throw error;

            logger.info('chat.session.created', { sessionId });
        } catch (err) {
            logger.warn('chat.session.ensure.skip', {
                message: err.message,
                code: err.code,
                sessionId,
            });
        }
    }

    async #ensureConversationTitle(sessionId, firstQuestion) {
        if (!sessionId || !firstQuestion) return;
        try {
            const { data: session, error: fetchError } = await supabase
                .from('chat_sessions')
                .select('id, title')
                .eq('id', sessionId)
                .single();

            if (fetchError) throw fetchError;
            if (!session) return;

            const currentTitle = String(session.title || '').trim();
            if (currentTitle && currentTitle !== CONSTANTS.CHAT.DEFAULT_SESSION_TITLE) {
                return;
            }

            const generatedTitle = await this.#generateConversationTitle(firstQuestion);
            const { error: updateError } = await supabase
                .from('chat_sessions')
                .update({ title: generatedTitle })
                .eq('id', sessionId);

            if (updateError) throw updateError;

            logger.info('chat.session.title.updated', { sessionId, title: generatedTitle });
        } catch (err) {
            logger.warn('chat.session.title.skip', {
                message: err.message,
                code: err.code,
                sessionId,
            });
        }
    }

    async #saveLog(logData, startTime) {
        logData.latency_ms = Date.now() - startTime;
        try {
            const { error } = await supabase.from('chat_logs').insert(logData);
            if (error) throw error;
        } catch (err) {
            logger.warn('chat.log.insert.skip', {
                message: err.message,
                code: err.code || err.cause?.code,
            });
        }
    }
}

module.exports = new ChatService();
