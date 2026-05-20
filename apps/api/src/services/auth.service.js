const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabaseAuth = require('../config/supabaseAuth');
const { getJwtSecret } = require('../middleware/requireAuth');

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function signToken(user) {
    const secret = getJwtSecret();
    const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
    return jwt.sign(
        { sub: user.id, email: user.email },
        secret,
        { expiresIn }
    );
}

async function findUserByEmail(email) {
    const normalized = normalizeEmail(email);
    if (!normalized) return null;

    const { data, error } = await supabaseAuth
        .from('app_users')
        .select('id, email, password_hash')
        .eq('email', normalized)
        .maybeSingle();

    if (error) {
        const err = new Error(error.message || 'Database error');
        err.code = error.code;
        throw err;
    }
    return data;
}

async function login(email, password) {
    const user = await findUserByEmail(email);
    if (!user || !user.password_hash) {
        return null;
    }
    const ok = await bcrypt.compare(String(password || ''), user.password_hash);
    if (!ok) return null;
    const token = signToken({ id: user.id, email: user.email });
    return {
        token,
        user: { id: user.id, email: user.email },
    };
}

function verifyTokenPayload(token) {
    const secret = getJwtSecret();
    return jwt.verify(token, secret);
}

module.exports = {
    normalizeEmail,
    signToken,
    findUserByEmail,
    login,
    verifyTokenPayload,
};
