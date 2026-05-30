'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/paintings-public',
      handler: 'public.findPublic',
      config: {
        auth: false,
        policies: [],
      },
    },
  ],
};
