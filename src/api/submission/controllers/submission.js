'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { sendEmail } = require('../../../utils/email');
const { hasHoneypot, isLikelySpam } = require('../../../utils/requestProtection');

const SUBMISSION_UID = 'api::submission.submission';
const MAX_TITLE_LEN = 220;
const MAX_NAME_LEN = 120;
const MAX_EMAIL_LEN = 255;
const MAX_CATEGORY_LEN = 120;
const MAX_TAGS_LEN = 500;
const MAX_DURATION_LEN = 100;
const MAX_EXCERPT_LEN = 500;
const MAX_CONTENT_LEN = 50000;
const MAX_DESCRIPTION_LEN = 10000;

const cleanString = (value, maxLen = 255) => String(value || '').trim().slice(0, maxLen);
const normalizeName = (value) => cleanString(value, MAX_NAME_LEN);
const normalizeEmail = (value) => cleanString(value, MAX_EMAIL_LEN).toLowerCase();
const normalizeType = (value) => {
  const t = cleanString(value, 40).toLowerCase();
  if (t === 'article' || t === 'podcast') return t;
  return '';
};
const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const asBool = (value) => String(value || '').toLowerCase() === 'true';

const splitEmailList = (value) =>
  String(value || '')
    .split(',')
    .map((item) => normalizeEmail(item))
    .filter((item) => isValidEmail(item));

const getAdminRecipients = () => {
  const result = [];
  const seen = new Set();
  const sources = [
    process.env.SUBMISSION_NOTIFY_EMAILS,
    process.env.ADMIN_EMAIL,
    process.env.NEWSLETTER_ADMIN_EMAILS,
    process.env.CONTACT_NOTIFY_EMAILS,
    process.env.SMTP_FROM
  ];

  for (let i = 0; i < sources.length; i += 1) {
    const current = splitEmailList(sources[i]);
    for (let j = 0; j < current.length; j += 1) {
      const email = current[j];
      if (seen.has(email)) continue;
      seen.add(email);
      result.push(email);
    }
  }

  return result;
};

const escapeHtml = (value) =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const toFileArray = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return [value];
};

async function uploadFiles(strapi, incoming) {
  const files = toFileArray(incoming);
  if (files.length === 0) return [];
  const uploadService = strapi.plugin('upload').service('upload');
  const uploaded = [];
  for (let i = 0; i < files.length; i += 1) {
    const response = await uploadService.upload({
      data: {},
      files: files[i]
    });
    if (Array.isArray(response)) uploaded.push(...response);
  }
  return uploaded;
}

function buildAdminSubmissionHtml(payload) {
  return `
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#eef2f5;font-family:Segoe UI,Tahoma,Arial,sans-serif;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="padding:20px 10px;">
      <tr>
        <td align="center">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:700px;background:#ffffff;border:1px solid #dbe3ea;border-radius:14px;">
            <tr>
              <td style="padding:20px 24px;background:linear-gradient(130deg,#1f2f47,#2f466b);">
                <h2 style="margin:0;color:#ffffff;font-size:22px;">New ${escapeHtml(payload.submissionType)} submission</h2>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 24px;color:#2e3b4f;font-size:14px;line-height:1.7;">
                <p style="margin:0 0 8px 0;"><strong>Title:</strong> ${escapeHtml(payload.title)}</p>
                <p style="margin:0 0 8px 0;"><strong>By:</strong> ${escapeHtml(payload.submitterName)} (${escapeHtml(payload.submitterEmail)})</p>
                <p style="margin:0 0 8px 0;"><strong>Type:</strong> ${escapeHtml(payload.submissionType)}</p>
                <p style="margin:0 0 8px 0;"><strong>Category:</strong> ${escapeHtml(payload.category || '-')}</p>
                <p style="margin:0 0 8px 0;"><strong>Tags:</strong> ${escapeHtml(payload.tags || '-')}</p>
                <p style="margin:0;"><strong>Submitted At:</strong> ${escapeHtml(payload.submittedAt)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildSubmitterAcknowledgementHtml(payload) {
  return `
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#eef2f5;font-family:Segoe UI,Tahoma,Arial,sans-serif;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="padding:20px 10px;">
      <tr>
        <td align="center">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:700px;background:#ffffff;border:1px solid #dbe3ea;border-radius:14px;">
            <tr>
              <td style="padding:20px 24px;background:linear-gradient(130deg,#1f2f47,#2f466b);">
                <h2 style="margin:0;color:#ffffff;font-size:22px;">Submission received</h2>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 24px;color:#2e3b4f;font-size:14px;line-height:1.7;">
                <p style="margin:0 0 10px 0;">Hi ${escapeHtml(payload.submitterName)},</p>
                <p style="margin:0 0 10px 0;">We received your ${escapeHtml(payload.submissionType)} submission titled "${escapeHtml(payload.title)}".</p>
                <p style="margin:0;">Our editors will review it and you will get another email after approval or rejection.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

module.exports = createCoreController(SUBMISSION_UID, ({ strapi }) => ({
  async submit(ctx) {
    try {
      const body = ctx.request.body?.data || ctx.request.body || {};
      const files = ctx.request.files || {};

      if (hasHoneypot(body)) {
        return ctx.send({
          message: 'Submission saved successfully.',
          warning: false,
          data: {
            id: null,
            status: 'pending'
          }
        });
      }

      const submissionType = normalizeType(body.submissionType || body.type);
      const anonymous = asBool(body.anonymous);
      const submitterNameRaw = body.submitterName || body.name;
      const submitterName = anonymous ? 'Anonymous' : normalizeName(submitterNameRaw);
      const submitterEmail = normalizeEmail(body.submitterEmail || body.email);
      const title = cleanString(body.title, MAX_TITLE_LEN);
      const content = cleanString(body.content, MAX_CONTENT_LEN);
      const excerpt = cleanString(body.excerpt, MAX_EXCERPT_LEN);
      const description = cleanString(body.description, MAX_DESCRIPTION_LEN);
      const category = cleanString(body.category, MAX_CATEGORY_LEN);
      const tags = Array.isArray(body.tags)
        ? body.tags.map((item) => cleanString(item, 60)).filter(Boolean).join(', ')
        : cleanString(body.tags, MAX_TAGS_LEN);
      const duration = cleanString(body.duration, MAX_DURATION_LEN);

      if (!submissionType) return ctx.badRequest('submissionType is required');
      if (!title) return ctx.badRequest('title is required');
      if (!submitterEmail || !isValidEmail(submitterEmail)) return ctx.badRequest('valid submitterEmail is required');
      if (!submitterName) return ctx.badRequest('submitterName is required unless anonymous is true');

      if (submissionType === 'article' && !content) {
        return ctx.badRequest('Article content is required');
      }

      if (submissionType === 'podcast') {
        if (!description) return ctx.badRequest('Podcast description is required');
        if (toFileArray(files.audioFile).length === 0) return ctx.badRequest('Podcast audio file is required');
      }

      const spamCheck = isLikelySpam({
        submitterName,
        submitterEmail,
        content,
        description
      });
      if (spamCheck.spam) {
        return ctx.badRequest('Submission was flagged as spam');
      }

      const featuredImageUpload = await uploadFiles(strapi, files.featuredImage);
      const galleryImagesUpload = await uploadFiles(strapi, files.galleryImages);
      const coverImageUpload = await uploadFiles(strapi, files.coverImage);
      const audioUpload = await uploadFiles(strapi, files.audioFile);

      const submittedAt = new Date();
      const created = await strapi.entityService.create(SUBMISSION_UID, {
        data: {
          submissionType,
          status: 'pending',
          title,
          content,
          excerpt,
          description,
          duration,
          category,
          tags,
          submitterName,
          submitterEmail,
          anonymous,
          featuredImage: featuredImageUpload[0]?.id || null,
          galleryImages: galleryImagesUpload.map((file) => file.id),
          coverImage: coverImageUpload[0]?.id || null,
          audioFile: audioUpload[0]?.id || null,
          submittedAt
        }
      });

      const adminRecipients = getAdminRecipients();
      let adminNotifyFailed = false;
      let submitterNotifyFailed = false;

      const adminSubject = `New ${submissionType} submission: ${title}`;
      const adminText = [
        `A new ${submissionType} submission was received.`,
        '',
        `Title: ${title}`,
        `Submitter: ${submitterName}`,
        `Email: ${submitterEmail}`,
        `Category: ${category || '-'}`,
        `Tags: ${tags || '-'}`,
        `Submitted At: ${submittedAt.toISOString()}`,
        '',
        'Review it in Strapi Admin under Submissions.'
      ].join('\n');
      const adminHtml = buildAdminSubmissionHtml({
        submissionType,
        title,
        submitterName,
        submitterEmail,
        category,
        tags,
        submittedAt: submittedAt.toISOString()
      });

      for (let i = 0; i < adminRecipients.length; i += 1) {
        const to = adminRecipients[i];
        try {
          await sendEmail({
            strapi,
            to,
            subject: adminSubject,
            text: adminText,
            html: adminHtml
          });
        } catch (error) {
          adminNotifyFailed = true;
          strapi.log.error(`[submission] Failed to notify admin ${to}`, error);
        }
      }

      try {
        const submitterSubject = `Litloom: ${submissionType} submission received`;
        const submitterText = [
          `Hi ${submitterName},`,
          '',
          `We received your ${submissionType} submission titled "${title}".`,
          'Our team will review it and email you again after approval or rejection.'
        ].join('\n');
        const submitterHtml = buildSubmitterAcknowledgementHtml({
          submitterName,
          submissionType,
          title
        });

        await sendEmail({
          strapi,
          to: submitterEmail,
          subject: submitterSubject,
          text: submitterText,
          html: submitterHtml
        });
      } catch (error) {
        submitterNotifyFailed = true;
        strapi.log.error(`[submission] Failed to notify submitter ${submitterEmail}`, error);
      }

      const warning = adminNotifyFailed || submitterNotifyFailed;
      return ctx.send({
        message: warning
          ? 'Submission saved, but one or more notification emails failed.'
          : 'Submission saved successfully.',
        warning,
        data: {
          id: created?.documentId || created?.id || null,
          status: 'pending',
          submissionType,
          submittedAt: submittedAt.toISOString()
        }
      });
    } catch (error) {
      strapi.log.error('[submission] Failed to save submission', error);
      return ctx.badRequest('Failed to save submission', { error: error.message });
    }
  }
}));
