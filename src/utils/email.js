'use strict';

const net = require('net');
const tls = require('tls');

const CUSTOM_SMTP_PROVIDER = 'strapi-provider-email-litloom-smtp';

function normalizeRecipients(to) {
  if (!to) return [];
  if (Array.isArray(to)) return to.map((v) => String(v).trim()).filter(Boolean);
  return String(to)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function parseIntInRange(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const floored = Math.floor(parsed);
  if (floored < min) return min;
  if (floored > max) return max;
  return floored;
}

function cleanEnv(value) {
  return String(value || '').trim().replace(/^['"]|['"]$/g, '');
}

function buildSmtpConfig() {
  const host = cleanEnv(process.env.SMTP_HOST);
  const port = Number(process.env.SMTP_PORT || 0);
  const user = cleanEnv(process.env.SMTP_USER);
  const pass = cleanEnv(process.env.SMTP_PASS).replace(/\s+/g, '');

  if (!host || !port) {
    return {
      config: null,
      reason: 'Missing SMTP_HOST or SMTP_PORT'
    };
  }

  const secure = parseBool(process.env.SMTP_SECURE, port === 465);
  const isCommonAuthProvider = /gmail|outlook|hotmail|yahoo|icloud|zoho/i.test(host);
  if ((user && !pass) || (!user && pass) || (isCommonAuthProvider && (!user || !pass))) {
    return {
      config: null,
      reason: 'Missing SMTP_USER or SMTP_PASS for authenticated SMTP provider'
    };
  }

  return {
    config: {
      host,
      port,
      user,
      pass,
      secure,
      useAuth: Boolean(user && pass)
    },
    reason: ''
  };
}

function getFromAddress() {
  return (
    cleanEnv(process.env.EMAIL_DEFAULT_FROM) ||
    cleanEnv(process.env.SMTP_FROM) ||
    cleanEnv(process.env.SMTP_USER) ||
    'no-reply@litloom.local'
  );
}

function encodeBase64(value) {
  return Buffer.from(String(value), 'utf8').toString('base64');
}

function sanitizeHeader(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

function extractMailbox(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const angle = raw.match(/<([^>]+)>/);
  if (angle && angle[1]) return angle[1].trim();
  const plain = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return plain ? plain[0].trim() : raw;
}

function normalizeCrlf(value) {
  return String(value || '').replace(/\r?\n/g, '\r\n');
}

function dotStuff(value) {
  return normalizeCrlf(value)
    .split('\r\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
}

function createSmtpClient(config) {
  const socket = config.secure
    ? tls.connect({ port: config.port, host: config.host, servername: config.host })
    : net.createConnection({ port: config.port, host: config.host });

  socket.setEncoding('utf8');
  socket.setTimeout(30000);

  let buffer = '';
  const lineQueue = [];
  let pending = null;

  const flushPending = () => {
    if (!pending) return;
    while (lineQueue.length > 0 && pending) {
      const line = lineQueue.shift();
      pending.lines.push(line);
      if (/^\d{3}\s/.test(line)) {
        const resolver = pending;
        pending = null;
        resolver.resolve(resolver.lines);
      }
    }
  };

  const consumeLines = () => {
    let idx = buffer.indexOf('\n');
    while (idx !== -1) {
      const rawLine = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      const line = rawLine.replace(/\r$/, '');
      lineQueue.push(line);
      flushPending();

      idx = buffer.indexOf('\n');
    }
  };

  socket.on('data', (chunk) => {
    buffer += chunk;
    consumeLines();
  });

  socket.on('error', (err) => {
    if (pending) {
      const resolver = pending;
      pending = null;
      resolver.reject(err);
    }
  });

  socket.on('timeout', () => {
    if (pending) {
      const resolver = pending;
      pending = null;
      resolver.reject(new Error('SMTP timeout'));
    }
    try {
      socket.end();
    } catch (e) {
      // ignore
    }
  });

  socket.on('close', () => {
    if (pending) {
      const resolver = pending;
      pending = null;
      resolver.reject(new Error('SMTP connection closed unexpectedly'));
    }
  });

  function waitForReply(timeoutMs = 15000) {
    if (pending) return Promise.reject(new Error('SMTP read already pending'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pending) {
          pending = null;
          reject(new Error('SMTP timeout'));
        }
      }, timeoutMs);

      pending = {
        lines: [],
        resolve: (lines) => {
          clearTimeout(timer);
          resolve(lines);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        }
      };

      flushPending();
    });
  }

  function sendCommand(command) {
    socket.write(`${command}\r\n`);
  }

  function sendRaw(raw) {
    socket.write(raw);
  }

  function close() {
    try {
      socket.end();
    } catch (e) {
      // ignore
    }
  }

  return { socket, waitForReply, sendCommand, sendRaw, close };
}

function ensureCode(lines, expectedCodes, step) {
  if (!lines || lines.length === 0) {
    throw new Error(`SMTP ${step}: empty response`);
  }
  const last = lines[lines.length - 1] || '';
  const code = Number((last.slice(0, 3) || '').trim());
  if (!expectedCodes.includes(code)) {
    throw new Error(`SMTP ${step} failed: ${last}`);
  }
}

async function sendViaSmtp({ to, subject, text, html, replyTo, from }) {
  const recipients = normalizeRecipients(to);
  if (recipients.length === 0) throw new Error('No recipients for SMTP');

  const { config: smtp, reason } = buildSmtpConfig();
  if (!smtp) throw new Error(reason || 'SMTP not configured');

  const fromHeader = sanitizeHeader(from || getFromAddress());
  const fromMailbox = extractMailbox(fromHeader);
  if (!fromMailbox) throw new Error('SMTP_FROM is invalid');

  const client = createSmtpClient(smtp);

  const toMailbox = recipients.map(extractMailbox).filter(Boolean);
  if (toMailbox.length === 0) throw new Error('No valid recipient mailbox');

  const safeSubject = sanitizeHeader(subject || '');
  const safeReplyTo = sanitizeHeader(replyTo || process.env.EMAIL_DEFAULT_REPLY_TO || fromHeader);
  const toHeader = recipients.map(sanitizeHeader).join(', ');
  const bodyText = String(text || '');
  const bodyHtml = html ? String(html) : '';
  const messageBody = bodyHtml || bodyText || '';

  const headers = [
    `From: ${fromHeader}`,
    `To: ${toHeader}`,
    `Subject: ${safeSubject}`,
    `Reply-To: ${safeReplyTo}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    `Content-Type: ${bodyHtml ? 'text/html; charset=UTF-8' : 'text/plain; charset=UTF-8'}`,
    'Content-Transfer-Encoding: 8bit',
    '',
    messageBody
  ].join('\n');

  const dataPayload = `${dotStuff(headers)}\r\n.\r\n`;

  try {
    let lines = await client.waitForReply();
    ensureCode(lines, [220], 'connect');

    client.sendCommand('EHLO litloom.local');
    lines = await client.waitForReply();
    ensureCode(lines, [250], 'ehlo');

    if (smtp.useAuth) {
      client.sendCommand('AUTH LOGIN');
      lines = await client.waitForReply();
      ensureCode(lines, [334], 'auth-login');

      client.sendCommand(encodeBase64(smtp.user));
      lines = await client.waitForReply();
      ensureCode(lines, [334], 'auth-user');

      client.sendCommand(encodeBase64(smtp.pass));
      lines = await client.waitForReply();
      ensureCode(lines, [235], 'auth-pass');
    }

    client.sendCommand(`MAIL FROM:<${fromMailbox}>`);
    lines = await client.waitForReply();
    ensureCode(lines, [250], 'mail-from');

    for (const recipient of toMailbox) {
      client.sendCommand(`RCPT TO:<${recipient}>`);
      lines = await client.waitForReply();
      ensureCode(lines, [250, 251], 'rcpt-to');
    }

    client.sendCommand('DATA');
    lines = await client.waitForReply();
    ensureCode(lines, [354], 'data');

    client.sendRaw(dataPayload);
    lines = await client.waitForReply();
    ensureCode(lines, [250], 'body');

    client.sendCommand('QUIT');
    await client.waitForReply().catch(() => null);
    return { provider: 'smtp' };
  } finally {
    client.close();
  }
}

async function sendViaStrapiPlugin({ strapi, to, subject, text, html, replyTo, from }) {
  const recipients = normalizeRecipients(to);
  if (recipients.length === 0) throw new Error('No recipients for email plugin');
  if (!strapi?.plugin || !strapi.plugin('email')) throw new Error('Strapi email plugin is unavailable');

  await strapi.plugin('email').service('email').send({
    to: recipients.join(','),
    from: from || getFromAddress(),
    subject,
    text,
    html,
    replyTo: replyTo || process.env.EMAIL_DEFAULT_REPLY_TO || getFromAddress()
  });
  return { provider: 'strapi-email-plugin' };
}

function getRetryConfig() {
  const attempts = parseIntInRange(process.env.EMAIL_SEND_RETRIES, 3, 1, 5);
  const delayMs = parseIntInRange(process.env.EMAIL_SEND_RETRY_DELAY_MS, 900, 200, 15000);
  const jitterMs = parseIntInRange(process.env.EMAIL_SEND_RETRY_JITTER_MS, 200, 0, 5000);
  const timeoutMs = parseIntInRange(process.env.EMAIL_SEND_TIMEOUT_MS, 45000, 5000, 180000);
  return { attempts, delayMs, jitterMs, timeoutMs };
}

function withTimeout(promise, timeoutMs, label = 'email-send') {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    Promise.resolve(promise)
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function isRetryableError(error) {
  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '').toLowerCase();

  const hardFailHints = [
    'invalid email',
    'invalid recipient',
    'no valid recipient',
    'recipient address rejected',
    'mailbox unavailable',
    'user unknown',
    'bad address syntax',
    'authentication failed',
    'auth failed',
    'invalid login',
    'not authorized',
    '535',
    '550 5.1.1',
    '550 5.7.1'
  ];

  for (let i = 0; i < hardFailHints.length; i += 1) {
    if (message.includes(hardFailHints[i])) return false;
  }

  if (code === 'eauth' || code === 'einvalidrecipient') return false;

  return true;
}

function getProviderName(strapi) {
  try {
    const direct = cleanEnv(strapi?.config?.get?.('plugin::email.provider'));
    if (direct) return direct;

    const full = strapi?.config?.get?.('plugin::email');
    const nested = cleanEnv(full?.provider || full?.config?.provider);
    if (nested) return nested;
  } catch (error) {
    // ignore
  }

  return '';
}

async function withRetries({ attempts, delayMs, jitterMs, timeoutMs, label, strapi, sendFn }) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await withTimeout(sendFn(), timeoutMs, label);
      if (attempt > 1 && strapi?.log) {
        strapi.log.info(`[email] ${label} succeeded on retry ${attempt}/${attempts}`);
      }
      return result;
    } catch (error) {
      lastError = error;
      if (strapi?.log) {
        strapi.log.warn(`[email] ${label} attempt ${attempt}/${attempts} failed: ${error?.message || 'Unknown error'}`);
      }

      const retryable = isRetryableError(error);
      if (!retryable) {
        break;
      }

      if (attempt < attempts) {
        const jitter = jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0;
        await sleep((delayMs * attempt) + jitter);
      }
    }
  }

  throw lastError || new Error(`${label} failed`);
}

async function sendEmailDirectSmtp({ strapi, to, subject, text, html, replyTo, from }) {
  const smtpState = buildSmtpConfig();
  if (!smtpState.config) {
    throw new Error(smtpState.reason || 'SMTP not configured');
  }

  const retry = getRetryConfig();
  return withRetries({
    attempts: retry.attempts,
    delayMs: retry.delayMs,
    jitterMs: retry.jitterMs,
    timeoutMs: retry.timeoutMs,
    label: 'smtp',
    strapi,
    sendFn: () => sendViaSmtp({ to, subject, text, html, replyTo, from })
  });
}

function shouldUsePluginPath(strapi) {
  if (parseBool(process.env.EMAIL_FORCE_DIRECT_SMTP, false)) return false;
  if (!strapi?.plugin || !strapi.plugin('email')) return false;
  const providerName = getProviderName(strapi);
  if (providerName === CUSTOM_SMTP_PROVIDER) return false;
  return true;
}

async function sendEmail({ strapi, to, subject, text, html, replyTo, from }) {
  let pluginError = null;
  let smtpError = null;
  const retry = getRetryConfig();

  if (shouldUsePluginPath(strapi)) {
    try {
      return await withRetries({
        attempts: retry.attempts,
        delayMs: retry.delayMs,
        jitterMs: retry.jitterMs,
        timeoutMs: retry.timeoutMs,
        label: 'strapi-plugin',
        strapi,
        sendFn: () => sendViaStrapiPlugin({ strapi, to, subject, text, html, replyTo, from })
      });
    } catch (error) {
      pluginError = error;
      if (strapi?.log) strapi.log.error('[email] Strapi email plugin send failed', error);
    }
  }

  try {
    return await sendEmailDirectSmtp({ strapi, to, subject, text, html, replyTo, from });
  } catch (error) {
    smtpError = error;
    if (strapi?.log) strapi.log.error('[email] SMTP send failed', error);
  }

  const detailParts = [];
  if (pluginError) detailParts.push(`Plugin error: ${pluginError.message}`);
  if (smtpError) detailParts.push(`SMTP error: ${smtpError.message}`);
  throw new Error(`Email delivery failed. ${detailParts.join(' | ')}`);
}

module.exports = {
  sendEmail,
  sendEmailDirectSmtp
};
