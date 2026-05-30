'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { sendEmail } = require('../../../utils/email');
const { hasHoneypot, isLikelySpam } = require('../../../utils/requestProtection');

const EMAIL_UID = 'api::email.email';
const NAME_MAX_LEN = 120;
const SUBJECT_MAX_LEN = 180;
const MESSAGE_MAX_LEN = 20000;
const ADMIN_FAIL_PREVIEW = 50;

const cleanString = (value, maxLen = 255) => String(value || '').trim().slice(0, maxLen);
const cleanLongText = (value, maxLen = MESSAGE_MAX_LEN) => String(value || '').slice(0, maxLen);
const normalizeName = (value) => cleanString(value, NAME_MAX_LEN);
const normalizeEmail = (value) => cleanString(value, 255).toLowerCase();
const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const isUniqueConstraintError = (error) => {
  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || error?.cause?.code || '').toLowerCase();

  if (code === 'er_dup_entry' || code === 'sqlite_constraint_unique' || code === '23505') {
    return true;
  }

  return (
    message.includes('duplicate') ||
    message.includes('unique') ||
    message.includes('constraint')
  );
};

const getEntityId = (record) => record?.documentId || record?.id || null;
const escapeHtml = (value) =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const splitRecipientString = (value) =>
  String(value || '')
    .split(',')
    .map((item) => normalizeEmail(item))
    .filter((item) => isValidEmail(item));

const getAdminRecipients = () => {
  const seen = new Set();
  const result = [];
  const sourceValues = [
    process.env.NEWSLETTER_ADMIN_EMAILS,
    process.env.ADMIN_EMAIL,
    process.env.COMMENT_NOTIFY_EMAILS,
    process.env.SMTP_FROM
  ];

  for (let i = 0; i < sourceValues.length; i += 1) {
    const current = splitRecipientString(sourceValues[i]);
    for (let j = 0; j < current.length; j += 1) {
      const email = current[j];
      if (seen.has(email)) continue;
      seen.add(email);
      result.push(email);
    }
  }

  return result;
};

const toIsoDisplay = (value) => {
  const date = value ? new Date(value) : new Date();
  const stamp = Number(date.getTime() || 0);
  if (!stamp) return new Date().toISOString();
  return date.toISOString();
};

function buildSubscriberWelcomeHtml(name) {
  const safeName = escapeHtml(name || 'friend');
  return `
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#eef3f1;font-family:Segoe UI,Tahoma,Arial,sans-serif;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="padding:24px 10px;background:#eef3f1;">
      <tr>
        <td align="center">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:640px;background:#ffffff;border-radius:16px;border:1px solid #dce7e3;overflow:hidden;">
            <tr>
              <td style="padding:24px 28px;background:linear-gradient(135deg,#0f6a55,#1f8a70);">
                <h1 style="margin:0;color:#ffffff;font-size:26px;line-height:1.25;">Welcome to Litloom</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:22px 28px;color:#2b3934;font-size:15px;line-height:1.7;">
                <p style="margin:0 0 12px 0;">Hi ${safeName},</p>
                <p style="margin:0 0 12px 0;">You subscribed successfully. You will now receive Litloom news and updates.</p>
                <p style="margin:0;">If you ever want to unsubscribe, reply to this email and we will help immediately.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 22px 28px;color:#64706b;font-size:12px;">Thanks for joining Litloom.</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildSubscriberWelcomeText(name) {
  return [
    `Hi ${name || 'there'},`,
    '',
    'You subscribed successfully to Litloom.',
    'You will now receive updates and newsletters.',
    '',
    'If you want to unsubscribe, reply to this email and we will help.',
    '',
    'Thanks,',
    'Litloom'
  ].join('\n');
}

function buildAdminSubscribeHtml(name, email, subscribedAt) {
  return `
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f7f6;font-family:Segoe UI,Tahoma,Arial,sans-serif;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="padding:20px 10px;">
      <tr>
        <td align="center">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:620px;background:#ffffff;border-radius:14px;border:1px solid #dde7e2;">
            <tr>
              <td style="padding:20px 24px;border-bottom:1px solid #e6eeea;">
                <h2 style="margin:0;color:#124236;font-size:20px;">New Subscriber</h2>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 24px;color:#2c3a35;font-size:14px;line-height:1.7;">
                <p style="margin:0 0 8px 0;"><strong>Name:</strong> ${escapeHtml(name)}</p>
                <p style="margin:0 0 8px 0;"><strong>Email:</strong> ${escapeHtml(email)}</p>
                <p style="margin:0;"><strong>Subscribed At:</strong> ${escapeHtml(toIsoDisplay(subscribedAt))}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

async function sendSubscriptionNotifications({ strapi, name, email, subscribedAt, notifyAdmins = true }) {
  const welcomeSubject = 'You are subscribed to Litloom';
  const welcomeHtml = buildSubscriberWelcomeHtml(name);
  const welcomeText = buildSubscriberWelcomeText(name);
  let welcomeSent = false;
  let welcomeError = null;

  try {
    await sendEmail({
      strapi,
      to: email,
      subject: welcomeSubject,
      text: welcomeText,
      html: welcomeHtml
    });
    welcomeSent = true;
  } catch (error) {
    welcomeError = error?.message || 'Unknown error';
    strapi.log.error(`[emails] Failed to send subscription welcome email to ${email}`, error);
  }

  if (!notifyAdmins) {
    return {
      welcomeSent,
      welcomeError,
      adminNotifiedCount: 0,
      adminFailedCount: 0
    };
  }

  const admins = getAdminRecipients();
  if (admins.length === 0) {
    return {
      welcomeSent,
      welcomeError,
      adminNotifiedCount: 0,
      adminFailedCount: 0
    };
  }

  const adminSubject = `New Litloom subscriber: ${name}`;
  const adminHtml = buildAdminSubscribeHtml(name, email, subscribedAt);
  const adminText = [
    'New subscriber joined Litloom.',
    '',
    `Name: ${name}`,
    `Email: ${email}`,
    `Subscribed At: ${toIsoDisplay(subscribedAt)}`
  ].join('\n');
  let adminNotifiedCount = 0;
  let adminFailedCount = 0;

  for (let i = 0; i < admins.length; i += 1) {
    const adminEmail = admins[i];
    try {
      await sendEmail({
        strapi,
        to: adminEmail,
        subject: adminSubject,
        text: adminText,
        html: adminHtml
      });
      adminNotifiedCount += 1;
    } catch (error) {
      adminFailedCount += 1;
      strapi.log.error(`[emails] Failed to notify admin ${adminEmail} about subscription`, error);
    }
  }

  return {
    welcomeSent,
    welcomeError,
    adminNotifiedCount,
    adminFailedCount
  };
}

module.exports = createCoreController(EMAIL_UID, ({ strapi }) => ({
  async subscribe(ctx) {
    try {
      const body = ctx.request.body?.data || ctx.request.body || {};

      if (hasHoneypot(body)) {
        return ctx.send({
          alreadySubscribed: false,
          message: 'Subscription successful.',
          warning: false,
          data: null
        });
      }

      const name = normalizeName(body.name);
      const email = normalizeEmail(body.email);

      if (!name) {
        return ctx.badRequest('Name is required');
      }

      if (!email) {
        return ctx.badRequest('Email is required');
      }

      if (!isValidEmail(email)) {
        return ctx.badRequest('Invalid email address');
      }

      const spamCheck = isLikelySpam({ name, email });
      if (spamCheck.spam) {
        return ctx.badRequest('Subscription was flagged as spam');
      }

      const existing = await strapi.entityService.findMany(EMAIL_UID, {
        filters: { email: { $eq: email } },
        limit: 1
      });

      if (Array.isArray(existing) && existing.length > 0) {
        const current = existing[0];
        const notifications = await sendSubscriptionNotifications({
          strapi,
          name: current?.name || name,
          email: current?.email || email,
          subscribedAt: current?.subscribedAt || current?.createdAt || new Date(),
          notifyAdmins: false
        });
        return ctx.send({
          alreadySubscribed: true,
          message: notifications?.welcomeSent
            ? 'This email is already subscribed. Welcome email sent again.'
            : 'This email is already subscribed. We could not send welcome email right now.',
          warning: !notifications?.welcomeSent,
          data: {
            id: getEntityId(current),
            name: current?.name || name,
            email: current?.email || email,
            subscribedAt: current?.subscribedAt || current?.createdAt || null,
            welcomeEmailSent: Boolean(notifications?.welcomeSent),
            welcomeEmailError: notifications?.welcomeError || null
          }
        });
      }

      let created;
      try {
        created = await strapi.entityService.create(EMAIL_UID, {
          data: {
            name,
            email,
            subscribedAt: new Date()
          }
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          const notifications = await sendSubscriptionNotifications({
            strapi,
            name,
            email,
            subscribedAt: new Date(),
            notifyAdmins: false
          });
          return ctx.send({
            alreadySubscribed: true,
            message: notifications?.welcomeSent
              ? 'This email is already subscribed. Welcome email sent again.'
              : 'This email is already subscribed. We could not send welcome email right now.',
            warning: !notifications?.welcomeSent,
            data: {
              name,
              email,
              welcomeEmailSent: Boolean(notifications?.welcomeSent),
              welcomeEmailError: notifications?.welcomeError || null
            }
          });
        }
        throw error;
      }

      const notifications = await sendSubscriptionNotifications({
        strapi,
        name: created?.name || name,
        email: created?.email || email,
        subscribedAt: created?.subscribedAt || created?.createdAt || new Date()
      });

      return ctx.send({
        alreadySubscribed: false,
        message: notifications?.welcomeSent
          ? 'Subscription successful. Welcome email sent.'
          : 'Subscription successful, but welcome email failed to send.',
        warning: !notifications?.welcomeSent,
        data: {
          id: getEntityId(created),
          name: created?.name || name,
          email: created?.email || email,
          subscribedAt: created?.subscribedAt || created?.createdAt || null,
          welcomeEmailSent: Boolean(notifications?.welcomeSent),
          welcomeEmailError: notifications?.welcomeError || null
        }
      });
    } catch (error) {
      strapi.log.error('[emails] Failed to subscribe', error);
      return ctx.badRequest('Failed to subscribe', { error: error.message });
    }
  },

  async newsletter(ctx) {
    try {
      const body = ctx.request.body?.data || ctx.request.body || {};
      const subject = cleanString(body.subject, SUBJECT_MAX_LEN);
      const message = cleanLongText(body.message || body.text, MESSAGE_MAX_LEN).trim();
      const html = cleanLongText(body.html, MESSAGE_MAX_LEN).trim();

      if (!subject) {
        return ctx.badRequest('Newsletter subject is required');
      }

      if (!message && !html) {
        return ctx.badRequest('Newsletter body is required');
      }

      const subscribers = await strapi.db.query(EMAIL_UID).findMany();
      const deduped = [];
      const seen = new Set();

      for (let i = 0; i < (subscribers || []).length; i += 1) {
        const row = subscribers[i] || {};
        const email = normalizeEmail(row.email);
        if (!isValidEmail(email) || seen.has(email)) continue;
        seen.add(email);
        deduped.push({
          name: normalizeName(row.name),
          email
        });
      }

      if (deduped.length === 0) {
        return ctx.send({
          message: 'No subscribed emails found.',
          data: {
            total: 0,
            sent: 0,
            failed: 0
          }
        });
      }

      let sent = 0;
      let failed = 0;
      const failedRecipients = [];

      for (let i = 0; i < deduped.length; i += 1) {
        const subscriber = deduped[i];
        const greetName = subscriber.name || 'there';
        const textBody = message
          ? `Hi ${greetName},\n\n${message}\n`
          : `Hi ${greetName},\n\n${String(html).replace(/<[^>]+>/g, ' ')}\n`;
        const htmlBody = html
          ? `<p>Hi ${escapeHtml(greetName)},</p>${html}`
          : `<p>Hi ${escapeHtml(greetName)},</p><p>${escapeHtml(message).replace(/\n/g, '<br/>')}</p>`;

        try {
          await sendEmail({
            strapi,
            to: subscriber.email,
            subject,
            text: textBody,
            html: htmlBody
          });
          sent += 1;
        } catch (error) {
          failed += 1;
          failedRecipients.push({
            email: subscriber.email,
            error: error?.message || 'Unknown error'
          });
          strapi.log.error(`[emails] Newsletter send failed for ${subscriber.email}`, error);
        }
      }

      const previewFailures = failedRecipients.slice(0, 20);
      const adminRecipients = getAdminRecipients();
      if (adminRecipients.length > 0) {
        const adminSubject =
          failed === 0
            ? `Newsletter sent successfully: ${subject}`
            : `Newsletter finished with failures: ${subject}`;
        const failureList = failedRecipients.slice(0, ADMIN_FAIL_PREVIEW);
        const adminTextLines = [
          `Newsletter subject: ${subject}`,
          `Total recipients: ${deduped.length}`,
          `Sent: ${sent}`,
          `Failed: ${failed}`,
          ''
        ];
        if (failureList.length > 0) {
          adminTextLines.push('Failed recipients:');
          for (let i = 0; i < failureList.length; i += 1) {
            const item = failureList[i];
            adminTextLines.push(`- ${item.email}: ${item.error || 'Unknown error'}`);
          }
        } else {
          adminTextLines.push('No failed recipients.');
        }

        const adminHtml = `
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f2f6f4;font-family:Segoe UI,Tahoma,Arial,sans-serif;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="padding:20px 10px;">
      <tr>
        <td align="center">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:700px;background:#ffffff;border:1px solid #dce7e2;border-radius:14px;">
            <tr>
              <td style="padding:20px 24px;border-bottom:1px solid #e7eeea;">
                <h2 style="margin:0;color:#163f35;font-size:20px;">Newsletter Delivery Report</h2>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 24px;color:#2d3b36;font-size:14px;line-height:1.7;">
                <p style="margin:0 0 8px 0;"><strong>Subject:</strong> ${escapeHtml(subject)}</p>
                <p style="margin:0 0 8px 0;"><strong>Total:</strong> ${deduped.length}</p>
                <p style="margin:0 0 8px 0;"><strong>Sent:</strong> ${sent}</p>
                <p style="margin:0;"><strong>Failed:</strong> ${failed}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 24px 22px 24px;color:#2d3b36;font-size:13px;line-height:1.7;">
                ${
                  failureList.length > 0
                    ? `<p style="margin:0 0 8px 0;"><strong>Failed Recipients:</strong></p><ul style="margin:0;padding-left:18px;">${failureList
                        .map((item) => `<li>${escapeHtml(item.email)} - ${escapeHtml(item.error || 'Unknown error')}</li>`)
                        .join('')}</ul>`
                    : '<p style="margin:0;">No failed recipients.</p>'
                }
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

        for (let i = 0; i < adminRecipients.length; i += 1) {
          const adminEmail = adminRecipients[i];
          try {
            await sendEmail({
              strapi,
              to: adminEmail,
              subject: adminSubject,
              text: adminTextLines.join('\n'),
              html: adminHtml
            });
          } catch (error) {
            strapi.log.error(`[emails] Failed to send admin newsletter report to ${adminEmail}`, error);
          }
        }
      }

      return ctx.send({
        message: `Newsletter processed. Sent: ${sent}, Failed: ${failed}.`,
        data: {
          total: deduped.length,
          sent,
          failed,
          failedRecipients: previewFailures
        }
      });
    } catch (error) {
      strapi.log.error('[emails] Newsletter dispatch failed', error);
      return ctx.badRequest('Failed to send newsletter', { error: error.message });
    }
  }
}));
