module.exports = ({ env }) => ({
  email: {
    config: {
      provider: 'strapi-provider-email-litloom-smtp',
      providerOptions: {},
      settings: {
        defaultFrom: env('EMAIL_DEFAULT_FROM', env('SMTP_FROM', 'litloom1@gmail.com')),
        defaultReplyTo: env('EMAIL_DEFAULT_REPLY_TO', env('SMTP_FROM', 'litloom1@gmail.com'))
      },
      ratelimit: {
        enabled: env.bool('EMAIL_RATE_LIMIT_ENABLED', true),
        interval: env.int('EMAIL_RATE_LIMIT_INTERVAL_MINUTES', 5),
        max: env.int('EMAIL_RATE_LIMIT_MAX', 10)
      }
    }
  },
  upload: {
    config: {
      sizeLimit: env.int('UPLOAD_MAX_BYTES', 20 * 1024 * 1024),
      breakpoints: {
        xlarge: 1920,
        large: 1280,
        medium: 750,
        small: 500,
        xsmall: 64
      }
    }
  },
  'users-permissions': {
    config: {
      jwt: {
        expiresIn: env('JWT_EXPIRES_IN', '7d')
      }
    }
  }
});
