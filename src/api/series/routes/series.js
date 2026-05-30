"use strict";

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/series/public',
      handler: 'series.publicList',
      config: {
        auth: false
      }
    }
  ]
};
