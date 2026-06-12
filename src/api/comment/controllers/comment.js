'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { sendEmail } = require('../../../utils/email');
const { hasHoneypot, isLikelySpam } = require('../../../utils/requestProtection');

const MAX_NAME_LEN = 120;
const MAX_TYPE_LEN = 80;
const MAX_ID_LEN = 160;
const MAX_TITLE_LEN = 255;
const MAX_URL_LEN = 2048;
const MAX_COMMENT_LEN = 5000;

const cleanString = (value, maxLen) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.slice(0, maxLen);
};

const cleanEmail = (value) => cleanString(value, 255).toLowerCase();

const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const COMMENT_UID = 'api::comment.comment';
const ADMIN_FALLBACK_EMAIL = 'litloom1@gmail.com';

function getStatusField(strapi) {
  const attrs = strapi?.contentTypes?.[COMMENT_UID]?.attributes || {};
  if (attrs.moderationStatus) return 'moderationStatus';
  if (attrs.status) return 'status';
  return 'moderationStatus';
}

module.exports = createCoreController(COMMENT_UID, ({ strapi }) => ({
  async submit(ctx) {
    try {
      const body = ctx.request.body?.data || ctx.request.body || {};

      if (hasHoneypot(body)) {
        return ctx.send({
          message: 'Comment submitted successfully and is pending moderation.',
          data: {
            id: null,
            moderationStatus: 'pending',
            status: 'pending'
          }
        });
      }

      const commenterName = cleanString(body.commenterName || body.name, MAX_NAME_LEN);
      const commenterEmail = cleanEmail(body.commenterEmail || body.email);
      const comment = cleanString(body.comment || body.content, MAX_COMMENT_LEN);
      const contentType = cleanString(body.contentType, MAX_TYPE_LEN);
      const contentId = cleanString(body.contentId, MAX_ID_LEN);
      const contentSlug = cleanString(body.contentSlug, MAX_ID_LEN);
      const contentTitle = cleanString(body.contentTitle, MAX_TITLE_LEN);
      const pageUrl = cleanString(body.pageUrl, MAX_URL_LEN);

      if (!commenterName || !commenterEmail || !comment || !contentType || !contentId) {
        return ctx.badRequest('Missing required fields');
      }

      if (!isValidEmail(commenterEmail)) {
        return ctx.badRequest('Invalid email address');
      }

      const spamCheck = isLikelySpam({
        commenterName,
        commenterEmail,
        comment
      });
      if (spamCheck.spam) {
        return ctx.badRequest('Comment was flagged as spam');
      }

      const statusField = getStatusField(strapi);
      const payload = {
        commenterName,
        commenterEmail,
        comment,
        contentType,
        contentId,
        contentSlug: contentSlug || null,
        contentTitle: contentTitle || null,
        pageUrl: pageUrl || null,
        submittedAt: new Date(),
        [statusField]: 'pending'
      };

      let created;
      try {
        created = await strapi.entityService.create(COMMENT_UID, { data: payload });
      } catch (primaryError) {
        // Backward compatibility if DB is still on old/new column naming.
        const altField = statusField === 'moderationStatus' ? 'status' : 'moderationStatus';
        const retryPayload = { ...payload };
        delete retryPayload[statusField];
        retryPayload[altField] = 'pending';
        created = await strapi.entityService.create(COMMENT_UID, { data: retryPayload });
      }

      // Notify admins by email about a new pending comment.
      let adminNotifyRecipients = [];
      let adminNotifyProvider = '';
      let adminNotifyError = '';
      try {
        const notifyListRaw = [
          ADMIN_FALLBACK_EMAIL,
          process.env.COMMENT_NOTIFY_EMAILS || '',
          process.env.SUBMISSION_NOTIFY_EMAILS || '',
          process.env.ADMIN_EMAIL || ''
        ].join(',');

        const to = [...new Set(
          notifyListRaw
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean)
        )];
        adminNotifyRecipients = to;

        const subject = `New pending comment on ${contentTitle || contentType}`;
        const textLines = [
          'A new comment was submitted and is waiting for moderation.',
          '',
          `Name: ${commenterName}`,
          `Email: ${commenterEmail}`,
          `Content type: ${contentType}`,
          `Content id: ${contentId}`,
          `Content title: ${contentTitle || '-'}`,
          `Content slug: ${contentSlug || '-'}`,
          `Submitted at: ${new Date().toISOString()}`,
          `Page URL: ${pageUrl || '-'}`,
          '',
          'Comment:',
          comment,
          '',
          'Review in Strapi Admin -> Content Manager -> Comments and set moderationStatus to "public" to publish.'
        ];

        if (to.length > 0) {
          const mailResult = await sendEmail({
            strapi,
            to,
            subject,
            text: textLines.join('\n')
          });
          adminNotifyProvider = mailResult?.provider || '';
          strapi.log.info(
            `[comments] Admin notification sent via ${mailResult?.provider || 'unknown'} to ${to.join(', ')}`
          );
        }
      } catch (mailErr) {
        adminNotifyError = mailErr?.message || 'unknown error';
        strapi.log.error(
          `[comments] Failed to notify admins: ${mailErr?.message || 'unknown error'}`,
          mailErr
        );
      }

      ctx.send({
        message: 'Comment submitted successfully and is pending moderation.',
        mailDebug: {
          attempted: adminNotifyRecipients.length > 0,
          recipients: adminNotifyRecipients,
          provider: adminNotifyProvider || null,
          failed: Boolean(adminNotifyError),
          error: adminNotifyError || null
        },
        data: {
          id: created?.id || created?.documentId || null,
          moderationStatus: 'pending',
          status: 'pending'
        }
      });
    } catch (error) {
      strapi.log.error('[comments] Failed to submit comment', error);
      ctx.badRequest('Failed to submit comment', { error: error.message });
    }
  },

  async publicList(ctx) {
    try {
      const contentType = cleanString(ctx.query.contentType, MAX_TYPE_LEN);
      const contentId = cleanString(ctx.query.contentId, MAX_ID_LEN);
      const contentSlug = cleanString(ctx.query.contentSlug, MAX_ID_LEN);

      if (!contentType || (!contentId && !contentSlug)) {
        return ctx.badRequest('contentType and contentId (or contentSlug) are required');
      }

      const statusField = getStatusField(strapi);
      const postIdentityFilter = contentSlug
        ? { $or: [{ contentId: { $eq: contentId } }, { contentSlug: { $eq: contentSlug } }] }
        : { contentId: { $eq: contentId } };

      const makeFilters = (fieldName) => ({
        contentType: { $eq: contentType },
        ...postIdentityFilter,
        [fieldName]: { $eq: 'public' }
      });

      let records = [];
      try {
        records = await strapi.entityService.findMany(COMMENT_UID, {
          filters: makeFilters(statusField),
          sort: { submittedAt: 'desc' },
          fields: ['commenterName', 'comment', 'submittedAt', 'adminNotes', 'reviewedAt', 'reviewedBy']
        });
      } catch (primaryError) {
        const altField = statusField === 'moderationStatus' ? 'status' : 'moderationStatus';
        records = await strapi.entityService.findMany(COMMENT_UID, {
          filters: makeFilters(altField),
          sort: { submittedAt: 'desc' },
          fields: ['commenterName', 'comment', 'submittedAt', 'adminNotes', 'reviewedAt', 'reviewedBy']
        });
      }

      // Compatibility: include legacy records that may still use the alternate field.
      if (!records || records.length === 0) {
        const altField = statusField === 'moderationStatus' ? 'status' : 'moderationStatus';
        try {
          records = await strapi.entityService.findMany(COMMENT_UID, {
            filters: makeFilters(altField),
            sort: { submittedAt: 'desc' },
            fields: ['commenterName', 'comment', 'submittedAt', 'adminNotes', 'reviewedAt', 'reviewedBy']
          });
        } catch (ignoreAltError) {
          // no-op
        }
      }

      const list = (records || []).map((item) => {
        const attrs = item?.attributes || item || {};
        return {
          id: item?.documentId || item?.id || null,
          name: attrs.commenterName || '',
          comment: attrs.comment || '',
          submittedAt: attrs.submittedAt || attrs.createdAt || null,
          adminNotes: attrs.adminNotes || '',
          reviewedAt: attrs.reviewedAt || null,
          reviewedBy: attrs.reviewedBy || ''
        };
      });

      ctx.send({ data: list });
    } catch (error) {
      strapi.log.error('[comments] Failed to fetch public comments', error);
      ctx.badRequest('Failed to fetch comments', { error: error.message });
    }
  }
}));
