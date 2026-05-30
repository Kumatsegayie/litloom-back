const LOCAL_HOST_RE = /^(localhost|127\.0\.0\.1|::1)$/i;
const PRIVATE_HOST_RE = /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})$/;

function safeParseUrl(value) {
  try {
    return new URL(String(value || ''));
  } catch (error) {
    return null;
  }
}

function isLocalOrPrivateOrigin(origin) {
  const parsed = safeParseUrl(origin);
  if (!parsed || !parsed.hostname) return false;
  const host = String(parsed.hostname || '').trim();
  return LOCAL_HOST_RE.test(host) || PRIVATE_HOST_RE.test(host);
}

function normalizeOriginList(raw) {
  return String(raw || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function toWildcardRegex(pattern) {
  const escaped = String(pattern || '').replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*/g, '.*')}$`, 'i');
}

function parseCorsOrigins(raw, allowPrivateNetworkOrigins) {
  const value = String(raw || '').trim();
  if (!value) {
    return (ctx) => {
      const requestOrigin = String(ctx?.request?.header?.origin || '').trim();
      if (!requestOrigin) return false;
      if (isLocalOrPrivateOrigin(requestOrigin) && allowPrivateNetworkOrigins) {
        return requestOrigin;
      }
      return false;
    };
  }
  if (value === '*') return '*';

  const entries = normalizeOriginList(value);
  const wildcardEntries = entries.filter((item) => item.includes('*'));
  const exactEntries = entries.filter((item) => !item.includes('*'));
  const wildcardRegexList = wildcardEntries.map(toWildcardRegex);

  return (ctx) => {
    const requestOrigin = String(ctx?.request?.header?.origin || '').trim();
    if (!requestOrigin) return false;

    if (exactEntries.includes(requestOrigin)) return requestOrigin;
    if (wildcardRegexList.some((regex) => regex.test(requestOrigin))) return requestOrigin;

    if (allowPrivateNetworkOrigins && isLocalOrPrivateOrigin(requestOrigin)) {
      return requestOrigin;
    }

    return false;
  };
}

module.exports = ({ env }) => [
  'global::force-https',
  'strapi::logger',
  'strapi::errors',
  {
    name: 'strapi::security',
    config: {
      hsts: env.bool('HSTS_ENABLED', env('NODE_ENV', 'development') === 'production')
        ? {
            maxAge: env.int('HSTS_MAX_AGE', 31536000),
            includeSubDomains: env.bool('HSTS_INCLUDE_SUBDOMAINS', true),
            preload: env.bool('HSTS_PRELOAD', true)
          }
        : false,
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'connect-src': env.bool('CSP_ALLOW_HTTP', env('NODE_ENV', 'development') !== 'production')
            ? ["'self'", 'https:', 'http:']
            : ["'self'", 'https:'],
          'img-src': env.bool('CSP_ALLOW_HTTP', env('NODE_ENV', 'development') !== 'production')
            ? ["'self'", 'data:', 'blob:', 'https:', 'http:']
            : ["'self'", 'data:', 'blob:', 'https:'],
          'media-src': env.bool('CSP_ALLOW_HTTP', env('NODE_ENV', 'development') !== 'production')
            ? ["'self'", 'data:', 'blob:', 'https:', 'http:']
            : ["'self'", 'data:', 'blob:', 'https:']
        }
      }
    }
  },
  'global::request-protection',
  {
    name: 'strapi::cors',
    config: {
      origin: parseCorsOrigins(
        env('CORS_ORIGIN', ''),
        env.bool(
          'ALLOW_PRIVATE_NETWORK_ORIGINS',
          env('NODE_ENV', 'development') !== 'production'
        )
      ),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      headers: ['Content-Type', 'Authorization', 'Accept', 'Origin'],
      keepHeaderOnError: true
    }
  },
  'strapi::poweredBy',
  'strapi::query',
  {
    name: 'strapi::body',
    config: {
      jsonLimit: env('BODY_JSON_LIMIT', '2mb'),
      formLimit: env('BODY_FORM_LIMIT', '2mb'),
      textLimit: env('BODY_TEXT_LIMIT', '2mb')
    }
  },
  'strapi::session',
  'global::cache-control',
  'global::seo-routes',
  'strapi::favicon',
  'strapi::public'
];
