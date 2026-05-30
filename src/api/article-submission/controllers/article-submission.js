'use strict';

/**
 * article-submission controller
 */

const { factories } = require('@strapi/strapi');
const { hasHoneypot, isLikelySpam } = require('../../../utils/requestProtection');

const { createCoreController } = factories;

module.exports = createCoreController('api::article-submission.article-submission', ({ strapi }) => ({
  // Custom submit method for users
  async submit(ctx) {
    try {
      const { title, content, excerpt, category, tags, submittedBy, submittedByEmail } = ctx.request.body;
      if (hasHoneypot(ctx.request.body || {})) {
        return ctx.send({
          message: 'Article submitted successfully. It will be reviewed by our team.'
        });
      }

      // Validate required fields
      if (!title || !content || !submittedBy || !submittedByEmail) {
        return ctx.badRequest('Missing required fields');
      }

      const spamCheck = isLikelySpam({
        submitterName: submittedBy,
        submitterEmail: submittedByEmail,
        content
      });
      if (spamCheck.spam) {
        return ctx.badRequest('Submission was flagged as spam');
      }

      // Handle file uploads
      let featuredImage = null;
      if (ctx.request.files && ctx.request.files.featuredImage) {
        const uploadService = strapi.service('plugin::upload.upload');
        const uploaded = await uploadService.upload({
          data: {},
          files: ctx.request.files.featuredImage
        });
        featuredImage = uploaded[0].id;
      }

      let additionalImages = [];
      if (ctx.request.files && ctx.request.files.additionalImages) {
        const uploadService = strapi.service('plugin::upload.upload');
        const uploaded = await uploadService.upload({
          data: {},
          files: ctx.request.files.additionalImages
        });
        additionalImages = uploaded.map(file => file.id);
      }

      // Handle category: find by name or create
      let categoryId = null;
      if (category) {
        const cats = await strapi.entityService.findMany('api::category.category', {
          filters: { name: category },
          limit: 1
        });
        let cat;
        if (cats.length === 0) {
          cat = await strapi.entityService.create('api::category.category', {
            data: { name: category, slug: category.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') }
          });
        } else {
          cat = cats[0];
        }
        categoryId = cat.id;
      }

      // Handle tags: find or create each
      let tagIds = [];
      if (tags && Array.isArray(tags)) {
        for (const tagName of tags) {
          // @ts-ignore
          const existingTags = await strapi.entityService.findMany('api::tag.tag', {
            filters: { name: tagName },
            limit: 1
          });
          let tag;
          if (existingTags.length === 0) {
            // @ts-ignore
            tag = await strapi.entityService.create('api::tag.tag', {
              data: { name: tagName, slug: tagName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') }
            });
          } else {
            tag = existingTags[0];
          }
          tagIds.push(tag.id);
        }
      }

      // Create the submission
      const submission = await strapi.entityService.create('api::article-submission.article-submission', {
        data: {
          title,
          content,
          excerpt,
          featuredImage,
          additionalImages,
          category: categoryId,
          // @ts-ignore
          tags: tagIds,
          submittedBy,
          submittedByEmail,
          status: 'pending',
          submittedAt: new Date(),
        },
        populate: ['category', 'tags', 'featuredImage', 'additionalImages']
      });

      // Send notification to admin(s) if email plugin is available
      try {
        const adminEmails = process.env.SUBMISSION_NOTIFY_EMAILS || null; // comma separated
        const to = adminEmails ? adminEmails.split(',').map(e => e.trim()) : null;
        const subject = `New article submission: ${submission.title}`;
        const text = `A new article has been submitted by ${submission.submittedBy} (${submission.submittedByEmail}).\n\nTitle: ${submission.title}\nExcerpt: ${submission.excerpt || ''}\n\nReview it in the Strapi admin.`;

        if (strapi.plugin && strapi.plugin('email')) {
          await strapi.plugin('email').service('email').send({
            to: to || process.env.ADMIN_EMAIL || 'admin@example.com',
            subject,
            text
          });
        } else if (to) {
          // best-effort: log for external systems
          strapi.log.info(`Notify emails: ${to.join(', ')} -- ${subject}`);
        }
      } catch (e) {
        strapi.log.error('Failed to send submission notification', e);
      }

      ctx.send({
        message: 'Article submitted successfully. It will be reviewed by our team.',
        submission: submission
      });

    } catch (error) {
      ctx.badRequest('Failed to submit article', { error: error.message });
    }
  },

  // Custom approve method for admins
  async approve(ctx) {
    try {
      const { id } = ctx.params;
      const { reviewNotes } = ctx.request.body;

      // Check if user is admin
      if (!ctx.state.user || ctx.state.user.role.type !== 'admin') {
        return ctx.forbidden('Only admins can approve submissions');
      }

      // Get the submission
      const submission = await strapi.entityService.findOne('api::article-submission.article-submission', id, {
        populate: ['category', 'tags', 'featuredImage', 'additionalImages']
      });

      if (!submission) {
        return ctx.notFound('Submission not found');
      }

      if (submission.status !== 'pending') {
        return ctx.badRequest('Submission has already been processed');
      }

      // Create the published article
      // @ts-ignore
      const article = await strapi.entityService.create('api::article.article', {
        data: {
          title: submission.title,
          content: submission.content,
          author: submission.submittedBy,
          type: 'post',
          slug: submission.title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
          // @ts-ignore
          thumbnail: submission.featuredImage?.id || null,
          // @ts-ignore
          images: submission.additionalImages?.map(img => img.id) || [],
          // @ts-ignore
          category: submission.category?.id || null,
          // @ts-ignore
          tags: submission.tags?.map(tag => tag.id) || [],
          publishDate: new Date(),
          publishedAt: new Date(), // Publish the article
          submission: id
        },
        populate: ['thumbnail', 'images', 'category', 'tags', 'submission']
      });

      // Update submission status
      await strapi.entityService.update('api::article-submission.article-submission', id, {
        data: {
          status: 'approved',
          reviewNotes,
          reviewedAt: new Date(),
          reviewedBy: ctx.state.user.username || ctx.state.user.email,
          publishedArticle: article.documentId
        }
      });

      // Notify submitter about approval
      try {
        const submitterEmail = submission.submittedByEmail;
        const subject = `Your submission "${submission.title}" has been approved`;
        const text = `Hello ${submission.submittedBy},\n\nYour submission titled "${submission.title}" has been approved and published.\n\nThank you for contributing!`;
        if (submitterEmail && strapi.plugin && strapi.plugin('email')) {
          await strapi.plugin('email').service('email').send({
            to: submitterEmail,
            subject,
            text
          });
        } else if (submitterEmail) {
          strapi.log.info(`Would notify submitter ${submitterEmail}: ${subject}`);
        }
      } catch (e) {
        strapi.log.error('Failed to notify submitter of approval', e);
      }
      // TODO: Send notification to submitter

      ctx.send({
        message: 'Article approved and published successfully',
        article: article,
        submission: { ...submission, status: 'approved', reviewNotes, reviewedAt: new Date() }
      });

    } catch (error) {
      ctx.badRequest('Failed to approve submission', { error: error.message });
    }
  },

  // Custom reject method for admins
  async reject(ctx) {
    try {
      const { id } = ctx.params;
      const { reviewNotes } = ctx.request.body;

      // Check if user is admin
      if (!ctx.state.user || ctx.state.user.role.type !== 'admin') {
        return ctx.forbidden('Only admins can reject submissions');
      }

      // Get the submission
      const submission = await strapi.entityService.findOne('api::article-submission.article-submission', id);

      if (!submission) {
        return ctx.notFound('Submission not found');
      }

      if (submission.status !== 'pending') {
        return ctx.badRequest('Submission has already been processed');
      }

      // Update submission status
      const updatedSubmission = await strapi.entityService.update('api::article-submission.article-submission', id, {
        data: {
          status: 'rejected',
          reviewNotes,
          reviewedAt: new Date(),
          reviewedBy: ctx.state.user.username || ctx.state.user.email
        }
      });

      // Notify submitter about rejection
      try {
        const submitterEmail = updatedSubmission.submittedByEmail || submission.submittedByEmail;
        const subject = `Your submission "${updatedSubmission.title || submission.title}" has been rejected`;
        const text = `Hello ${updatedSubmission.submittedBy || submission.submittedBy},\n\nWe're sorry to inform you that your submission titled "${updatedSubmission.title || submission.title}" was not approved.\n\nReview notes: ${reviewNotes || 'None'}`;
        if (submitterEmail && strapi.plugin && strapi.plugin('email')) {
          await strapi.plugin('email').service('email').send({
            to: submitterEmail,
            subject,
            text
          });
        } else if (submitterEmail) {
          strapi.log.info(`Would notify submitter ${submitterEmail}: ${subject}`);
        }
      } catch (e) {
        strapi.log.error('Failed to notify submitter of rejection', e);
      }
      // TODO: Send notification to submitter

      ctx.send({
        message: 'Article submission rejected',
        submission: updatedSubmission
      });

    } catch (error) {
      ctx.badRequest('Failed to reject submission', { error: error.message });
    }
  },

  // Get pending submissions (admin only)
  async pending(ctx) {
    try {
      // Check if user is admin
      if (!ctx.state.user || ctx.state.user.role.type !== 'admin') {
        return ctx.forbidden('Only admins can view pending submissions');
      }

      const submissions = await strapi.entityService.findMany('api::article-submission.article-submission', {
        filters: {
          status: 'pending'
        },
        populate: ['category', 'tags', 'featuredImage'],
        sort: { submittedAt: 'desc' }
      });

      ctx.send({
        submissions,
        count: submissions.length
      });

    } catch (error) {
      ctx.badRequest('Failed to fetch pending submissions', { error: error.message });
    }
  }
}));
