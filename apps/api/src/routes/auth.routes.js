const express = require('express');
const router = express.Router();
const validate = require('../middleware/validate');
const requireAuth = require('../middleware/requireAuth');
const authController = require('../controllers/auth.controller');

const loginSchema = {
    email: { required: true, type: 'string', minLength: 3, maxLength: 320 },
    password: { required: true, type: 'string', minLength: 1, maxLength: 256 },
};

router.post('/login', validate(loginSchema), authController.login);
router.get('/me', requireAuth, authController.me);

module.exports = router;
