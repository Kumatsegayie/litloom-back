'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

const normalizeName = (value = '') => String(value || '').trim().replace(/\s+/g, ' ');

const normalizeRelationIds = (relationField) => {
  if (!relationField) return [];
  const list = Array.isArray(relationField)
    ? relationField
    : (Array.isArray(relationField.data) ? relationField.data : []);

  return list
    .map((entry) => {
      const attrs = entry?.attributes || entry || {};
      const id = entry?.documentId || attrs?.documentId || entry?.id || attrs?.id || null;
      return id ? String(id) : null;
    })
    .filter(Boolean);
};

module.exports = createCoreController('api::tag.tag', ({ strapi }) => ({
  async publicList(ctx) {
    const tags = await strapi.entityService.findMany('api::tag.tag', {
      sort: { name: 'asc' },
      fields: ['name', 'slug'],
      populate: {
        articles: { fields: ['documentId'] },
        blogs: { fields: ['documentId'] },
        books: { fields: ['documentId'] },
        poems: { fields: ['documentId'] },
        paintings: { fields: ['documentId'] },
        photos: { fields: ['documentId'] },
        podcasts: { fields: ['documentId'] },
        serieses: { fields: ['documentId'] },
      },
    });

    const data = (tags || []).map((tag) => {
      const attrs = tag.attributes || tag;
      return {
        id: tag.id || tag.documentId,
        name: attrs.name,
        slug: attrs.slug,
        links: {
          article: normalizeRelationIds(attrs.articles),
          blog: normalizeRelationIds(attrs.blogs),
          book: normalizeRelationIds(attrs.books),
          poem: normalizeRelationIds(attrs.poems),
          painting: normalizeRelationIds(attrs.paintings),
          photo: normalizeRelationIds(attrs.photos),
          podcast: normalizeRelationIds(attrs.podcasts),
          series: normalizeRelationIds(attrs.serieses),
        },
      };
    });

    ctx.send({ data });
  },

  async suggest(ctx) {
    const q = normalizeName(ctx.query.q || '');
    const limit = Math.min(Math.max(Number(ctx.query.limit) || 15, 1), 50);

    const tags = await strapi.entityService.findMany('api::tag.tag', {
      filters: q ? { name: { $containsi: q } } : {},
      sort: { name: 'asc' },
      fields: ['name', 'slug'],
      limit,
    });

    const data = (tags || []).map((tag) => {
      const attrs = tag.attributes || tag;
      return {
        id: tag.id || tag.documentId,
        name: attrs.name,
        slug: attrs.slug,
      };
    });

    ctx.send({ data });
  },

  async ensure(ctx) {
    const body = ctx.request.body || {};
    const incoming = Array.isArray(body.names)
      ? body.names
      : [body.name];

    const requested = incoming
      .map(normalizeName)
      .filter(Boolean);

    if (!requested.length) {
      return ctx.badRequest('No tag name provided');
    }

    const unique = [...new Set(requested.map((name) => name.toLowerCase()))];
    const created = [];
    const existing = [];

    for (const key of unique) {
      const original = requested.find((n) => n.toLowerCase() === key) || key;
      const found = await strapi.entityService.findMany('api::tag.tag', {
        filters: { name: { $eqi: original } },
        fields: ['name', 'slug'],
        limit: 1,
      });

      const current = Array.isArray(found) ? found[0] : null;
      if (current) {
        const attrs = current.attributes || current;
        existing.push({
          id: current.id || current.documentId,
          name: attrs.name,
          slug: attrs.slug,
        });
        continue;
      }

      const made = await strapi.entityService.create('api::tag.tag', {
        data: { name: original },
      });
      const attrs = made.attributes || made;
      created.push({
        id: made.id || made.documentId,
        name: attrs.name,
        slug: attrs.slug,
      });
    }

    ctx.send({
      data: [...existing, ...created],
      meta: {
        created: created.length,
        existing: existing.length,
      },
    });
  },
}));
