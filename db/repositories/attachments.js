import { query } from '../connection.js';
import { NotFoundError } from '../../pkg/errors.js';

/**
 * Get attachment metadata and content by ID within an inbox scope.
 */
export async function getAttachment(inboxId, attachmentId) {
  const result = await query(
    `SELECT a.id, a.message_id, a.inbox_id, a.filename, a.content_type,
            a.size_bytes, a.content_id, a.checksum_sha256, a.content, a.created_at
     FROM attachments a
     WHERE a.id = $1 AND a.inbox_id = $2`,
    [attachmentId, inboxId]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('Attachment', attachmentId);
  }

  return result.rows[0];
}

/**
 * Get attachment metadata (without binary content) for a message.
 */
export async function getAttachmentsByMessageId(messageId) {
  const result = await query(
    `SELECT id, message_id, inbox_id, filename, content_type,
            size_bytes, content_id, checksum_sha256, created_at
     FROM attachments
     WHERE message_id = $1
     ORDER BY created_at ASC`,
    [messageId]
  );

  return result.rows;
}
