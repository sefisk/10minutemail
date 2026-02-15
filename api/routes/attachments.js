import { authenticate, authorizeInbox } from '../../internal/auth/middleware.js';
import { audit } from '../middleware/audit.js';
import { getAttachmentSchema } from '../validators/schemas.js';
import * as attachmentRepo from '../../db/repositories/attachments.js';
import * as messageRepo from '../../db/repositories/messages.js';
import { AUDIT_ATTACHMENT_DOWNLOADED } from '../../pkg/constants.js';

/**
 * Register attachment-related routes.
 */
export default async function attachmentRoutes(fastify) {
  // ==========================================================
  // GET /v1/inboxes/:id/messages/:uid/attachments/:attachmentId
  // ==========================================================
  fastify.get('/v1/inboxes/:id/messages/:uid/attachments/:attachmentId', {
    schema: getAttachmentSchema,
    preHandler: [authenticate, authorizeInbox],
  }, async (request, reply) => {
    const { id, uid, attachmentId } = request.params;

    // Verify the message belongs to this inbox
    await messageRepo.getMessageByUid(id, uid);

    // Get attachment with binary content
    const attachment = await attachmentRepo.getAttachment(id, attachmentId);

    await audit(AUDIT_ATTACHMENT_DOWNLOADED, request, {
      inbox_id: id,
      attachment_id: attachmentId,
      filename: attachment.filename,
    });

    // Stream as file download
    reply
      .header('Content-Type', attachment.content_type)
      .header('Content-Disposition', `attachment; filename="${encodeURIComponent(attachment.filename)}"`)
      .header('Content-Length', attachment.size_bytes)
      .header('X-Checksum-SHA256', attachment.checksum_sha256 || '')
      .header('Cache-Control', 'private, no-cache');

    return reply.send(attachment.content);
  });
}
