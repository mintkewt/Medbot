const chatService = require('../services/chat.service');
const supabase = require('../config/supabase');
const logger = require('../utils/logger');
const CONSTANTS = require('../config/constants');

async function ensureSession(sessionId, req, userId) {
    if (sessionId) return sessionId;

    const { data, error } = await supabase
        .from('chat_sessions')
        .insert({
            user_id: userId,
            title: CONSTANTS.CHAT.DEFAULT_SESSION_TITLE,
            metadata: { ip: req.ip, ua: req.headers['user-agent'] },
        })
        .select()
        .single();

    if (error) {
        const err = new Error('Failed to create session');
        err.status = 500;
        throw err;
    }

    return data.id;
}

function writeSseEvent(res, event, payload) {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    res.flush?.();
}

exports.sendMessage = async (req, res, next) => {
    try {
        const { question } = req.body;
        let { sessionId } = req.body;
        const userId = req.user.id;

        sessionId = await ensureSession(sessionId, req, userId);
        const answer = await chatService.processMessage(sessionId, question, null, userId);

        res.json({ sessionId, answer });
    } catch (err) {
        next(err);
    }
};

exports.streamMessage = async (req, res) => {
    let isClosed = false;
    res.on('close', () => {
        isClosed = true;
    });
    req.on('aborted', () => {
        isClosed = true;
    });

    try {
        const { question } = req.body;
        let { sessionId } = req.body;
        const userId = req.user.id;
        sessionId = await ensureSession(sessionId, req, userId);

        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();

        writeSseEvent(res, 'stream_start', { sessionId, timestamp: new Date().toISOString() });

        // Keep the SSE connection alive with periodic comment lines.
        // Browsers (and proxies) close idle connections after ~30s with no data.
        // 1min.ai can take 8-25s before its first token arrives.
        const keepalive = setInterval(() => {
            if (!isClosed && !res.writableEnded) {
                res.write(': ping\n\n');
            }
        }, 15000);

        let chunkCount = 0;
        const fullAnswer = await chatService.processMessage(sessionId, question, (chunk) => {
            chunkCount++;
            if (isClosed) return;
            writeSseEvent(res, 'stream_chunk', { chunk });
        }, userId);

        clearInterval(keepalive);

        if (!isClosed) {
            writeSseEvent(res, 'stream_end', {
                fullAnswer,
                sessionId,
                timestamp: new Date().toISOString(),
            });
        }

    } catch (error) {
        if (typeof keepalive !== 'undefined') clearInterval(keepalive);
        logger.error('chat.stream.fail', {
            requestId: req.requestId,
            message: error.message,
            stack: error.stack,
        });
        if (!res.headersSent) {
            res.status(500).json({ error: 'Stream failed' });
            return;
        }
        writeSseEvent(res, 'stream_error', { message: 'Error processing request' });
    } finally {
        if (!isClosed && !res.writableEnded) {
            res.end();
        }
    }
};

function safeParseLimit(value, fallback) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
    return fallback;
}

function safeParseOffset(value, fallback = 0) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
    return fallback;
}

function toBool(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string') return false;
    return value.toLowerCase() === 'true';
}

exports.listSessions = async (req, res, next) => {
    try {
        const limit = safeParseLimit(req.query.limit, 10);
        const offset = safeParseOffset(req.query.offset, 0);
        const query = String(req.query.q || '').trim();
        const pinnedOnly = toBool(req.query.pinnedOnly);
        const userId = req.user.id;

        const selectFields = 'id, title, is_pinned, created_at, updated_at';
        let dbQuery = supabase
            .from('chat_sessions')
            .select(selectFields, { count: 'exact' })
            .eq('user_id', userId)
            .order('is_pinned', { ascending: false })
            .order('updated_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (pinnedOnly) {
            dbQuery = dbQuery.eq('is_pinned', true);
        }
        if (query) {
            dbQuery = dbQuery.ilike('title', `%${query}%`);
        }

        const { data: sessions, error, count } = await dbQuery;

        if (error) throw error;
        if (!sessions || sessions.length === 0) {
            res.json({
                sessions: [],
                pagination: { limit, offset, total: count || 0 }
            });
            return;
        }

        const formatted = sessions.map((s) => ({
            sessionId: s.id,
            title: s.title || CONSTANTS.CHAT.DEFAULT_SESSION_TITLE,
            isPinned: Boolean(s.is_pinned),
            updatedAt: s.updated_at || s.created_at,
        }));

        res.json({
            sessions: formatted,
            pagination: { limit, offset, total: count || formatted.length }
        });
    } catch (err) {
        next(err);
    }
};

exports.updateSessionMetadata = async (req, res, next) => {
    try {
        const { sessionId } = req.params;
        const { title, isPinned } = req.body;
        const userId = req.user.id;

        if (!sessionId) {
            res.status(400).json({ error: 'sessionId is required' });
            return;
        }

        const updates = {};
        if (typeof title === 'string') {
            const cleaned = title.trim();
            if (cleaned.length < 1 || cleaned.length > 120) {
                res.status(400).json({ error: 'title must be 1-120 characters' });
                return;
            }
            updates.title = cleaned;
        }
        if (typeof isPinned === 'boolean') {
            updates.is_pinned = isPinned;
        }

        if (Object.keys(updates).length === 0) {
            res.status(400).json({ error: 'At least one of title or isPinned is required' });
            return;
        }

        const { data: exists, error: existsErr } = await supabase
            .from('chat_sessions')
            .select('id')
            .eq('id', sessionId)
            .eq('user_id', userId)
            .single();

        if (existsErr || !exists) {
            res.status(404).json({ error: 'Session not found' });
            return;
        }

        const { data, error } = await supabase
            .from('chat_sessions')
            .update(updates)
            .eq('id', sessionId)
            .eq('user_id', userId)
            .select('id, title, is_pinned, created_at, updated_at')
            .single();

        if (error) throw error;

        res.json({
            sessionId: data.id,
            title: data.title || CONSTANTS.CHAT.DEFAULT_SESSION_TITLE,
            isPinned: Boolean(data.is_pinned),
            updatedAt: data.updated_at || data.created_at,
        });
    } catch (err) {
        next(err);
    }
};

exports.deleteSession = async (req, res, next) => {
    try {
        const { sessionId } = req.params;
        const userId = req.user.id;

        if (!sessionId) {
            res.status(400).json({ error: 'sessionId is required' });
            return;
        }

        const { data: sessionRow, error: sessionErr } = await supabase
            .from('chat_sessions')
            .select('id')
            .eq('id', sessionId)
            .eq('user_id', userId)
            .single();

        if (sessionErr || !sessionRow) {
            res.status(404).json({ error: 'Session not found' });
            return;
        }

        const { error: logsErr } = await supabase
            .from('chat_logs')
            .delete()
            .eq('session_id', sessionId);
        if (logsErr) throw logsErr;

        const { error: sessionDeleteErr } = await supabase
            .from('chat_sessions')
            .delete()
            .eq('id', sessionId)
            .eq('user_id', userId);
        if (sessionDeleteErr) throw sessionDeleteErr;

        res.json({ sessionId, deleted: true });
    } catch (err) {
        next(err);
    }
};

exports.cleanupTemporarySession = async (req, res, next) => {
    try {
        const { sessionId } = req.params;
        const userId = req.user.id;

        if (!sessionId) {
            res.status(400).json({ error: 'sessionId is required' });
            return;
        }

        // Idempotent cleanup: always try both deletes and return success payload.
        await supabase.from('chat_logs').delete().eq('session_id', sessionId);
        await supabase.from('chat_sessions').delete().eq('id', sessionId).eq('user_id', userId);

        res.json({ sessionId, cleaned: true });
    } catch (err) {
        next(err);
    }
};

exports.getSessionHistory = async (req, res, next) => {
    try {
        const { sessionId } = req.params;
        if (!sessionId) {
            res.status(400).json({ error: 'sessionId is required' });
            return;
        }

        const userId = req.user.id;

        const { data: sessionRow, error: sessionErr } = await supabase
            .from('chat_sessions')
            .select('id')
            .eq('id', sessionId)
            .eq('user_id', userId)
            .single();

        if (sessionErr) {
            res.status(404).json({ error: 'Session not found' });
            return;
        }

        const limit = safeParseLimit(req.query.limit, 1000);
        const { data: logs, error } = await supabase
            .from('chat_logs')
            .select('user_question, bot_response, created_at')
            .eq('session_id', sessionId)
            .order('created_at', { ascending: true })
            .limit(limit);

        if (error) throw error;

        const messages = (logs || []).flatMap((log) => [
            {
                role: 'user',
                content: log.user_question,
                timestamp: log.created_at,
            },
            {
                role: 'bot',
                content: log.bot_response,
                timestamp: log.created_at,
            },
        ]);

        res.json({ sessionId, messages });
    } catch (err) {
        next(err);
    }
};

exports.searchHistory = async (req, res, next) => {
    try {
        const q = String(req.query.q || '').trim();
        const limit = safeParseLimit(req.query.limit, 20);
        const offset = safeParseOffset(req.query.offset, 0);
        const userId = req.user.id;

        if (!q || q.length < 2) {
            res.status(400).json({ error: 'q must be at least 2 characters' });
            return;
        }

        const { data: rows, error, count } = await supabase
            .from('chat_logs')
            .select('session_id, user_question, bot_response, created_at', { count: 'exact' })
            .or(`user_question.ilike.%${q}%,bot_response.ilike.%${q}%`)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        if (error) throw error;

        const sessionIds = [...new Set((rows || []).map((row) => row.session_id))];
        let sessionsById = {};

        if (sessionIds.length > 0) {
            const { data: sessions } = await supabase
                .from('chat_sessions')
                .select('id, title, user_id')
                .in('id', sessionIds)
                .eq('user_id', userId);
            sessionsById = Object.fromEntries((sessions || []).map((s) => [s.id, s]));
        }

        const results = (rows || [])
            .filter((row) => sessionsById[row.session_id])
            .map((row) => {
                const session = sessionsById[row.session_id];
                const source = row.user_question?.toLowerCase().includes(q.toLowerCase())
                    ? row.user_question
                    : row.bot_response;
                const snippet = String(source || '').slice(0, 220);
                return {
                    sessionId: row.session_id,
                    title: session?.title || CONSTANTS.CHAT.DEFAULT_SESSION_TITLE,
                    matchedAt: row.created_at,
                    snippet
                };
            });

        res.json({
            results,
            pagination: { limit, offset, total: count || results.length }
        });
    } catch (err) {
        next(err);
    }
};

exports.healthCheck = (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
};
