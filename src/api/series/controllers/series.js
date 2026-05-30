"use strict";

module.exports = {
  async publicList(ctx) {
    const { strapi } = global;
    try {
      const results = await strapi.entityService.findMany('api::series.series', {
        populate: ['thumbnail', 'episodes.cover', 'episodes.audio', 'uploader', 'tags', 'episodes.tags'],
        publicationState: 'live'
      });

      // Normalize minimal response for frontend
      const mapped = results.map(s => {
        const attrs = s.attributes || s;
        return {
          id: s.id || s.documentId,
          title: attrs.title,
          description: attrs.description,
          thumbnail: attrs.thumbnail?.data || attrs.thumbnail || null,
          slug: attrs.slug,
          tags: attrs.tags || [],
          uploader: attrs.uploader?.data?.attributes?.username || null,
          episodes: (attrs.episodes && attrs.episodes.data) ? attrs.episodes.data.map(ep => ({
            id: ep.id || ep.documentId,
            title: ep.attributes?.title || ep.title,
            audio: ep.attributes?.audio || null,
            cover: ep.attributes?.cover || null,
            tags: ep.attributes?.tags || [],
            duration: ep.attributes?.duration || null,
            episodeNumber: ep.attributes?.episodeNumber || null,
            publishDate: ep.attributes?.publishDate || null
          })) : []
        };
      });

      ctx.send({ series: mapped });
    } catch (err) {
      ctx.send({ error: err.message }, 500);
    }
  }
};
