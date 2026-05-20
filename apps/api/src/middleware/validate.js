/**
 * Lightweight request body validation (no external deps).
 * Returns a middleware that checks required fields + types.
 */
const logger = require('../utils/logger');

function validate(schema) {
  return (req, res, next) => {
    const errors = [];

    for (const [field, rules] of Object.entries(schema)) {
      const value = req.body[field];

      if (rules.required && (value === undefined || value === null || value === '')) {
        errors.push(`"${field}" is required`);
        continue;
      }

      if (value !== undefined && rules.type && typeof value !== rules.type) {
        errors.push(`"${field}" must be a ${rules.type}`);
      }

      if (value && rules.minLength && value.length < rules.minLength) {
        errors.push(`"${field}" must be at least ${rules.minLength} characters`);
      }

      if (value && rules.maxLength && value.length > rules.maxLength) {
        errors.push(`"${field}" must be at most ${rules.maxLength} characters`);
      }
    }

    if (errors.length > 0) {
      logger.warn('validate.failed', {
        requestId: req.requestId,
        path: req.originalUrl || req.url,
        errors,
      });
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }

    next();
  };
}

module.exports = validate;
