'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { sendEmail } = require('../../../utils/email');
const { hasHoneypot, isLikelySpam } = require('../../../utils/requestProtection');

const CONTACT_UID = 'api::contact-message.contact-message';
const MAX_NAME_LEN = 120;
const MAX_EMAIL_LEN = 255;
const MAX_MESSAGE_LEN = 5000;

const cleanString = (value, maxLen = 255) => String(value || '').trim().slice(0, maxLen);
const normalizeName = (value) => cleanString(value, MAX_NAME_LEN);
const normalizeEmail = (value) => cleanString(value, MAX_EMAIL_LEN).toLowerCase();
const normalizeMessage = (value) => cleanString(value, MAX_MESSAGE_LEN);
const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const escapeHtml = (value) =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const splitEmailList = (value) =>
  String(value || '')
    .split(',')
    .map((item) => normalizeEmail(item))
    .filter((item) => isValidEmail(item));

const getAdminRecipients = () => {
  const result = [];
  const seen = new Set();
  const sources = [
    process.env.CONTACT_NOTIFY_EMAILS,
    process.env.ADMIN_EMAIL,
    process.env.NEWSLETTER_ADMIN_EMAILS,
    process.env.COMMENT_NOTIFY_EMAILS,
    process.env.SUBMISSION_NOTIFY_EMAILS,
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

function buildAdminHtml({ name, email, message, submittedAt }) {
  return `
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#eef3f1;font-family:Segoe UI,Tahoma,Arial,sans-serif;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="padding:20px 10px;">
      <tr>
        <td align="center">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:700px;background:#ffffff;border:1px solid #dce7e2;border-radius:14px;">
            <tr>
              <td style="padding:20px 24px;background:linear-gradient(130deg,#0f6a55,#1f8a70);">
                <h2 style="margin:0;color:#ffffff;font-size:22px;">New Contact Message</h2>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 24px;color:#2f3a36;font-size:14px;line-height:1.75;">
                <p style="margin:0 0 8px 0;"><strong>Name:</strong> ${escapeHtml(name)}</p>
                <p style="margin:0 0 8px 0;"><strong>Email:</strong> ${escapeHtml(email)}</p>
                <p style="margin:0 0 8px 0;"><strong>Submitted At:</strong> ${escapeHtml(submittedAt)}</p>
                <p style="margin:0;"><strong>Message:</strong></p>
                <p style="margin:8px 0 0 0;white-space:pre-wrap;">${escapeHtml(message)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildClientConfirmationHtml({ name }) {
  const safeName = escapeHtml(name || 'there');
  return `
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#eef3f1;font-family:Segoe UI,Tahoma,Arial,sans-serif;">
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="padding:20px 10px;">
      <tr>
        <td align="center">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:700px;background:#ffffff;border:1px solid #dce7e2;border-radius:14px;">
            <tr>
              <td style="padding:20px 24px;background:linear-gradient(130deg,#0f6a55,#1f8a70);">
                <h2 style="margin:0;color:#ffffff;font-size:22px;">Message Received</h2>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 24px;color:#2f3a36;font-size:14px;line-height:1.75;">
                <p style="margin:0 0 10px 0;">Hi ${safeName},</p>
                <p style="margin:0 0 10px 0;">Your message was sent successfully to Litloom.</p>
                <p style="margin:0;">We will review it and get back to you as soon as possible.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

module.exports = createCoreController(CONTACT_UID, ({ strapi }) => ({
  async submit(ctx) {
    try {
      const body = ctx.request.body?.data || ctx.request.body || {};

      if (hasHoneypot(body)) {
        return ctx.send({
          message: 'Message sent successfully.',
          data: {
            id: null
          }
        });
      }

      const name = normalizeName(body.name);
      const email = normalizeEmail(body.email);
      const message = normalizeMessage(body.message);

      if (!name || !email || !message) {
        return ctx.badRequest('Name, email and message are required');
      }

      if (!isValidEmail(email)) {
        return ctx.badRequest('Invalid email address');
      }

      const spamCheck = isLikelySpam({ name, email, message });
      if (spamCheck.spam) {
        return ctx.badRequest('Message was flagged as spam');
      }

      const submittedAt = new Date();
      const created = await strapi.entityService.create(CONTACT_UID, {
        data: {
          name,
          email,
          message,
          submittedAt
        }
      });

      const recipients = getAdminRecipients();
      let clientMailSent = false;

      try {
        const clientSubject = 'Litloom: Your message was sent successfully';
        const clientText = [
          `Hi ${name},`,
          '',
          'Your message was sent successfully to Litloom.',
          'We will review it and get back to you as soon as possible.'
        ].join('\n');
        const clientHtml = buildClientConfirmationHtml({ name });

        await sendEmail({
          strapi,
          to: email,
          subject: clientSubject,
          text: clientText,
          html: clientHtml
        });
        clientMailSent = true;
      } catch (error) {
        strapi.log.error(`[contact] Failed to send confirmation email to ${email}`, error);
      }

      if (recipients.length === 0) {
        strapi.log.warn('[contact] No admin recipients configured for contact notifications');
      } else {
        const subject = `New contact message from ${name}`;
        const timestamp = submittedAt.toISOString();
        const text = [
          'A new contact message has been submitted.',
          '',
          `Name: ${name}`,
          `Email: ${email}`,
          `Submitted At: ${timestamp}`,
          '',
          'Message:',
          message
        ].join('\n');
        const html = buildAdminHtml({ name, email, message, submittedAt: timestamp });

        for (let i = 0; i < recipients.length; i += 1) {
          const to = recipients[i];
          try {
            await sendEmail({
              strapi,
              to,
              subject,
              text,
              html
            });
          } catch (error) {
            strapi.log.error(`[contact] Failed to notify admin ${to}`, error);
          }
        }
      }

      return ctx.send({
        message: clientMailSent
          ? 'Message sent successfully. Confirmation email sent.'
          : 'Message saved, but confirmation email failed to send.',
        data: {
          id: created?.documentId || created?.id || null,
          name,
          email,
          submittedAt: submittedAt.toISOString()
        }
      });
    } catch (error) {
      strapi.log.error('[contact] Failed to submit contact message', error);
      return ctx.badRequest('Failed to send message', { error: error.message });
    }
  }
}));
