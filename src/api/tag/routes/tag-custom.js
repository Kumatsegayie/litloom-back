'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/tags/public',
      handler: 'tag.publicList',
      config: { auth: false },
    },
    {
      method: 'GET',
      path: '/tags/suggest',
      handler: 'tag.suggest',
      config: { auth: false },
    },
    {
      method: 'POST',
      path: '/tags/ensure',
      handler: 'tag.ensure',
      config: { auth: false },
    },
  ],
};
