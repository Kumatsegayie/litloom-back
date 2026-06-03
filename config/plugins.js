module.exports = ({ env }) => ({
  email: {
    config: {
      settings: {
        defaultFrom: env("SMTP_FROM", '"Litloom" <litloom1@gmail.com>'),
        defaultReplyTo: env("SMTP_REPLY_TO", 'litloom1@gmail.com')
      }
    }
  }
});
