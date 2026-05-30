'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/emails/subscribe',
      handler: 'email.subscribe',
      config: {
        auth: false
      }
    },
    {
      method: 'POST',
      path: '/emails/newsletter',
      handler: 'email.newsletter',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
        middlewares: []
      }
    }
  ]
};
