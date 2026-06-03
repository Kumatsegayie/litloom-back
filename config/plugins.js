module.exports = ({ env }) => ({
  email: {
    config: {
      provider: 'strapi-provider-email-litloom-smtp',
      providerOptions: {},
      settings: {
        defaultFrom: env("EMAIL_DEFAULT_FROM", env("SMTP_FROM", '"Litloom" <litloom1@gmail.com>')),
        defaultReplyTo: env("EMAIL_DEFAULT_REPLY_TO", env("SMTP_REPLY_TO", env("ADMIN_EMAIL", 'litloom1@gmail.com')))
      }
    }
  }
});
