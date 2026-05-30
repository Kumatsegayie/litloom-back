'use strict';

const path = require('path');
const { sendEmailDirectSmtp } = require(path.resolve(process.cwd(), 'src/utils/email'));

module.exports = {
  init(providerOptions = {}, settings = {}) {
    return {
      async send(options = {}) {
        const to = options.to;
        const from = options.from || settings.defaultFrom || providerOptions.defaultFrom;
        const replyTo = options.replyTo || settings.defaultReplyTo || providerOptions.defaultReplyTo;
        const subject = options.subject || '';
        const text = options.text || '';
        const html = options.html;

        try {
          await sendEmailDirectSmtp({
            to,
            from,
            replyTo,
            subject,
            text,
            html
          });
        } catch (error) {
          console.error('[litloom-smtp-provider] send failed', {
            to,
            from,
            subject,
            message: error?.message || 'unknown error'
          });
          throw error;
        }
      }
    };
  }
};
