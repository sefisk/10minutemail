import { simpleParser } from 'mailparser';
import { createHash } from 'node:crypto';
import logger from '../../pkg/logger.js';
import config from '../../config/index.js';

/**
 * Parse a raw RFC 2822 email message into a structured object.
 * Extracts headers, text/html bodies, and attachment metadata + content.
 */
export async function parseMessage(rawMessage, uid) {
  try {
    const parsed = await simpleParser(rawMessage, {
      maxHtmlLengthToParse: 5 * 1024 * 1024, // 5MB HTML limit
    });

    const maxAttachmentBytes = config.inbox.maxAttachmentSizeMb * 1024 * 1024;

    // Process attachments
    const attachments = (parsed.attachments || [])
      .filter((att) => att.size <= maxAttachmentBytes)
      .map((att) => ({
        filename: att.filename || 'unnamed',
        contentType: att.contentType || 'application/octet-stream',
        sizeBytes: att.size,
        contentId: att.contentId || null,
        checksumSha256: createHash('sha256').update(att.content).digest('hex'),
        content: att.content, // Buffer
      }));

    const skippedAttachments = (parsed.attachments || []).filter(
      (att) => att.size > maxAttachmentBytes
    );
    if (skippedAttachments.length > 0) {
      logger.warn(
        { uid, skippedCount: skippedAttachments.length, maxMb: config.inbox.maxAttachmentSizeMb },
        'Skipped oversized attachments'
      );
    }

    // Extract sender
    const sender = parsed.from?.text || parsed.from?.value?.[0]?.address || '';

    // Extract recipients
    const recipients = [];
    if (parsed.to?.value) {
      for (const addr of parsed.to.value) {
        recipients.push({ address: addr.address, name: addr.name || '' });
      }
    }

    // Extract selected headers
    const headers = {};
    const interestingHeaders = [
      'message-id', 'date', 'from', 'to', 'cc', 'bcc',
      'reply-to', 'content-type', 'x-mailer', 'x-spam-status',
    ];
    for (const key of interestingHeaders) {
      const val = parsed.headers.get(key);
      if (val) {
        headers[key] = typeof val === 'object' && val.text ? val.text : String(val);
      }
    }

    return {
      uid,
      messageId: parsed.messageId || null,
      sender,
      recipients,
      subject: parsed.subject || '',
      textBody: parsed.text || '',
      htmlBody: parsed.html || '',
      headers,
      sizeBytes: Buffer.byteLength(rawMessage, 'utf8'),
      receivedAt: parsed.date || null,
      attachments,
    };
  } catch (err) {
    logger.error({ err, uid }, 'Failed to parse email message');
    throw err;
  }
}

/**
 * Parse multiple messages in parallel with a concurrency limit.
 */
export async function parseMessages(rawMessages, concurrency = 5) {
  const results = [];
  for (let i = 0; i < rawMessages.length; i += concurrency) {
    const batch = rawMessages.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(({ raw, uid }) => parseMessage(raw, uid))
    );
    results.push(...batchResults);
  }
  return results;
}
