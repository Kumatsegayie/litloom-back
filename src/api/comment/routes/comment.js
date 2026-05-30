'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/comments/submit',
      handler: 'comment.submit',
      config: {
        auth: false
      }
    },
    {
      method: 'GET',
      path: '/comments/public',
      handler: 'comment.publicList',
      config: {
        auth: false
      }
    }
  ]
};
