'use strict';

/**
 * article-submission router
 */

const { createCoreRouter } = require('@strapi/strapi').factories;

module.exports = createCoreRouter('api::article-submission.article-submission', {
  config: {
    submit: {
      methods: ['POST'],
      path: '/article-submissions/submit',
      handler: 'article-submission.submit',
      config: {
        policies: [],
        middlewares: ['plugin::upload.upload'],
      },
    },
    approve: {
      methods: ['POST'],
      path: '/article-submissions/:id/approve',
      handler: 'article-submission.approve',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
        middlewares: [],
      },
    },
    reject: {
      methods: ['POST'],
      path: '/article-submissions/:id/reject',
      handler: 'article-submission.reject',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
        middlewares: [],
      },
    },
    pending: {
      methods: ['GET'],
      path: '/article-submissions/pending',
      handler: 'article-submission.pending',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
        middlewares: [],
      },
    },
  },
});