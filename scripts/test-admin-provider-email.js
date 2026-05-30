'use strict';

const fs = require('fs');
const path = require('path');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const i = trimmed.indexOf('=');
    if (i < 0) continue;
    const key = trimmed.slice(0, i).trim();
    const val = trimmed.slice(i + 1).trim();
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;
    process.env[key] = val;
  }
}

async function main() {
  loadEnvFile(path.resolve(__dirname, '..', '.env'));

  const to = process.argv[2] || process.env.ADMIN_EMAIL || '';
  if (!to) throw new Error('Missing recipient email argument');

  const provider = require('../node_modules/strapi-provider-email-litloom-smtp');
  const settings = {
    defaultFrom: process.env.SMTP_FROM || process.env.SMTP_USER || 'litloom1@gmail.com',
    defaultReplyTo: process.env.SMTP_FROM || process.env.SMTP_USER || 'litloom1@gmail.com'
  };

  const instance = provider.init({}, settings);
  await instance.send({
    to,
    subject: `Strapi admin-provider test to: ${to}`,
    text: 'If you received this, the custom provider path works.'
  });

  console.log(`Admin-provider send OK to ${to}`);
}

main().catch((error) => {
  console.error(`Admin-provider send FAILED: ${error.message}`);
  process.exitCode = 1;
});
