"use strict";

module.exports = {
  async full(ctx) {
    const { id } = ctx.params;
    if (!id) return ctx.badRequest('Missing id');

    const podcast = await strapi.entityService.findOne('api::podcast.podcast', id, {
      populate: ['cover', 'audio', 'series', 'uploader', 'tags']
    });

    if (!podcast) return ctx.notFound('Podcast not found');

    let list = [];

    try {
      if (podcast.series && podcast.series.id) {
        // Fetch other episodes in the same series
        list = await strapi.entityService.findMany('api::podcast.podcast', {
          filters: { series: podcast.series.id },
          sort: { episodeNumber: 'asc' },
          populate: ['cover', 'audio', 'tags']
        });
      } else {
        // Standalone: get other floating podcasts as suggestions
        list = await strapi.entityService.findMany('api::podcast.podcast', {
          filters: { series: { $null: true }, id: { $not: podcast.id } },
          limit: 6,
          populate: ['cover', 'audio', 'tags']
        });
      }
    } catch (err) {
      strapi.log.error(err);
    }

    ctx.send({ podcast, list });
  }
  ,
  async fullBySlug(ctx) {
    const { slug } = ctx.params;
    if (!slug) return ctx.badRequest('Missing slug');

    // Find podcast by slug
    const found = await strapi.entityService.findMany('api::podcast.podcast', {
      filters: { slug: { $eq: slug } },
      populate: ['cover', 'audio', 'series', 'uploader', 'tags']
    });

    const podcast = (found && found.length > 0) ? found[0] : null;
    if (!podcast) return ctx.notFound('Podcast not found');

    let list = [];
    try {
      if (podcast.series && podcast.series.id) {
        list = await strapi.entityService.findMany('api::podcast.podcast', {
          filters: { series: podcast.series.id },
          sort: { episodeNumber: 'asc' },
          populate: ['cover', 'audio', 'tags']
        });
      } else {
        list = await strapi.entityService.findMany('api::podcast.podcast', {
          filters: { series: { $null: true }, id: { $not: podcast.id } },
          limit: 6,
          populate: ['cover', 'audio', 'tags']
        });
      }
    } catch (err) {
      strapi.log.error(err);
    }

    ctx.send({ podcast, list });
  }
  ,
  async publicList(ctx) {
    try {
      // Fetch all series with their episodes
      const seriesData = await strapi.entityService.findMany('api::series.series', {
        populate: {
          thumbnail: true,
          uploader: true,
          tags: true,
          episodes: {
            populate: ['cover', 'audio', 'tags']
          }
        }
      });

      const seriesList = (seriesData || []).map(item => {
        const attrs = item.attributes || item || {};
        const uploader = (attrs.uploader && attrs.uploader.data) ? attrs.uploader.data.attributes : (attrs.uploader || {});
        const episodesRaw = (attrs.episodes && attrs.episodes.data) ? attrs.episodes.data : (attrs.episodes || []);
        return {
          id: item.id || item.documentId || attrs.id,
          type: 'series',
          title: attrs.title || attrs.name || null,
          host: uploader?.username || uploader?.name || null,
          cover: attrs.thumbnail || attrs.cover || null,
          description: attrs.description || attrs.summary || null,
          slug: attrs.slug || null,
          tags: attrs.tags || [],
          episodes: (episodesRaw || []).map(ep => {
            const eAttrs = ep.attributes || ep || {};
            return {
              id: ep.id || ep.documentId || eAttrs.id,
              title: eAttrs.title || eAttrs.name || null,
              slug: eAttrs.slug || null,
              duration: eAttrs.duration || null,
              cover: eAttrs.cover || null,
              audio: eAttrs.audio || null,
              embedUrl: eAttrs.embedUrl || null,
              tags: eAttrs.tags || [],
              episodeNumber: eAttrs.episodeNumber || eAttrs.number || null,
              publishDate: eAttrs.publishDate || eAttrs.publishedAt || null
            };
          })
        };
      });

      // Fetch floating podcasts (no series)
      const floatingData = await strapi.entityService.findMany('api::podcast.podcast', {
        filters: { series: { $null: true } },
        populate: ['cover', 'audio', 'uploader', 'tags']
      });

      const floatingList = (floatingData || []).map(item => {
        const attrs = item.attributes || item || {};
        const uploader = (attrs.uploader && attrs.uploader.data) ? attrs.uploader.data.attributes : (attrs.uploader || {});
        return {
          id: item.id || item.documentId || attrs.id,
          type: 'floating',
          title: attrs.title || attrs.name || null,
          host: uploader?.username || uploader?.name || null,
          cover: attrs.cover || null,
          description: attrs.description || null,
          audio: attrs.audio || null,
          embedUrl: attrs.embedUrl || null,
          duration: attrs.duration || null,
          slug: attrs.slug || null,
          tags: attrs.tags || []
        };
      });

      ctx.send({ series: seriesList, floating: floatingList });
    } catch (err) {
      strapi.log.error('Error building public podcasts list', err);
      ctx.internalServerError('Failed to load podcasts');
    }
  }
};
