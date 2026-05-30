'use strict';

const { consumeRateLimit, getRouteLimitKey } = require('../utils/requestProtection');

function toInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  return parsed;
}

module.exports = () => {
  const rules = [
    {
      id: 'comment-submit',
      method: 'POST',
      path: /^\/api\/comments\/submit$/i,
      limit: toInt(process.env.RATE_LIMIT_COMMENT_SUBMIT, 8),
      windowMs: toInt(process.env.RATE_LIMIT_COMMENT_WINDOW_MS, 10 * 60 * 1000)
    },
    {
      id: 'contact-submit',
      method: 'POST',
      path: /^\/api\/contact-messages\/submit$/i,
      limit: toInt(process.env.RATE_LIMIT_CONTACT_SUBMIT, 5),
      windowMs: toInt(process.env.RATE_LIMIT_CONTACT_WINDOW_MS, 10 * 60 * 1000)
    },
    {
      id: 'submission-submit',
      method: 'POST',
      path: /^\/api\/submissions\/submit$/i,
      limit: toInt(process.env.RATE_LIMIT_SUBMISSION_SUBMIT, 4),
      windowMs: toInt(process.env.RATE_LIMIT_SUBMISSION_WINDOW_MS, 60 * 60 * 1000)
    },
    {
      id: 'subscribe-submit',
      method: 'POST',
      path: /^\/api\/emails\/subscribe$/i,
      limit: toInt(process.env.RATE_LIMIT_SUBSCRIBE_SUBMIT, 8),
      windowMs: toInt(process.env.RATE_LIMIT_SUBSCRIBE_WINDOW_MS, 60 * 60 * 1000)
    },
    {
      id: 'auth-local',
      method: 'POST',
      path: /^\/api\/auth\/local$/i,
      limit: toInt(process.env.RATE_LIMIT_AUTH_LOCAL, 10),
      windowMs: toInt(process.env.RATE_LIMIT_AUTH_LOCAL_WINDOW_MS, 15 * 60 * 1000)
    },
    {
      id: 'admin-login',
      method: 'POST',
      path: /^\/admin\/login$/i,
      limit: toInt(process.env.RATE_LIMIT_ADMIN_LOGIN, 10),
      windowMs: toInt(process.env.RATE_LIMIT_ADMIN_LOGIN_WINDOW_MS, 15 * 60 * 1000)
    }
  ];

  return async (ctx, next) => {
    const method = String(ctx.method || 'GET').toUpperCase();
    const path = String(ctx.path || '');

    // Basic request-line hardening.
    if (path.length > 2048) {
      ctx.status = 414;
      ctx.body = { error: { message: 'Request URI too long' } };
      return;
    }

    const matched = rules.find((rule) => rule.method === method && rule.path.test(path));
    if (matched) {
      const key = getRouteLimitKey(ctx, matched.id);
      const result = consumeRateLimit({
        key,
        limit: matched.limit,
        windowMs: matched.windowMs
      });

      if (!result.allowed) {
        const retrySeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
        ctx.set('Retry-After', String(retrySeconds));
        ctx.status = 429;
        ctx.body = {
          error: {
            message: 'Too many requests. Please try again later.',
            code: 'RATE_LIMITED',
            retryAfterSeconds: retrySeconds
          }
        };
        return;
      }
    }

    await next();
  };
};
