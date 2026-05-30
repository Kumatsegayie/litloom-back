'use strict';

module.exports = () => {
  const isProd = String(process.env.NODE_ENV || '').trim() === 'production';
  const forceHttps = String(process.env.FORCE_HTTPS || 'true').trim().toLowerCase() !== 'false';

  return async (ctx, next) => {
    if (!isProd || !forceHttps) {
      await next();
      return;
    }

    const forwardedProto = String(ctx.request.headers['x-forwarded-proto'] || '')
      .split(',')[0]
      .trim()
      .toLowerCase();

    const isSecure = Boolean(ctx.secure) || forwardedProto === 'https';
    if (isSecure) {
      await next();
      return;
    }

    const host = String(ctx.request.headers.host || '').trim();
    if (host && (ctx.method === 'GET' || ctx.method === 'HEAD')) {
      ctx.status = 301;
      ctx.redirect(`https://${host}${ctx.url || ''}`);
      return;
    }

    ctx.status = 400;
    ctx.body = {
      error: {
        message: 'HTTPS is required for this endpoint.',
        code: 'HTTPS_REQUIRED'
      }
    };
  };
};

