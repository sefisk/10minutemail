import { query, withTransaction } from '../connection.js';
import { NotFoundError } from '../../pkg/errors.js';

/**
 * Store parsed messages and their attachments in a transaction.
 */
export async function storeMessages(inboxId, parsedMessages) {
  if (parsedMessages.length === 0) return [];

  return withTransaction(async (client) => {
    const stored = [];

    for (const msg of parsedMessages) {
      // Insert message
      const msgResult = await client.query(
        `INSERT INTO messages (
          inbox_id, uid, message_id, sender, recipients, subject,
          text_body, html_body, headers, size_bytes, received_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (inbox_id, uid) DO NOTHING
        RETURNING id, uid, message_id, sender, recipients, subject,
                  text_body, html_body, headers, size_bytes, received_at, fetched_at`,
        [
          inboxId,
          msg.uid,
          msg.messageId,
          msg.sender,
          JSON.stringify(msg.recipients),
          msg.subject,
          msg.textBody,
          msg.htmlBody,
          JSON.stringify(msg.headers),
          msg.sizeBytes,
          msg.receivedAt,
        ]
      );

      if (msgResult.rows.length === 0) {
        // Already exists (duplicate UID), skip
        continue;
      }

      const storedMsg = msgResult.rows[0];

      // Insert attachments
      const attachmentMeta = [];
      for (const att of msg.attachments) {
        const attResult = await client.query(
          `INSERT INTO attachments (
            message_id, inbox_id, filename, content_type,
            size_bytes, content_id, checksum_sha256, content
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id, filename, content_type, size_bytes, content_id, checksum_sha256`,
          [
            storedMsg.id,
            inboxId,
            att.filename,
            att.contentType,
            att.sizeBytes,
            att.contentId,
            att.checksumSha256,
            att.content,
          ]
        );
        attachmentMeta.push(attResult.rows[0]);
      }

      stored.push({
        ...storedMsg,
        attachments: attachmentMeta,
      });
    }

    return stored;
  });
}

/**
 * Get messages for an inbox since a given UID with pagination.
 */
export async function getMessages(inboxId, { sinceUid, limit }) {
  let sql;
  let params;

  if (sinceUid) {
    // Get the fetched_at of the since_uid message to use as cursor
    const cursorResult = await query(
      `SELECT fetched_at FROM messages WHERE inbox_id = $1 AND uid = $2`,
      [inboxId, sinceUid]
    );

    if (cursorResult.rows.length > 0) {
      const cursorTime = cursorResult.rows[0].fetched_at;
      sql = `
        SELECT m.id, m.uid, m.message_id, m.sender, m.recipients, m.subject,
               m.text_body, m.html_body, m.headers, m.size_bytes,
               m.received_at, m.fetched_at,
               COALESCE(
                 json_agg(
                   json_build_object(
                     'id', a.id, 'filename', a.filename,
                     'content_type', a.content_type, 'size_bytes', a.size_bytes,
                     'content_id', a.content_id
                   )
                 ) FILTER (WHERE a.id IS NOT NULL),
                 '[]'
               ) AS attachments
        FROM messages m
        LEFT JOIN attachments a ON a.message_id = m.id
        WHERE m.inbox_id = $1 AND m.fetched_at > $2
        GROUP BY m.id
        ORDER BY m.fetched_at ASC
        LIMIT $3`;
      params = [inboxId, cursorTime, limit];
    } else {
      // since_uid not found — return all
      sql = `
        SELECT m.id, m.uid, m.message_id, m.sender, m.recipients, m.subject,
               m.text_body, m.html_body, m.headers, m.size_bytes,
               m.received_at, m.fetched_at,
               COALESCE(
                 json_agg(
                   json_build_object(
                     'id', a.id, 'filename', a.filename,
                     'content_type', a.content_type, 'size_bytes', a.size_bytes,
                     'content_id', a.content_id
                   )
                 ) FILTER (WHERE a.id IS NOT NULL),
                 '[]'
               ) AS attachments
        FROM messages m
        LEFT JOIN attachments a ON a.message_id = m.id
        WHERE m.inbox_id = $1
        GROUP BY m.id
        ORDER BY m.fetched_at ASC
        LIMIT $2`;
      params = [inboxId, limit];
    }
  } else {
    sql = `
      SELECT m.id, m.uid, m.message_id, m.sender, m.recipients, m.subject,
             m.text_body, m.html_body, m.headers, m.size_bytes,
             m.received_at, m.fetched_at,
             COALESCE(
               json_agg(
                 json_build_object(
                   'id', a.id, 'filename', a.filename,
                   'content_type', a.content_type, 'size_bytes', a.size_bytes,
                   'content_id', a.content_id
                 )
               ) FILTER (WHERE a.id IS NOT NULL),
               '[]'
             ) AS attachments
      FROM messages m
      LEFT JOIN attachments a ON a.message_id = m.id
      WHERE m.inbox_id = $1
      GROUP BY m.id
      ORDER BY m.fetched_at ASC
      LIMIT $2`;
    params = [inboxId, limit];
  }

  const result = await query(sql, params);
  return result.rows;
}

/**
 * Get a single message by inbox_id and uid.
 */
export async function getMessageByUid(inboxId, uid) {
  const result = await query(
    `SELECT m.id, m.uid, m.message_id, m.sender, m.recipients, m.subject,
            m.text_body, m.html_body, m.headers, m.size_bytes,
            m.received_at, m.fetched_at,
            COALESCE(
              json_agg(
                json_build_object(
                  'id', a.id, 'filename', a.filename,
                  'content_type', a.content_type, 'size_bytes', a.size_bytes,
                  'content_id', a.content_id
                )
              ) FILTER (WHERE a.id IS NOT NULL),
              '[]'
            ) AS attachments
     FROM messages m
     LEFT JOIN attachments a ON a.message_id = m.id
     WHERE m.inbox_id = $1 AND m.uid = $2
     GROUP BY m.id`,
    [inboxId, uid]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('Message', uid);
  }

  return result.rows[0];
}
