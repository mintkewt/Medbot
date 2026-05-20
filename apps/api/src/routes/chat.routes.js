const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chat.controller');
const validate = require('../middleware/validate');
const rateLimiter = require('../middleware/rateLimiter');
const requireAuth = require('../middleware/requireAuth');

const messageSchema = {
    sessionId: { required: false, type: 'string' },
    question: { required: true, type: 'string', minLength: 1, maxLength: 2000 },
};

const streamSchema = {
    sessionId: { required: false, type: 'string' },
    question: { required: true, type: 'string', minLength: 1, maxLength: 2000 },
};

const sessionMetadataSchema = {
    title: { required: false, type: 'string', minLength: 1, maxLength: 120 },
    isPinned: { required: false, type: 'boolean' },
};

router.get('/health', chatController.healthCheck);

router.use(requireAuth);

router.post(
    '/message',
    rateLimiter(),
    validate(messageSchema),
    chatController.sendMessage
);

router.post(
    '/stream',
    rateLimiter({ keyPrefix: 'stream' }),
    validate(streamSchema),
    chatController.streamMessage
);

router.get(
    '/sessions',
    chatController.listSessions
);

router.get(
    '/session/:sessionId/history',
    rateLimiter({ keyPrefix: 'history' }),
    chatController.getSessionHistory
);

router.get(
    '/search',
    rateLimiter({ keyPrefix: 'search' }),
    chatController.searchHistory
);

router.patch(
    '/session/:sessionId',
    rateLimiter({ keyPrefix: 'session-meta' }),
    validate(sessionMetadataSchema),
    chatController.updateSessionMetadata
);

router.delete(
    '/session/:sessionId',
    rateLimiter({ keyPrefix: 'session-delete' }),
    chatController.deleteSession
);

router.post(
    '/session/:sessionId/cleanup',
    rateLimiter({ keyPrefix: 'session-cleanup' }),
    chatController.cleanupTemporarySession
);

module.exports = router;
