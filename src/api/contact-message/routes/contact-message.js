'use strict';

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/contact-messages/submit',
      handler: 'contact-message.submit',
      config: {
        auth: false
      }
    }
  ]
};
