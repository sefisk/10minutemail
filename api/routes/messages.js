import { authenticate, authorizeInbox } from '../../internal/auth/middleware.js';
import { audit } from '../middleware/audit.js';
import { rateLimitPresets } from '../middleware/rateLimit.js';
import { getMessagesSchema } from '../validators/schemas.js';
import * as messageRepo from '../../db/repositories/messages.js';
import * as inboxRepo from '../../db/repositories/inboxes.js';
import { enqueueFetch } from '../../internal/mail/worker.js';
import { AUDIT_MESSAGES_FETCHED } from '../../pkg/constants.js';
import config from '../../config/index.js';
import logger from '../../pkg/logger.js';

/**
 * Register message-related routes.
 */
export default async function messageRoutes(fastify) {
  // ==========================================================
  // GET /v1/inboxes/:id/messages — Fetch messages
  // ==========================================================
  fastify.get('/v1/inboxes/:id/messages', {
    schema: getMessagesSchema,
    preHandler: [authenticate, authorizeInbox],
    config: { rateLimit: rateLimitPresets.fetchMessages },
  }, async (request, reply) => {
    const { id } = request.params;
    const { since_uid: sinceUid, limit, fetch_new: fetchNew } = request.query;
    const effectiveLimit = Math.min(limit || 20, config.inbox.maxMessageFetch);

    // Optionally fetch new mail from POP3 before returning cached results
    if (fetchNew !== false) {
      try {
        const inbox = await inboxRepo.getInboxById(id);
        const effectiveSinceUid = sinceUid || inbox.last_seen_uid || undefined;

        await enqueueFetch({
          inboxId: id,
          sinceUid: effectiveSinceUid,
          limit: effectiveLimit,
        });
      } catch (err) {
        // POP3 fetch failure should not block returning cached messages.
        // Log and continue.
        logger.warn({ err, inboxId: id }, 'POP3 fetch failed, returning cached messages');
      }
    }

    // Return messages from database
    const messages = await messageRepo.getMessages(id, {
      sinceUid,
      limit: effectiveLimit,
    });

    await audit(AUDIT_MESSAGES_FETCHED, request, {
      inbox_id: id,
      message_count: messages.length,
      since_uid: sinceUid || null,
    });

    return {
      inbox_id: id,
      messages,
      count: messages.length,
    };
  });
}
