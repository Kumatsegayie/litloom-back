'use strict';

function cleanBaseUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) return '';
  return value.replace(/\/$/, '');
}

function resolveSiteBase() {
  return (
    cleanBaseUrl(process.env.PUBLIC_SITE_URL) ||
    cleanBaseUrl(process.env.FRONTEND_PUBLIC_URL) ||
    cleanBaseUrl(process.env.FRONTEND_URL) ||
    cleanBaseUrl(process.env.STRAPI_PUBLIC_URL) ||
    'http://localhost:3000'
  );
}

module.exports = () => {
  return async (ctx, next) => {
    const path = String(ctx.path || '');

    if (path === '/sitemap.xml') {
      ctx.status = 301;
      ctx.redirect('/api/seo/sitemap.xml');
      return;
    }

    if (path === '/robots.txt') {
      const siteBase = resolveSiteBase();
      ctx.type = 'text/plain; charset=utf-8';
      ctx.body = `User-agent: *\nAllow: /\nSitemap: ${siteBase}/sitemap.xml\n`;
      return;
    }

    await next();
  };
};

