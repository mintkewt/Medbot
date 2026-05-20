const authService = require('../services/auth.service');
const logger = require('../utils/logger');

exports.login = async (req, res, next) => {
    try {
        const { email, password } = req.body;
        const result = await authService.login(email, password);
        if (!result) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        return res.json(result);
    } catch (err) {
        logger.error('auth.login.fail', {
            requestId: req.requestId,
            message: err.message,
            code: err.code,
        });
        return next(err);
    }
};

exports.me = async (req, res) => {
    return res.json({ user: { id: req.user.id, email: req.user.email } });
};
