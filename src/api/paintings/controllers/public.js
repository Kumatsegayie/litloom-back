'use strict';

module.exports = {
  async findPublic(ctx) {
    try {
      const entries = await strapi.entityService.findMany('api::paintings.painting', {
        populate: ['images', 'tags'],
      });
      ctx.body = { data: entries };
    } catch (e) {
      ctx.throw(500, 'Error fetching paintings');
    }
  },
};
