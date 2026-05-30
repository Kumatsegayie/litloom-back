'use strict';

const fs = require('fs');
const path = require('path');
const { sendEmail } = require('../src/utils/email');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;
    process.env[key] = value;
  }
}

async function main() {
  loadEnvFile(path.resolve(__dirname, '..', '.env'));

  const to = process.argv[2] || process.env.ADMIN_EMAIL || process.env.COMMENT_NOTIFY_EMAILS || '';
  if (!to) {
    throw new Error('Missing recipient. Pass an email argument or set ADMIN_EMAIL/COMMENT_NOTIFY_EMAILS in .env');
  }
  const smtpUser = String(process.env.SMTP_USER || '').trim();
  const smtpPass = String(process.env.SMTP_PASS || '').replace(/\s+/g, '').trim();
  console.log(`[debug] SMTP_HOST=${process.env.SMTP_HOST || ''}`);
  console.log(`[debug] SMTP_USER=${smtpUser || '(empty)'}`);
  console.log(`[debug] SMTP_PASS_LENGTH=${smtpPass.length}`);

  const strapiLike = {
    log: {
      info: (...args) => console.log('[info]', ...args),
      warn: (...args) => console.warn('[warn]', ...args),
      error: (...args) => console.error('[error]', ...args)
    },
    plugin: () => null
  };

  const result = await sendEmail({
    strapi: strapiLike,
    to,
    subject: 'Litloom comment email test',
    text: `Test email sent at ${new Date().toISOString()}`
  });

  console.log(`Email sent successfully via ${result?.provider || 'unknown'} to ${to}`);
}

main().catch((error) => {
  console.error(`Email test failed: ${error.message}`);
  process.exitCode = 1;
});
