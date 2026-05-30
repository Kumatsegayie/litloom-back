'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/photos-public',
      handler: 'public.findPublic',
      config: {
        auth: false,
        policies: [],
      },
    },
  ],
};
