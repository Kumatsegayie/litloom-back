'use strict';

const { createStrapi } = require('@strapi/strapi');

async function main() {
  const to = process.argv[2] || process.env.ADMIN_EMAIL || 'litloom1@gmail.com';
  const app = createStrapi({ distDir: './dist' });

  try {
    await app.load();
    const cfg = app.config.get('plugin::email');
    console.log('[debug] plugin::email config provider =', cfg?.provider);
    console.log('[debug] defaultFrom =', cfg?.settings?.defaultFrom);

    await app.plugin('email').service('email').send({
      to,
      subject: `Service test to ${to}`,
      text: 'If you got this, strapi.plugin(email).service(send) works.'
    });

    console.log('STRAPI_EMAIL_SERVICE_OK');
  } finally {
    await app.destroy();
  }
}

main().catch((error) => {
  console.error('STRAPI_EMAIL_SERVICE_FAIL:', error.message);
  process.exitCode = 1;
});
