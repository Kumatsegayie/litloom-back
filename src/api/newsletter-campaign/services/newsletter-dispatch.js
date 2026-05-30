'use strict';

const { sendEmail } = require('../../../utils/email');
let markedToHtml = null;

try {
  const markedLib = require('marked');
  if (typeof markedLib?.parse === 'function') {
    markedToHtml = markedLib.parse;
  } else if (typeof markedLib?.marked?.parse === 'function') {
    markedToHtml = markedLib.marked.parse;
  } else if (typeof markedLib?.marked === 'function') {
    markedToHtml = markedLib.marked;
  }
} catch (error) {
  markedToHtml = null;
}

const CAMPAIGN_UID = 'api::newsletter-campaign.newsletter-campaign';
const SUBSCRIBER_UID = 'api::email.email';
const SUBSCRIBER_TABLE = 'emails';
const MAX_FAILURE_REPORT = 30;
const DEFAULT_ACCENT = '#0f6a55';
const DEFAULT_SENDING_STALE_MS = 2 * 60 * 1000;
const ADMIN_FAILURE_PREVIEW = 80;

const cleanString = (value, maxLen = 255) => String(value || '').trim().slice(0, maxLen);
const normalizeEmail = (value) => cleanString(value, 255).toLowerCase();
const normalizeName = (value) => cleanString(value, 120);
const escapeHtml = (value) =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const stripHtml = (value) => String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const isValidUrl = (value) => /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(String(value || '').trim());
const normalizeHex = (value) => {
  const raw = String(value || '').trim();
  if (/^#[0-9a-f]{3}$/i.test(raw) || /^#[0-9a-f]{6}$/i.test(raw)) return raw;
  return DEFAULT_ACCENT;
};
const toAbsoluteUrl = (value, baseUrl = '') => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (!baseUrl) return raw;
  const base = String(baseUrl || '').trim().replace(/\/$/, '');
  if (!base) return raw;
  if (raw.startsWith('/')) return `${base}${raw}`;
  return `${base}/${raw}`;
};
const normalizeCtaUrl = (value, baseUrl = '') => {
  const raw = cleanString(value, 2048);
  if (!raw) return '';
  if (isValidUrl(raw)) return raw;
  if (raw.startsWith('/')) {
    return toAbsoluteUrl(raw, baseUrl);
  }
  if (/^(www\.)?[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(raw)) {
    return `https://${raw.replace(/^https?:\/\//i, '')}`;
  }
  return '';
};

const looksLikeHtml = (value) => /<[^>]+>/.test(String(value || ''));
const inlineMarkdownToHtml = (value) => {
  let out = escapeHtml(String(value || ''));
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^\*])\*([^*]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/(^|[^_])_([^_]+)_/g, '$1<em>$2</em>');
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
  return out;
};
const basicMarkdownToHtml = (value) => {
  const raw = String(value || '').replace(/\r\n/g, '\n');
  if (!raw.trim()) return '';

  const lines = raw.split('\n');
  const blocks = [];
  let inList = false;

  const closeList = () => {
    if (!inList) return;
    blocks.push('</ul>');
    inList = false;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      closeList();
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = Math.min(6, heading[1].length);
      blocks.push(`<h${level}>${inlineMarkdownToHtml(heading[2])}</h${level}>`);
      continue;
    }

    const listItem = trimmed.match(/^[-*]\s+(.+)$/);
    if (listItem) {
      if (!inList) {
        inList = true;
        blocks.push('<ul>');
      }
      blocks.push(`<li>${inlineMarkdownToHtml(listItem[1])}</li>`);
      continue;
    }

    closeList();
    blocks.push(`<p>${inlineMarkdownToHtml(trimmed)}</p>`);
  }

  closeList();
  return blocks.join('\n');
};
const renderMarkdownAsHtml = (value) => {
  const raw = String(value || '');
  if (!raw.trim()) return '';
  if (looksLikeHtml(raw)) return raw;
  if (typeof markedToHtml === 'function') {
    try {
      return markedToHtml(raw);
    } catch (error) {
      // fallback below
    }
  }
  return basicMarkdownToHtml(raw);
};

const getRefFromEntity = (entity) => ({
  id: entity?.id || null,
  documentId: entity?.documentId || null
});

const splitEmails = (value) =>
  String(value || '')
    .split(',')
    .map((item) => normalizeEmail(item))
    .filter((item) => isValidEmail(item));

const getAdminRecipients = () => {
  const seen = new Set();
  const result = [];
  const values = [
    process.env.NEWSLETTER_ADMIN_EMAILS,
    process.env.ADMIN_EMAIL,
    process.env.COMMENT_NOTIFY_EMAILS,
    process.env.SMTP_FROM
  ];

  for (let i = 0; i < values.length; i += 1) {
    const current = splitEmails(values[i]);
    for (let j = 0; j < current.length; j += 1) {
      const email = current[j];
      if (seen.has(email)) continue;
      seen.add(email);
      result.push(email);
    }
  }

  return result;
};

function buildAdminCampaignReport({ campaign, finalStatus, recipientsCount, sentCount, failedCount, failures }) {
  const subjectLine = cleanString(campaign?.subject || 'Newsletter Campaign', 180);
  const failureRows = (failures || []).slice(0, ADMIN_FAILURE_PREVIEW);
  const campaignIdText = campaign?.documentId || String(campaign?.id || '-');
  const failListText = failureRows.length
    ? failureRows.map((item) => `- ${item.email}: ${item.error || 'Unknown error'}`).join('\n')
    : 'No failed recipients.';

  const text = [
    `Newsletter report for: ${subjectLine}`,
    `Campaign: ${campaignIdText}`,
    `Status: ${finalStatus}`,
    `Total recipients: ${recipientsCount}`,
    `Sent: ${sentCount}`,
    `Failed: ${failedCount}`,
    '',
    'Failed recipients:',
    failListText
  ].join('\n');

  const htmlFailures = failureRows.length
    ? `<ul style="margin:8px 0 0 0;padding-left:18px;">${failureRows
        .map((item) => `<li>${escapeHtml(item.email)} - ${escapeHtml(item.error || 'Unknown error')}</li>`)
        .join('')}</ul>`
    : '<p style="margin:8px 0 0 0;">No failed recipients.</p>';

  const html = `
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f1f5f3;font-family:Segoe UI,Tahoma,Arial,sans-serif;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="padding:22px 10px;">
      <tr>
        <td align="center">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:700px;background:#ffffff;border:1px solid #dbe7e2;border-radius:16px;">
            <tr>
              <td style="padding:22px 26px;background:linear-gradient(130deg,#0f6a55,#1f8a70);">
                <h2 style="margin:0;color:#ffffff;font-size:22px;line-height:1.3;">Newsletter Delivery Report</h2>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 26px;color:#2d3a35;font-size:14px;line-height:1.75;">
                <p style="margin:0 0 8px 0;"><strong>Subject:</strong> ${escapeHtml(subjectLine)}</p>
                <p style="margin:0 0 8px 0;"><strong>Campaign:</strong> ${escapeHtml(campaignIdText)}</p>
                <p style="margin:0 0 8px 0;"><strong>Status:</strong> ${escapeHtml(finalStatus)}</p>
                <p style="margin:0 0 8px 0;"><strong>Total:</strong> ${recipientsCount}</p>
                <p style="margin:0 0 8px 0;"><strong>Sent:</strong> ${sentCount}</p>
                <p style="margin:0;"><strong>Failed:</strong> ${failedCount}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 26px 22px 26px;color:#2d3a35;font-size:13px;line-height:1.7;">
                <p style="margin:0;"><strong>Failed recipients:</strong></p>
                ${htmlFailures}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { text, html, subjectLine };
}

async function sendAdminCampaignReport(strapi, payload) {
  const admins = getAdminRecipients();
  if (admins.length === 0) return;

  const { text, html, subjectLine } = buildAdminCampaignReport(payload);
  const statusWord = payload.finalStatus === 'sent' ? 'Success' : 'Attention';
  const reportSubject = `[${statusWord}] Newsletter: ${subjectLine}`;

  for (let i = 0; i < admins.length; i += 1) {
    const to = admins[i];
    try {
      await sendEmail({
        strapi,
        to,
        subject: reportSubject,
        text,
        html
      });
    } catch (error) {
      strapi.log.error(`[newsletter] Failed to send admin report to ${to}`, error);
    }
  }
}

async function findCampaign(strapi, ref) {
  if (!ref?.id && !ref?.documentId) return null;

  const pickPreferredVersion = (rows = []) => {
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const published = rows.find((row) => !!row?.publishedAt);
    if (published) return published;
    return rows[0];
  };

  if (ref.documentId) {
    const byDocument = await strapi.db.query(CAMPAIGN_UID).findMany({
      where: { documentId: String(ref.documentId) },
      populate: ['heroImage'],
      orderBy: [{ publishedAt: 'desc' }, { updatedAt: 'desc' }, { id: 'desc' }]
    });
    const preferred = pickPreferredVersion(byDocument);
    if (preferred) return preferred;
  }

  if (ref.id) {
    const byId = await strapi.db.query(CAMPAIGN_UID).findOne({
      where: { id: ref.id },
      populate: ['heroImage']
    });
    if (!byId) return null;

    if (byId.documentId) {
      const byDocument = await strapi.db.query(CAMPAIGN_UID).findMany({
        where: { documentId: String(byId.documentId) },
        populate: ['heroImage'],
        orderBy: [{ publishedAt: 'desc' }, { updatedAt: 'desc' }, { id: 'desc' }]
      });
      return pickPreferredVersion(byDocument) || byId;
    }

    return byId;
  }

  return null;
}

async function fetchSubscriberRows(strapi) {
  // Prefer direct table reads so campaign sends always use the canonical emails table.
  try {
    const rows = await strapi.db.connection(SUBSCRIBER_TABLE)
      .select(['id', 'name', 'email'])
      .orderBy('id', 'asc');

    if (Array.isArray(rows)) return rows;
  } catch (error) {
    strapi.log.error('[newsletter] Failed to read recipients from emails table', error);
  }

  try {
    return await strapi.db.query(SUBSCRIBER_UID).findMany({
      orderBy: [{ id: 'asc' }]
    });
  } catch (error) {
    strapi.log.error('[newsletter] Failed to read recipients from email content-type', error);
    return [];
  }
}

function buildNewsletterHtml(campaign, recipient, baseUrl) {
  const accent = normalizeHex(campaign?.accentColor || DEFAULT_ACCENT);
  const senderName = 'Litloom';
  const headline = cleanString(campaign?.subject || 'Litloom Newsletter', 220);
  const bodyRaw = String(campaign?.body || '');
  const bodyHtml = renderMarkdownAsHtml(bodyRaw);
  const preheader = stripHtml(bodyHtml).slice(0, 180) || headline;
  const ctaLabel = cleanString(campaign?.ctaLabel, 60);
  const ctaUrl = normalizeCtaUrl(campaign?.ctaUrl, baseUrl);
  const recipientName = recipient?.name || 'there';

  const heroUrlRaw =
    campaign?.heroImage?.url ||
    campaign?.heroImage?.formats?.large?.url ||
    campaign?.heroImage?.formats?.medium?.url ||
    campaign?.heroImage?.formats?.small?.url ||
    '';
  const heroUrl = toAbsoluteUrl(heroUrlRaw, baseUrl);
  const heroImage = heroUrl
    ? `
      <tr>
        <td style="padding: 0 28px;">
          <img src="${escapeHtml(heroUrl)}" alt="Newsletter hero" style="width:100%;height:auto;border-radius:14px;display:block;border:0;" />
        </td>
      </tr>
      <tr><td style="height:18px;line-height:18px;font-size:0;">&nbsp;</td></tr>
    `
    : '';

  const ctaBlock = ctaLabel
    ? ctaUrl
      ? `
      <tr>
        <td style="padding: 0 28px 6px 28px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0">
            <tr>
              <td style="border-radius: 12px; background: ${accent};">
                <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:12px 22px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;letter-spacing:0.2px;">
                  ${escapeHtml(ctaLabel)}
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr><td style="height:16px;line-height:16px;font-size:0;">&nbsp;</td></tr>
    `
      : `
      <tr>
        <td style="padding: 0 28px 6px 28px;">
          <span style="display:inline-block;padding:12px 22px;color:#ffffff;background:${accent};border-radius:12px;font-size:14px;font-weight:700;letter-spacing:0.2px;">
            ${escapeHtml(ctaLabel)}
          </span>
        </td>
      </tr>
      <tr><td style="height:16px;line-height:16px;font-size:0;">&nbsp;</td></tr>
    `
    : '';

  return `
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#eef3f1;font-family:Segoe UI,Tahoma,Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      ${escapeHtml(preheader || headline)}
    </div>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#eef3f1;padding:26px 10px;">
      <tr>
        <td align="center">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:700px;background:#ffffff;border:1px solid #dde7e2;border-radius:18px;overflow:hidden;box-shadow:0 18px 42px rgba(15,35,31,0.12);">
            <tr>
              <td style="padding:24px 28px;background:linear-gradient(130deg, ${accent} 0%, #1f8a70 60%, #2a9d8f 100%);">
                <p style="margin:0;color:#d9f4ec;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;">${escapeHtml(senderName)}</p>
                <h1 style="margin:10px 0 0 0;color:#ffffff;font-size:30px;line-height:1.2;letter-spacing:0.3px;">${escapeHtml(headline)}</h1>
              </td>
            </tr>
            <tr><td style="height:20px;line-height:20px;font-size:0;">&nbsp;</td></tr>
            ${heroImage}
            <tr>
              <td style="padding:0 28px 10px 28px;">
                <p style="margin:0;color:#31423c;font-size:15px;line-height:1.75;">Hi ${escapeHtml(recipientName)},</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 18px 28px;color:#24312c;font-size:15px;line-height:1.75;">
                ${bodyHtml}
              </td>
            </tr>
            ${ctaBlock}
            <tr>
              <td style="padding:0 28px 24px 28px;">
                <hr style="border:none;border-top:1px solid #e4ece8;margin:0 0 14px 0;" />
                <p style="margin:0;color:#5f6b66;font-size:12px;line-height:1.7;">You are receiving this because you subscribed to Litloom updates.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildNewsletterText(campaign, recipient) {
  const senderName = 'Litloom';
  const headline = cleanString(campaign?.subject || 'Litloom Newsletter', 220);
  const bodyRaw = String(campaign?.body || '');
  const bodyText = looksLikeHtml(bodyRaw) ? stripHtml(bodyRaw) : bodyRaw;
  const ctaLabel = cleanString(campaign?.ctaLabel, 60);
  const ctaUrl = normalizeCtaUrl(campaign?.ctaUrl);
  const recipientName = recipient?.name || 'there';

  const lines = [
    `${senderName} Newsletter`,
    '',
    headline,
    '',
    `Hi ${recipientName},`,
    '',
    bodyText
  ];

  if (ctaLabel && ctaUrl) {
    lines.push('');
    lines.push(`${ctaLabel}: ${ctaUrl}`);
  } else if (ctaLabel) {
    lines.push('');
    lines.push(`CTA: ${ctaLabel}`);
  }

  lines.push('');
  lines.push('You are receiving this because you subscribed to Litloom updates.');
  return lines.join('\n');
}

async function dispatchNewsletterCampaign(strapi, ref) {
  let campaign = await findCampaign(strapi, ref);
  if (!campaign) return;

  if (!campaign.publishedAt) return;
  if (campaign.sendStatus === 'sending') {
    const staleMs = Math.max(
      60 * 1000,
      Number(process.env.NEWSLETTER_SENDING_STALE_MS || DEFAULT_SENDING_STALE_MS)
    );
    const updatedTs = Number(new Date(campaign.updatedAt || 0).getTime() || 0);
    const ageMs = updatedTs > 0 ? Date.now() - updatedTs : Number.POSITIVE_INFINITY;

    if (ageMs < staleMs) return;

    strapi.log.warn(
      `[newsletter] Releasing stale sending lock for document=${campaign.documentId || '-'} id=${campaign.id || '-'} ageMs=${Math.max(0, Math.floor(ageMs))}`
    );

    await strapi.db.query(CAMPAIGN_UID).update({
      where: campaign.id ? { id: campaign.id } : { documentId: campaign.documentId },
      data: {
        sendStatus: 'draft',
        lastError: 'Recovered from stale sending lock'
      }
    });

    campaign = await findCampaign(strapi, ref);
    if (!campaign) return;
    if (!campaign.publishedAt) return;
    if (campaign.sendStatus === 'sending') return;
  }

  const publishedAtTs = Number(new Date(campaign.publishedAt).getTime() || 0);
  const sentAtTs = Number(new Date(campaign.sentAt || 0).getTime() || 0);
  const shouldSend =
    campaign.sendStatus === 'draft' ||
    !sentAtTs ||
    (publishedAtTs > 0 && publishedAtTs > sentAtTs);

  if (!shouldSend) return;

  strapi.log.info(
    `[newsletter] Dispatch starting for campaign document=${campaign.documentId || '-'} id=${campaign.id || '-'}`
  );

  const whereLock = campaign.id
    ? { id: campaign.id, sendStatus: { $ne: 'sending' } }
    : { documentId: campaign.documentId, sendStatus: { $ne: 'sending' } };

  const locked = await strapi.db.query(CAMPAIGN_UID).update({
    where: whereLock,
    data: {
      sendStatus: 'sending',
      lastError: null
    }
  });

  if (!locked) return;

  const activeCampaign = await findCampaign(strapi, ref);
  if (!activeCampaign) return;

  const rawSubscribers = await fetchSubscriberRows(strapi);
  const seen = new Set();
  const recipients = [];

  for (let i = 0; i < (rawSubscribers || []).length; i += 1) {
    const row = rawSubscribers[i] || {};
    const email = normalizeEmail(row.email);
    if (!isValidEmail(email) || seen.has(email)) continue;
    seen.add(email);
    recipients.push({
      name: normalizeName(row.name),
      email
    });
  }

  strapi.log.info(`[newsletter] Loaded ${recipients.length} recipient(s) from ${SUBSCRIBER_TABLE}`);

  if (recipients.length === 0) {
    await strapi.db.query(CAMPAIGN_UID).update({
      where: campaign.id ? { id: campaign.id } : { documentId: campaign.documentId },
      data: {
        sendStatus: 'sent',
        sentAt: new Date(),
        totalRecipients: 0,
        sentCount: 0,
        failedCount: 0,
        failureReport: []
      }
    });

    await sendAdminCampaignReport(strapi, {
      campaign: activeCampaign,
      finalStatus: 'sent',
      recipientsCount: 0,
      sentCount: 0,
      failedCount: 0,
      failures: []
    });

    return;
  }

  let sentCount = 0;
  let failedCount = 0;
  const failures = [];
  const subject = cleanString(activeCampaign.subject, 180);
  const senderName = 'Litloom';
  const defaultFrom = cleanString(process.env.EMAIL_DEFAULT_FROM || process.env.SMTP_FROM || '', 255);
  const from = defaultFrom ? `${senderName} <${defaultFrom}>` : undefined;
  const fallbackHost = cleanString(process.env.PUBLIC_HOST || process.env.HOST || '', 255);
  const fallbackProtocol = cleanString(process.env.PUBLIC_PROTOCOL || 'http', 10) || 'http';
  const normalizedFallbackHost = fallbackHost === '0.0.0.0' ? 'localhost' : fallbackHost;
  const fallbackPort = cleanString(process.env.PUBLIC_PORT || process.env.PORT || '', 20);
  const fallbackOrigin = normalizedFallbackHost
    ? `${fallbackProtocol}://${normalizedFallbackHost}${fallbackPort ? `:${fallbackPort}` : ''}`
    : '';
  const configuredBaseUrl = cleanString(
    process.env.STRAPI_PUBLIC_URL ||
      process.env.PUBLIC_URL ||
      strapi.config.get('server.url') ||
      fallbackOrigin,
    2048
  );
  const publicBaseUrl = /^https?:\/\//i.test(configuredBaseUrl)
    ? configuredBaseUrl.replace(/\/$/, '')
    : '';

  for (let i = 0; i < recipients.length; i += 1) {
    const recipient = recipients[i];
    const html = buildNewsletterHtml(activeCampaign, recipient, publicBaseUrl);
    const text = buildNewsletterText(activeCampaign, recipient);

    try {
      await sendEmail({
        strapi,
        to: recipient.email,
        subject,
        text,
        html,
        from
      });
      sentCount += 1;
    } catch (error) {
      failedCount += 1;
      failures.push({
        email: recipient.email,
        error: cleanString(error?.message || 'Unknown error', 500)
      });
      strapi.log.error(`[newsletter] Failed to send to ${recipient.email}`, error);
    }
  }

  const finalStatus =
    failedCount === 0
      ? 'sent'
      : sentCount === 0
        ? 'failed'
        : 'partial';

  await strapi.db.query(CAMPAIGN_UID).update({
    where: campaign.id ? { id: campaign.id } : { documentId: campaign.documentId },
    data: {
      sendStatus: finalStatus,
      sentAt: new Date(),
      totalRecipients: recipients.length,
      sentCount,
      failedCount,
      lastError: failures[0]?.error || null,
      failureReport: failures.slice(0, MAX_FAILURE_REPORT)
    }
  });

  await sendAdminCampaignReport(strapi, {
    campaign: activeCampaign,
    finalStatus,
    recipientsCount: recipients.length,
    sentCount,
    failedCount,
    failures
  });

  strapi.log.info(
    `[newsletter] Dispatch completed for document=${campaign.documentId || '-'} status=${finalStatus} sent=${sentCount} failed=${failedCount}`
  );
}

module.exports = {
  getRefFromEntity,
  dispatchNewsletterCampaign
};
