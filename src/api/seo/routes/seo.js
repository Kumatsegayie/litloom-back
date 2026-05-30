'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/seo/sitemap.xml',
      handler: 'seo.sitemap',
      config: {
        auth: false
      }
    }
  ]
};

