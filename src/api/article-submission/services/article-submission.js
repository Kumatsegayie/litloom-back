'use strict';

/**
 * article-submission service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::article-submission.article-submission');
