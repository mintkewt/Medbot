const jwt = require('jsonwebtoken');

function getJwtSecret() {
    const secret = process.env.JWT_SECRET;
    if (!secret || String(secret).trim() === '') {
        throw new Error('JWT_SECRET is not set');
    }
    return secret;
}

/**
 * Requires `Authorization: Bearer <token>`. Sets `req.user = { id, email }`.
 */
function requireAuth(req, res, next) {
    let secret;
    try {
        secret = getJwtSecret();
    } catch (e) {
        return res.status(500).json({ error: 'Server auth is not configured' });
    }

    const raw = req.headers.authorization || '';
    const m = /^Bearer\s+(\S+)$/i.exec(raw);
    if (!m) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const payload = jwt.verify(m[1], secret);
        const id = payload.sub;
        if (!id || typeof id !== 'string') {
            return res.status(401).json({ error: 'Invalid token' });
        }
        req.user = {
            id,
            email: typeof payload.email === 'string' ? payload.email : '',
        };
        return next();
    } catch {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

module.exports = requireAuth;
module.exports.getJwtSecret = getJwtSecret;
