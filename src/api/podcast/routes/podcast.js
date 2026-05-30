"use strict";

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/podcasts/:id/full',
      handler: 'podcast.full',
      config: {
        auth: false
      }
    }
    ,
    {
      method: 'GET',
      path: '/podcasts/slug/:slug/full',
      handler: 'podcast.fullBySlug',
      config: {
        auth: false
      }
    }
    ,
    {
      method: 'GET',
      path: '/podcasts/public',
      handler: 'podcast.publicList',
      config: {
        auth: false
      }
    }
  ]
};

