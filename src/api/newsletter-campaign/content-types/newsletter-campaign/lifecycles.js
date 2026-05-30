'use strict';

const {
  getRefFromEntity,
  dispatchNewsletterCampaign
} = require('../../services/newsletter-dispatch');

function queueDispatch(strapi, entity) {
  const ref = getRefFromEntity(entity);
  if (!ref.id && !ref.documentId) return;

  setTimeout(() => {
    dispatchNewsletterCampaign(strapi, ref).catch((error) => {
      strapi.log.error('[newsletter] Campaign dispatch failed', error);
    });
  }, 0);
}

module.exports = {
  async afterCreate(event) {
    queueDispatch(strapi, event?.result);
  },

  async afterUpdate(event) {
    queueDispatch(strapi, event?.result);
  }
};
