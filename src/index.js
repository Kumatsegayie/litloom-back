'use strict';

const { dispatchNewsletterCampaign } = require('./api/newsletter-campaign/services/newsletter-dispatch');
const { startBackupScheduler } = require('./utils/backup');

const READ_ONLY_ACTIONS = [
  'api::article.article.find',
  'api::article.article.findOne',
  'api::blog.blog.find',
  'api::blog.blog.findOne',
  'api::book.book.find',
  'api::book.book.findOne',
  'api::poem.poem.find',
  'api::poem.poem.findOne',
  'api::podcast.podcast.find',
  'api::podcast.podcast.findOne',
  'api::podcast.podcast.publicList',
  'api::podcast.podcast.full',
  'api::podcast.podcast.fullBySlug',
  'api::series.series.find',
  'api::series.series.findOne',
  'api::series.series.publicList',
  'api::paintings.painting.find',
  'api::paintings.painting.findOne',
  'api::photos.photo.find',
  'api::photos.photo.findOne',
  'api::tag.tag.find',
  'api::tag.tag.findOne',
  'api::tag.tag.publicList',
  'api::tag.tag.suggest',
  'api::category.category.find',
  'api::category.category.findOne'
];

const PUBLIC_EXTRA_ACTIONS = [
  'api::comment.comment.submit',
  'api::comment.comment.publicList',
  'api::contact-message.contact-message.submit',
  'api::email.email.subscribe',
  'api::submission.submission.submit'
];

const AUTHOR_ACTIONS = [
  ...READ_ONLY_ACTIONS,
  ...PUBLIC_EXTRA_ACTIONS
];

const EDITOR_ACTIONS = [
  ...AUTHOR_ACTIONS,
  'api::article.article.create',
  'api::article.article.update',
  'api::article.article.delete',
  'api::blog.blog.create',
  'api::blog.blog.update',
  'api::blog.blog.delete',
  'api::book.book.create',
  'api::book.book.update',
  'api::book.book.delete',
  'api::poem.poem.create',
  'api::poem.poem.update',
  'api::poem.poem.delete',
  'api::podcast.podcast.create',
  'api::podcast.podcast.update',
  'api::podcast.podcast.delete',
  'api::series.series.create',
  'api::series.series.update',
  'api::series.series.delete',
  'api::paintings.painting.create',
  'api::paintings.painting.update',
  'api::paintings.painting.delete',
  'api::photos.photo.create',
  'api::photos.photo.update',
  'api::photos.photo.delete',
  'api::tag.tag.create',
  'api::tag.tag.update',
  'api::tag.tag.delete',
  'api::category.category.create',
  'api::category.category.update',
  'api::category.category.delete'
];

function uniqueActions(actions) {
  return [...new Set((actions || []).map((item) => String(item || '').trim()).filter(Boolean))];
}

async function ensureRole(strapi, { type, name, description }) {
  const roleQuery = strapi.db.query('plugin::users-permissions.role');
  const existing = await roleQuery.findOne({ where: { type } });
  if (existing) {
    if (existing.name !== name || existing.description !== description) {
      await roleQuery.update({
        where: { id: existing.id },
        data: { name, description }
      });
      return { ...existing, name, description };
    }
    return existing;
  }

  return roleQuery.create({
    data: {
      type,
      name,
      description
    }
  });
}

async function enableRoleActions(strapi, roleId, actions) {
  const permissionQuery = strapi.db.query('plugin::users-permissions.permission');
  const list = uniqueActions(actions);

  for (let i = 0; i < list.length; i += 1) {
    const action = list[i];
    const existing = await permissionQuery.findOne({
      where: {
        role: roleId,
        action
      }
    });

    if (existing) {
      if (!existing.enabled) {
        await permissionQuery.update({
          where: { id: existing.id },
          data: { enabled: true }
        });
      }
      continue;
    }

    await permissionQuery.create({
      data: {
        role: roleId,
        action,
        enabled: true
      }
    });
  }
}

async function ensureRoleModel(strapi) {
  const publicRole = await ensureRole(strapi, {
    type: 'public',
    name: 'Public',
    description: 'Public users with unauthenticated access'
  });

  const authenticatedRole = await ensureRole(strapi, {
    type: 'authenticated',
    name: 'Authenticated',
    description: 'Default authenticated role'
  });

  const authorRole = await ensureRole(strapi, {
    type: 'author',
    name: 'Author',
    description: 'Content contributors with author permissions'
  });

  const editorRole = await ensureRole(strapi, {
    type: 'editor',
    name: 'Editor',
    description: 'Editorial users with broader content permissions'
  });

  await enableRoleActions(strapi, publicRole.id, [...READ_ONLY_ACTIONS, ...PUBLIC_EXTRA_ACTIONS]);
  await enableRoleActions(strapi, authenticatedRole.id, AUTHOR_ACTIONS);
  await enableRoleActions(strapi, authorRole.id, AUTHOR_ACTIONS);
  await enableRoleActions(strapi, editorRole.id, EDITOR_ACTIONS);
}

async function startNewsletterWorker(strapi) {
  const CAMPAIGN_UID = 'api::newsletter-campaign.newsletter-campaign';
  const pollMs = Math.max(5000, Number(process.env.NEWSLETTER_DISPATCH_POLL_MS || 15000));
  let sweepRunning = false;

  const runDispatchSweep = async () => {
    if (sweepRunning) return;
    sweepRunning = true;

    try {
      const rows = await strapi.db.query(CAMPAIGN_UID).findMany({
        where: { publishedAt: { $notNull: true } },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        limit: 200
      });

      const seen = new Set();
      const candidates = [];

      for (let i = 0; i < (rows || []).length; i += 1) {
        const row = rows[i];
        const key = row?.documentId || String(row?.id || '');
        if (!key || seen.has(key)) continue;
        seen.add(key);
        candidates.push(row);
      }

      for (let i = 0; i < candidates.length; i += 1) {
        const row = candidates[i];
        try {
          await dispatchNewsletterCampaign(strapi, { id: row.id, documentId: row.documentId });
        } catch (error) {
          strapi.log.error(
            `[newsletter] Dispatch worker failed for document=${row.documentId || '-'} id=${row.id || '-'}`,
            error
          );
        }
      }
    } catch (error) {
      strapi.log.error('[newsletter] Dispatch worker sweep error', error);
    } finally {
      sweepRunning = false;
    }
  };

  await runDispatchSweep();

  const timer = setInterval(() => {
    runDispatchSweep().catch((error) => {
      strapi.log.error('[newsletter] Dispatch worker interval error', error);
    });
  }, pollMs);

  if (typeof timer?.unref === 'function') timer.unref();
  strapi.log.info(`[newsletter] Dispatch worker started (poll every ${pollMs}ms)`);
}

module.exports = {
  register() {},

  async bootstrap({ strapi }) {
    try {
      await ensureRoleModel(strapi);
      strapi.log.info('[roles] Users & Permissions roles verified (Public, Authenticated, Author, Editor)');
    } catch (error) {
      strapi.log.error('[roles] Failed to verify role model', error);
    }

    try {
      await startNewsletterWorker(strapi);
    } catch (error) {
      strapi.log.error('[newsletter] Worker bootstrap error', error);
    }

    try {
      startBackupScheduler(strapi);
    } catch (error) {
      strapi.log.error('[backup] Scheduler bootstrap error', error);
    }
  }
};

