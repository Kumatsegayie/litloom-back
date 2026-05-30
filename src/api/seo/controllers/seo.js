'use strict';

const SITE_STATIC_PATHS = ['/', '/articles', '/blogs', '/books', '/podcasts', '/poems', '/paintings', '/photos'];

function cleanBaseUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) return '';
  return value.replace(/\/$/, '');
}

function xmlEscape(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toIso(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

async function collectEntries(strapi, uid, buildPath) {
  try {
    const rows = await strapi.db.query(uid).findMany({
      where: { publishedAt: { $notNull: true } },
      orderBy: [{ updatedAt: 'desc' }, { publishedAt: 'desc' }, { id: 'desc' }],
      limit: 2000
    });

    return (rows || [])
      .map((row) => {
        const slug = String(row?.slug || row?.documentId || row?.id || '').trim();
        if (!slug) return null;
        return {
          path: buildPath(slug),
          lastmod: toIso(row?.updatedAt || row?.publishedAt),
          priority: '0.75',
          changefreq: 'weekly'
        };
      })
      .filter(Boolean);
  } catch (error) {
    strapi.log.error(`[seo] Failed collecting entries for ${uid}`, error);
    return [];
  }
}

module.exports = {
  async sitemap(ctx) {
    const baseUrl =
      cleanBaseUrl(process.env.PUBLIC_SITE_URL) ||
      cleanBaseUrl(process.env.FRONTEND_PUBLIC_URL) ||
      cleanBaseUrl(process.env.FRONTEND_URL) ||
      cleanBaseUrl(process.env.STRAPI_PUBLIC_URL) ||
      'http://localhost:3000';

    const staticEntries = SITE_STATIC_PATHS.map((path) => ({
      path,
      lastmod: toIso(),
      priority: path === '/' ? '1.0' : '0.85',
      changefreq: path === '/' ? 'daily' : 'weekly'
    }));

    const [articles, blogs, books, poems, paintings, photos, podcasts, series] = await Promise.all([
      collectEntries(strapi, 'api::article.article', (slug) => `/articles/${slug}`),
      collectEntries(strapi, 'api::blog.blog', (slug) => `/blogs/${slug}`),
      collectEntries(strapi, 'api::book.book', (slug) => `/books/${slug}`),
      collectEntries(strapi, 'api::poem.poem', (slug) => `/poems/${slug}`),
      collectEntries(strapi, 'api::paintings.painting', (slug) => `/paintings/${slug}`),
      collectEntries(strapi, 'api::photos.photo', (slug) => `/photos/${slug}`),
      collectEntries(strapi, 'api::podcast.podcast', (slug) => `/podcasts/${slug}`),
      collectEntries(strapi, 'api::series.series', (slug) => `/podcasts/series/${slug}`)
    ]);

    const allEntries = [
      ...staticEntries,
      ...articles,
      ...blogs,
      ...books,
      ...poems,
      ...paintings,
      ...photos,
      ...podcasts,
      ...series
    ];

    const seen = new Set();
    const deduped = [];
    for (let i = 0; i < allEntries.length; i += 1) {
      const row = allEntries[i];
      const key = row.path;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(row);
    }

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...deduped.map(
        (row) =>
          `<url><loc>${xmlEscape(`${baseUrl}${row.path}`)}</loc><lastmod>${xmlEscape(
            row.lastmod
          )}</lastmod><changefreq>${xmlEscape(row.changefreq)}</changefreq><priority>${xmlEscape(
            row.priority
          )}</priority></url>`
      ),
      '</urlset>'
    ].join('');

    ctx.set('Content-Type', 'application/xml; charset=utf-8');
    ctx.body = xml;
  }
};

