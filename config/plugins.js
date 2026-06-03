module.exports = ({ env }) => ({
  email: {
    config: {
      settings: {
        defaultFrom: env("SMTP_FROM", '"Litloom" <no-reply@litloomapp.com>'),
        defaultReplyTo: env("SMTP_REPLY_TO", env("SMTP_FROM", "support@litloomapp.com"))
      }
    }
  }
});
