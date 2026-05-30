'use strict';

module.exports = (config, { strapi }) => {
  const apiMaxAge = Number.parseInt(String(process.env.API_CACHE_MAX_AGE || ''), 10) || 60;
  const apiStaleAge =
    Number.parseInt(String(process.env.API_CACHE_STALE_WHILE_REVALIDATE || ''), 10) || 300;

  return async (ctx, next) => {
    await next();

    if (ctx.method !== 'GET' || ctx.status !== 200) return;

    const path = String(ctx.path || '');
    const authHeader = String(ctx.request.headers.authorization || '');
    const isAuthedRequest = authHeader.trim().length > 0;

    if (path.startsWith('/uploads/')) {
      ctx.set('Cache-Control', 'public, max-age=31536000, immutable');
      return;
    }

    if (path.startsWith('/api/')) {
      if (isAuthedRequest) {
        ctx.set('Cache-Control', 'private, no-store');
        return;
      }
      ctx.set(
        'Cache-Control',
        `public, max-age=${apiMaxAge}, stale-while-revalidate=${apiStaleAge}`
      );
      return;
    }

    if (path.startsWith('/admin')) {
      ctx.set('Cache-Control', 'private, no-store');
    }
  };
};

