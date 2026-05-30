'use strict';

const { sendEmail } = require('../../../../utils/email');

const SUBMISSION_UID = 'api::submission.submission';
const ARTICLE_UID = 'api::article.article';
const PODCAST_UID = 'api::podcast.podcast';

const cleanString = (value, maxLen = 255) => String(value || '').trim().slice(0, maxLen);
const normalizeEmail = (value) => cleanString(value, 255).toLowerCase();
const normalizeName = (value) => cleanString(value, 120);
const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const splitAndClean = (value) =>
  String(value || '')
    .split(',')
    .map((item) => cleanString(item, 80))
    .map((item) => item.replace(/^#/, '').trim())
    .filter(Boolean);

const splitEmailList = (value) =>
  String(value || '')
    .split(',')
    .map((item) => normalizeEmail(item))
    .filter((item) => isValidEmail(item));

const getAdminRecipients = () => {
  const seen = new Set();
  const result = [];
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

const slugify = (value) =>
  cleanString(value, 200)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

const mediaId = (media) => {
  if (!media) return null;
  if (typeof media === 'number') return media;
  if (typeof media.id === 'number') return media.id;
  if (typeof media?.data?.id === 'number') return media.data.id;
  return null;
};

const mediaIds = (mediaList) => {
  if (!Array.isArray(mediaList)) return [];
  const out = [];
  for (let i = 0; i < mediaList.length; i += 1) {
    const id = mediaId(mediaList[i]);
    if (id) out.push(id);
  }
  return out;
};

async function findOrCreateCategoryId(submission) {
  const name = cleanString(submission.category, 120);
  if (!name) return null;

  const existing = await strapi.entityService.findMany('api::category.category', {
    filters: { name: { $eqi: name } },
    limit: 1
  });
  if (Array.isArray(existing) && existing[0]?.id) return existing[0].id;

  const created = await strapi.entityService.create('api::category.category', {
    data: {
      name,
      slug: slugify(name) || `category-${Date.now()}`
    }
  });

  return created?.id || null;
}

async function findOrCreateTagIds(submission) {
  const rawTags = splitAndClean(submission.tags);
  if (rawTags.length === 0) return [];

  const ids = [];
  for (let i = 0; i < rawTags.length; i += 1) {
    const name = rawTags[i];
    const existing = await strapi.entityService.findMany('api::tag.tag', {
      filters: { name: { $eqi: name } },
      limit: 1
    });

    if (Array.isArray(existing) && existing[0]?.id) {
      ids.push(existing[0].id);
      continue;
    }

    const created = await strapi.entityService.create('api::tag.tag', {
      data: {
        name,
        slug: slugify(name) || `tag-${Date.now()}-${i}`
      }
    });
    if (created?.id) ids.push(created.id);
  }

  return ids;
}

async function createArticleFromSubmission(submission) {
  const categoryId = await findOrCreateCategoryId(submission);
  const tagIds = await findOrCreateTagIds(submission);
  const author = submission.anonymous ? 'Anonymous Contributor' : normalizeName(submission.submitterName || 'Contributor');
  const title = cleanString(submission.title, 220);
  const content = cleanString(submission.content || submission.description, 50000);

  if (!title || !content) {
    throw new Error('Article submission is missing required content');
  }

  const created = await strapi.entityService.create(ARTICLE_UID, {
    data: {
      title,
      content,
      author,
      type: 'post',
      slug: slugify(title) || `article-${Date.now()}`,
      publishDate: new Date(),
      publishedAt: new Date(),
      thumbnail: mediaId(submission.featuredImage) || mediaId(submission.coverImage) || null,
      images: mediaIds(submission.galleryImages),
      category: categoryId,
      tags: tagIds
    }
  });

  return {
    collection: 'articles',
    documentId: String(created?.documentId || created?.id || '')
  };
}

async function createPodcastFromSubmission(submission) {
  const title = cleanString(submission.title, 220);
  const description = cleanString(submission.description || submission.content, 10000);
  if (!title || !description) {
    throw new Error('Podcast submission is missing title or description');
  }

  const tagIds = await findOrCreateTagIds(submission);
  const created = await strapi.entityService.create(PODCAST_UID, {
    data: {
      title,
      description,
      duration: cleanString(submission.duration, 100),
      slug: slugify(title) || `podcast-${Date.now()}`,
      publishDate: new Date(),
      publishedAt: new Date(),
      cover: mediaId(submission.coverImage) || mediaId(submission.featuredImage) || null,
      audio: mediaId(submission.audioFile) || null,
      tags: tagIds
    }
  });

  return {
    collection: 'podcasts',
    documentId: String(created?.documentId || created?.id || '')
  };
}

async function getSubmissionById(id) {
  if (!id) return null;
  return strapi.entityService.findOne(SUBMISSION_UID, id, {
    populate: ['featuredImage', 'galleryImages', 'coverImage', 'audioFile']
  });
}

function buildSubmitterDecisionEmail(submission, payload) {
  const safeName = escapeHtml(submission.submitterName || 'there');
  const safeTitle = escapeHtml(submission.title || 'your submission');
  const safeNotes = escapeHtml(submission.reviewNotes || '');

  if (payload.kind === 'approved') {
    const subject = `Litloom: Your submission "${submission.title}" was approved`;
    const text = [
      `Hi ${submission.submitterName || 'there'},`,
      '',
      `Great news. Your submission "${submission.title}" has been approved and published.`,
      '',
      'Thank you for contributing to Litloom.'
    ].join('\n');
    const html = `
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#edf3f7;font-family:Segoe UI,Tahoma,Arial,sans-serif;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="padding:20px 10px;">
      <tr>
        <td align="center">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:700px;background:#ffffff;border:1px solid #d8e2ec;border-radius:14px;">
            <tr>
              <td style="padding:20px 24px;background:linear-gradient(130deg,#12735e,#2ca88d);">
                <h2 style="margin:0;color:#ffffff;font-size:22px;">Submission approved</h2>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 24px;color:#2b3b50;font-size:14px;line-height:1.75;">
                <p style="margin:0 0 10px 0;">Hi ${safeName},</p>
                <p style="margin:0 0 10px 0;">Your submission <strong>${safeTitle}</strong> has been approved and published.</p>
                <p style="margin:0;">Thank you for contributing to Litloom.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
    return { subject, text, html };
  }

  if (payload.kind === 'rejected') {
    const subject = `Litloom: Your submission "${submission.title}" was not approved`;
    const text = [
      `Hi ${submission.submitterName || 'there'},`,
      '',
      `Your submission "${submission.title}" was reviewed but not approved this time.`,
      submission.reviewNotes ? `Review notes: ${submission.reviewNotes}` : '',
      '',
      'You can revise and submit again.'
    ].filter(Boolean).join('\n');
    const html = `
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#edf3f7;font-family:Segoe UI,Tahoma,Arial,sans-serif;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="padding:20px 10px;">
      <tr>
        <td align="center">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:700px;background:#ffffff;border:1px solid #d8e2ec;border-radius:14px;">
            <tr>
              <td style="padding:20px 24px;background:linear-gradient(130deg,#7a1f35,#b73757);">
                <h2 style="margin:0;color:#ffffff;font-size:22px;">Submission update</h2>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 24px;color:#2b3b50;font-size:14px;line-height:1.75;">
                <p style="margin:0 0 10px 0;">Hi ${safeName},</p>
                <p style="margin:0 0 10px 0;">Your submission <strong>${safeTitle}</strong> was reviewed but not approved this time.</p>
                ${safeNotes ? `<p style="margin:0;"><strong>Review notes:</strong> ${safeNotes}</p>` : '<p style="margin:0;">You can revise and submit again.</p>'}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
    return { subject, text, html };
  }

  const subject = `Litloom: Submission processing issue`;
  const text = [
    `Hi ${submission.submitterName || 'there'},`,
    '',
    `Your submission "${submission.title}" was approved by editor review, but publishing failed due to a technical issue.`,
    payload.errorMessage ? `Error: ${payload.errorMessage}` : '',
    '',
    'Our team has been notified and will follow up.'
  ].filter(Boolean).join('\n');
  const html = `
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#edf3f7;font-family:Segoe UI,Tahoma,Arial,sans-serif;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="padding:20px 10px;">
      <tr>
        <td align="center">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:700px;background:#ffffff;border:1px solid #d8e2ec;border-radius:14px;">
            <tr>
              <td style="padding:20px 24px;background:linear-gradient(130deg,#8a5a16,#c4872f);">
                <h2 style="margin:0;color:#ffffff;font-size:22px;">Submission processing issue</h2>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 24px;color:#2b3b50;font-size:14px;line-height:1.75;">
                <p style="margin:0 0 10px 0;">Hi ${safeName},</p>
                <p style="margin:0 0 10px 0;">Your submission <strong>${safeTitle}</strong> was approved, but publishing failed due to a technical issue.</p>
                ${payload.errorMessage ? `<p style="margin:0;"><strong>Error:</strong> ${escapeHtml(payload.errorMessage)}</p>` : ''}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  return { subject, text, html };
}

async function sendAdminFailureAlert(submission, errorMessage) {
  const admins = getAdminRecipients();
  if (admins.length === 0) return;

  const subject = `Submission publish failed: ${cleanString(submission.title, 140)}`;
  const text = [
    'Submission was marked approved, but auto-publish failed.',
    '',
    `Submission ID: ${submission.documentId || submission.id || '-'}`,
    `Type: ${submission.submissionType}`,
    `Title: ${submission.title}`,
    `Submitter: ${submission.submitterName} (${submission.submitterEmail})`,
    `Error: ${errorMessage || 'Unknown error'}`
  ].join('\n');

  for (let i = 0; i < admins.length; i += 1) {
    try {
      await sendEmail({
        strapi,
        to: admins[i],
        subject,
        text
      });
    } catch (error) {
      strapi.log.error(`[submission] Failed to send publish-failure alert to ${admins[i]}`, error);
    }
  }
}

async function sendDecisionEmailToSubmitter(submission, payload) {
  const email = normalizeEmail(submission.submitterEmail);
  if (!isValidEmail(email)) return;
  const built = buildSubmitterDecisionEmail(submission, payload);
  await sendEmail({
    strapi,
    to: email,
    subject: built.subject,
    text: built.text,
    html: built.html
  });
}

module.exports = {
  async beforeUpdate(event) {
    try {
      const where = event?.params?.where || {};
      let current = null;

      if (where.id) {
        current = await strapi.entityService.findOne(SUBMISSION_UID, where.id, {
          fields: ['id', 'status']
        });
      } else if (where.documentId) {
        const rows = await strapi.entityService.findMany(SUBMISSION_UID, {
          filters: { documentId: { $eq: String(where.documentId) } },
          fields: ['id', 'status'],
          limit: 1
        });
        current = Array.isArray(rows) ? rows[0] : null;
      }

      if (current?.status) {
        event.state = event.state || {};
        event.state.previousStatus = current.status;
      }
    } catch (error) {
      strapi.log.error('[submission] beforeUpdate lifecycle failed', error);
    }
  },

  async afterUpdate(event) {
    try {
      const nextStatus = event?.result?.status;
      const previousStatus = event?.state?.previousStatus || null;

      if (!event?.result?.id || !nextStatus || previousStatus === nextStatus) return;
      if (nextStatus !== 'approved' && nextStatus !== 'rejected') return;

      const submission = await getSubmissionById(event.result.id);
      if (!submission) return;

      if (nextStatus === 'rejected') {
        await sendDecisionEmailToSubmitter(submission, { kind: 'rejected' });
        return;
      }

      let publishedRef = {
        collection: cleanString(submission.publishedCollection, 120),
        documentId: cleanString(submission.publishedDocumentId, 120)
      };

      let publishErrorMessage = '';
      if (!publishedRef.documentId) {
        try {
          const created =
            submission.submissionType === 'podcast'
              ? await createPodcastFromSubmission(submission)
              : await createArticleFromSubmission(submission);

          publishedRef = created;
          await strapi.entityService.update(SUBMISSION_UID, submission.id, {
            data: {
              publishedCollection: publishedRef.collection,
              publishedDocumentId: publishedRef.documentId,
              reviewedAt: submission.reviewedAt || new Date(),
              reviewedBy: cleanString(submission.reviewedBy || 'Admin', 120)
            }
          });
        } catch (error) {
          publishErrorMessage = cleanString(error?.message || 'Failed to publish approved submission', 500);
          strapi.log.error('[submission] Failed to publish approved submission', error);
          await sendAdminFailureAlert(submission, publishErrorMessage);
        }
      }

      if (publishErrorMessage) {
        await sendDecisionEmailToSubmitter(submission, {
          kind: 'approval_failed',
          errorMessage: publishErrorMessage
        });
        return;
      }

      await sendDecisionEmailToSubmitter(submission, { kind: 'approved' });
    } catch (error) {
      strapi.log.error('[submission] afterUpdate lifecycle failed', error);
    }
  }
};
