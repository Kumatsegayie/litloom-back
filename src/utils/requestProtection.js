'use strict';

const DEFAULT_WINDOW_MS = 60 * 1000;
const DEFAULT_LIMIT = 20;
const MAX_BUCKETS = 5000;
const MAX_TEXT_LEN = 20000;

const buckets = new Map();

const SPAM_KEYWORDS = [
  'viagra',
  'casino',
  'crypto giveaway',
  'loan approval',
  'work from home',
  'seo service',
  'buy followers',
  'telegram.me',
  'whatsapp me'
];

function cleanText(value, maxLen = MAX_TEXT_LEN) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function getClientIp(ctx) {
  const forwarded = String(ctx?.request?.headers?.['x-forwarded-for'] || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  return (
    forwarded[0] ||
    ctx?.request?.ip ||
    ctx?.ip ||
    ctx?.request?.socket?.remoteAddress ||
    'unknown'
  );
}

function now() {
  return Date.now();
}

function pruneBuckets(ts) {
  if (buckets.size <= MAX_BUCKETS) return;

  const entries = [...buckets.entries()];
  entries.sort((a, b) => (a[1]?.expiresAt || 0) - (b[1]?.expiresAt || 0));

  const removeCount = Math.ceil(entries.length * 0.25);
  for (let i = 0; i < removeCount; i += 1) {
    buckets.delete(entries[i][0]);
  }

  // Extra pass for expired buckets.
  const keys = [...buckets.keys()];
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const bucket = buckets.get(key);
    if (!bucket || bucket.expiresAt <= ts) buckets.delete(key);
  }
}

function consumeRateLimit({ key, limit = DEFAULT_LIMIT, windowMs = DEFAULT_WINDOW_MS, ts = now() }) {
  if (!key) {
    return {
      allowed: true,
      remaining: limit,
      retryAfterMs: 0
    };
  }

  pruneBuckets(ts);

  const bucket = buckets.get(key);
  if (!bucket || bucket.expiresAt <= ts) {
    const fresh = {
      count: 1,
      expiresAt: ts + windowMs
    };
    buckets.set(key, fresh);
    return {
      allowed: true,
      remaining: Math.max(0, limit - 1),
      retryAfterMs: 0
    };
  }

  if (bucket.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(0, bucket.expiresAt - ts)
    };
  }

  bucket.count += 1;
  buckets.set(key, bucket);

  return {
    allowed: true,
    remaining: Math.max(0, limit - bucket.count),
    retryAfterMs: 0
  };
}

function hasHoneypot(body) {
  const source = body && typeof body === 'object' ? body : {};
  const candidates = [
    source.website,
    source.hpField,
    source.company,
    source.contactWebsite,
    source.url
  ];

  for (let i = 0; i < candidates.length; i += 1) {
    if (cleanText(candidates[i], 300)) return true;
  }

  return false;
}

function countUrls(text) {
  if (!text) return 0;
  const matches = String(text).match(/(https?:\/\/|www\.)/gi);
  return matches ? matches.length : 0;
}

function hasKeywordSpam(text) {
  const lower = String(text || '').toLowerCase();
  for (let i = 0; i < SPAM_KEYWORDS.length; i += 1) {
    if (lower.includes(SPAM_KEYWORDS[i])) return true;
  }
  return false;
}

function hasExcessiveRepeat(text) {
  return /(.)\1{8,}/.test(String(text || ''));
}

function isLikelySpam(payload = {}) {
  const name = cleanText(payload.name || payload.commenterName || payload.submitterName, 180);
  const email = cleanText(payload.email || payload.commenterEmail || payload.submitterEmail, 320);
  const message = cleanText(
    payload.message || payload.comment || payload.content || payload.description || '',
    MAX_TEXT_LEN
  );

  const joined = `${name} ${email} ${message}`.trim();
  if (!joined) return { spam: false, reason: '' };

  if (hasKeywordSpam(joined)) return { spam: true, reason: 'keyword-spam' };
  if (countUrls(joined) >= 4) return { spam: true, reason: 'too-many-links' };
  if (hasExcessiveRepeat(joined)) return { spam: true, reason: 'repeated-characters' };

  return { spam: false, reason: '' };
}

function getRouteLimitKey(ctx, routeName = 'default') {
  const ip = getClientIp(ctx);
  return `${routeName}:${ip}`;
}

module.exports = {
  cleanText,
  consumeRateLimit,
  getClientIp,
  getRouteLimitKey,
  hasHoneypot,
  isLikelySpam
};

