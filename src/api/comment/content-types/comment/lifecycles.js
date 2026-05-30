'use strict';

const COMMENT_UID = 'api::comment.comment';
const NOTIFY_STATUSES = new Set(['public', 'rejected']);
const { sendEmail } = require('../../../../utils/email');
const DEFAULT_REVIEWER = 'Litloom Moderation Team';

function getStatus(value) {
  if (!value || typeof value !== 'object') return null;
  return value.moderationStatus || value.status || null;
}

function getEntityId(where = {}) {
  if (where.id) return where.id;
  if (where.documentId) return where.documentId;
  return null;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDateTime(value) {
  if (!value) return 'N/A';
  try {
    return new Date(value).toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (error) {
    return String(value);
  }
}

function buildModerationEmail({
  decision,
  commenterName,
  contentTitle,
  commentText,
  reviewedBy,
  reviewedAt,
  adminNotes,
  pageUrl
}) {
  const isAccepted = decision === 'accepted';
  const safeName = commenterName || 'Reader';
  const safeTitle = contentTitle || 'your post';
  const safeReviewer = reviewedBy || DEFAULT_REVIEWER;
  const safeReviewedAt = formatDateTime(reviewedAt);
  const safeNotes = (adminNotes || '').trim() || (isAccepted
    ? 'No additional moderation note was provided.'
    : 'No detailed moderation note was provided.');
  const safeCommentText = (commentText || '').trim() || 'N/A';

  const subject = isAccepted
    ? 'Congratulations - Your Litloom Comment Has Been Accepted'
    : 'Update on Your Litloom Comment Submission';

  const statusBadgeText = isAccepted ? 'Accepted' : 'Rejected';
  const statusColor = isAccepted ? '#0f766e' : '#991b1b';
  const statusBg = isAccepted ? '#e6f7f4' : '#fdecec';
  const borderColor = isAccepted ? '#bde7df' : '#f5c8c8';
  const heading = isAccepted
    ? 'Congratulations on your published comment'
    : 'Comment moderation update';

  const opening = isAccepted
    ? `Dear ${safeName},<br /><br />Thank you for your thoughtful comment on <strong>"${escapeHtml(safeTitle)}"</strong>. We are pleased to inform you that your comment has been reviewed and approved for public display on Litloom.`
    : `Dear ${safeName},<br /><br />Thank you for taking the time to comment on <strong>"${escapeHtml(safeTitle)}"</strong>. After careful review, we regret to inform you that your comment has not been approved for publication.`;

  const decisionLine = isAccepted
    ? 'Your contribution is now visible to readers under the post.'
    : 'The moderation decision was made to maintain our community standards.';
  const themeFont = `'Segoe UI', Tahoma, Geneva, Verdana, sans-serif`;

  const previewButton = pageUrl
    ? `
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 22px 0 10px 0;">
        <tr>
          <td align="center" style="border-radius: 12px; background: linear-gradient(135deg, #0b5d4d, #1e7b62); box-shadow: 0 8px 20px rgba(11, 93, 77, 0.28);">
            <a href="${escapeHtml(pageUrl)}" style="display: inline-block; padding: 13px 24px; font-family: ${themeFont}; font-size: 14px; font-weight: 700; color: #ffffff; text-decoration: none; letter-spacing: 0.2px;">
              Preview Post
            </a>
          </td>
        </tr>
      </table>
    `
    : '';

  const rejectionReasonBlock = !isAccepted
    ? `
      <p style="margin: 0 0 10px 0; font-size: 15px; line-height: 1.7; color: #334155;">
        <strong>Reason for rejection:</strong> ${escapeHtml(safeNotes)}
      </p>
    `
    : '';

  const html = `
<!doctype html>
<html>
  <body style="margin: 0; padding: 0; background: #edf3f1;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background: linear-gradient(180deg, #edf3f1 0%, #f5f8f7 100%); padding: 30px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width: 700px; background: #ffffff; border: 1px solid #d8e3df; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 42px rgba(15, 35, 31, 0.10);">
            <tr>
              <td style="padding: 22px 24px; background: linear-gradient(130deg, #0a5a4a 0%, #0e6f5a 48%, #155e75 100%);">
                <div style="font-family: ${themeFont}; font-size: 24px; font-weight: 700; color: #ffffff; letter-spacing: 0.2px;">Litloom</div>
                <div style="font-family: ${themeFont}; font-size: 13px; color: #d9f4ec; margin-top: 6px;">Comment Moderation Update</div>
              </td>
            </tr>
            <tr>
              <td style="padding: 28px 24px 26px 24px;">
                <div style="display: inline-block; padding: 6px 12px; border-radius: 999px; font-family: ${themeFont}; font-size: 12px; font-weight: 700; color: ${statusColor}; background: ${statusBg}; border: 1px solid ${borderColor}; letter-spacing: 0.25px;">
                  ${statusBadgeText}
                </div>
                <h1 style="margin: 14px 0 14px 0; font-family: ${themeFont}; font-size: 30px; line-height: 1.24; letter-spacing: 0.1px; color: #0f172a;">
                  ${heading}
                </h1>
                <p style="margin: 0 0 12px 0; font-family: ${themeFont}; font-size: 15px; line-height: 1.78; color: #334155;">
                  ${opening}
                </p>
                <p style="margin: 0 0 16px 0; font-family: ${themeFont}; font-size: 15px; line-height: 1.78; color: #334155;">
                  ${decisionLine}
                </p>
                ${rejectionReasonBlock}
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin: 16px 0 0 0; border: 1px solid #dce6e2; border-radius: 12px; overflow: hidden;">
                  <tr>
                    <td style="padding: 14px 16px; background: #f6fbf9; font-family: ${themeFont}; font-size: 13px; color: #1f2937;">
                      <strong>Post:</strong> ${escapeHtml(safeTitle)}<br />
                      <strong>Reviewed by:</strong> ${escapeHtml(safeReviewer)}<br />
                      <strong>Review date:</strong> ${escapeHtml(safeReviewedAt)}
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 14px 16px; font-family: ${themeFont}; font-size: 13px; color: #1f2937; border-top: 1px solid #dce6e2;">
                      <strong>Admin note:</strong><br />
                      <span style="display: inline-block; margin-top: 5px; color: #334155;">${escapeHtml(safeNotes)}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 14px 16px; font-family: ${themeFont}; font-size: 13px; color: #1f2937; border-top: 1px solid #dce6e2;">
                      <strong>Your comment:</strong><br />
                      <span style="display: inline-block; margin-top: 5px; color: #334155;">${escapeHtml(safeCommentText)}</span>
                    </td>
                  </tr>
                </table>
                ${previewButton}
                <p style="margin: 16px 0 0 0; font-family: ${themeFont}; font-size: 14px; line-height: 1.75; color: #334155;">
                  We sincerely appreciate your engagement with Litloom and thank you for helping us maintain a thoughtful and respectful literary community.
                </p>
                <p style="margin: 14px 0 0 0; font-family: ${themeFont}; font-size: 14px; line-height: 1.75; color: #0f172a; font-weight: 600;">
                  Respectfully,<br />
                  The Litloom Editorial Team
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const textLines = [
    `Dear ${safeName},`,
    '',
    isAccepted
      ? `Congratulations. Your comment on "${safeTitle}" has been accepted and is now public on Litloom.`
      : `Thank you for your comment on "${safeTitle}". After review, your comment has been rejected.`,
    '',
    `Reviewed by: ${safeReviewer}`,
    `Review date: ${safeReviewedAt}`,
    `Admin note: ${safeNotes}`,
    '',
    'Your comment:',
    safeCommentText,
    ''
  ];

  if (pageUrl) {
    textLines.push(`Preview post: ${pageUrl}`);
    textLines.push('');
  }

  textLines.push('Thank you for your valued contribution to Litloom.');
  textLines.push('Respectfully,');
  textLines.push('The Litloom Editorial Team');

  return {
    subject,
    text: textLines.join('\n'),
    html
  };
}

async function findCommentForLifecycle(where = {}, fields = []) {
  const id = where?.id;
  const documentId = where?.documentId;

  if (id) {
    try {
      return await strapi.entityService.findOne(COMMENT_UID, id, { fields });
    } catch (error) {
      // fallback to documentId path below
    }
  }

  if (documentId) {
    const rows = await strapi.entityService.findMany(COMMENT_UID, {
      filters: { documentId: { $eq: String(documentId) } },
      fields,
      limit: 1
    });
    if (Array.isArray(rows) && rows.length > 0) return rows[0];
  }

  return null;
}

module.exports = {
  async beforeUpdate(event) {
    const { params, state } = event;
    const where = params?.where || {};
    const entityId = getEntityId(where);

    if (!entityId) return;

    try {
      const existing = await findCommentForLifecycle(where, [
        'commenterName',
        'commenterEmail',
        'comment',
        'contentTitle',
        'pageUrl',
        'reviewedBy',
        'reviewedAt',
        'contentType',
        'moderationStatus',
        'status',
        'adminNotes'
      ]);

      state.previousComment = existing || null;
      state.previousStatus = getStatus(existing);
    } catch (error) {
      strapi.log.error('[comments] beforeUpdate lookup failed', error);
    }

    const nextStatus = getStatus(params?.data || {});
    if (nextStatus && nextStatus !== state.previousStatus && !params.data.reviewedAt) {
      params.data.reviewedAt = new Date();
    }

    if (!params?.data?.reviewedBy) {
      try {
        const reqCtx = strapi?.requestContext?.get?.();
        const user = reqCtx?.state?.user;
        const reviewedBy = user?.username || user?.email || (user?.id ? `admin-${user.id}` : null);
        if (reviewedBy) {
          params.data.reviewedBy = reviewedBy;
        }
      } catch (error) {
        // no-op
      }
    }
  },

  async afterUpdate(event) {
    const { result, params, state } = event;
    const where = params?.where || {};
    const previousStatus = state?.previousStatus || null;
    const nextStatus = getStatus(result) || getStatus(params?.data || {});

    if (!nextStatus || nextStatus === previousStatus) return;
    if (!NOTIFY_STATUSES.has(nextStatus)) return;

    let fresh = null;
    try {
      fresh = await findCommentForLifecycle(where, [
        'commenterName',
        'commenterEmail',
        'comment',
        'contentTitle',
        'pageUrl',
        'reviewedBy',
        'reviewedAt',
        'contentType',
        'adminNotes'
      ]);
    } catch (error) {
      strapi.log.error('[comments] afterUpdate lookup failed', error);
    }

    const recipient = result?.commenterEmail || fresh?.commenterEmail || state?.previousComment?.commenterEmail || null;
    if (!recipient) return;
    const commenterName = result?.commenterName || fresh?.commenterName || state?.previousComment?.commenterName || 'there';
    const contentTitle = result?.contentTitle || fresh?.contentTitle || state?.previousComment?.contentTitle || result?.contentType || fresh?.contentType || 'your post';
    const commentText = result?.comment || fresh?.comment || state?.previousComment?.comment || '';
    const pageUrl = result?.pageUrl || fresh?.pageUrl || state?.previousComment?.pageUrl || '';
    const reviewedBy = result?.reviewedBy || params?.data?.reviewedBy || fresh?.reviewedBy || state?.previousComment?.reviewedBy || DEFAULT_REVIEWER;
    const reviewedAt = result?.reviewedAt || params?.data?.reviewedAt || fresh?.reviewedAt || new Date();
    const adminNotes = (result?.adminNotes || params?.data?.adminNotes || fresh?.adminNotes || '').trim();
    const decision = nextStatus === 'public' ? 'accepted' : 'rejected';
    const moderationEmail = buildModerationEmail({
      decision,
      commenterName,
      contentTitle,
      commentText,
      reviewedBy,
      reviewedAt,
      adminNotes,
      pageUrl
    });

    try {
      const mailResult = await sendEmail({
        strapi,
        to: recipient,
        subject: moderationEmail.subject,
        text: moderationEmail.text,
        html: moderationEmail.html
      });
      strapi.log.info(
        `[comments] Commenter moderation email sent via ${mailResult?.provider || 'unknown'} to ${recipient}`
      );
    } catch (error) {
      strapi.log.error(
        `[comments] Failed to notify commenter about moderation: ${error?.message || 'unknown error'}`,
        error
      );
    }
  }
};
