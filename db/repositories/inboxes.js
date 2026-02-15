import { query, withTransaction } from '../connection.js';
import { encrypt, decrypt } from '../../internal/crypto/encryption.js';
import { NotFoundError, ConflictError } from '../../pkg/errors.js';
import { INBOX_STATUS_ACTIVE, INBOX_STATUS_DELETED } from '../../pkg/constants.js';

/**
 * Create a new inbox with encrypted POP3 credentials.
 */
export async function createInbox({
  emailAddress,
  inboxType,
  pop3Host,
  pop3Port,
  pop3Tls,
  pop3Username,
  pop3Password,
  createdByIp,
}) {
  // Encrypt POP3 credentials before storage
  const pop3UsernameEnc = encrypt(pop3Username);
  const pop3PasswordEnc = encrypt(pop3Password);

  const result = await query(
    `INSERT INTO inboxes (
      email_address, inbox_type, status,
      pop3_host, pop3_port, pop3_tls,
      pop3_username_enc, pop3_password_enc,
      created_by_ip
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING id, email_address, inbox_type, status, pop3_host, pop3_port, pop3_tls,
              created_at, updated_at`,
    [
      emailAddress,
      inboxType,
      INBOX_STATUS_ACTIVE,
      pop3Host,
      pop3Port,
      pop3Tls,
      pop3UsernameEnc,
      pop3PasswordEnc,
      createdByIp,
    ]
  );

  return result.rows[0];
}

/**
 * Get an inbox by ID (active only). Does NOT return encrypted credentials.
 */
export async function getInboxById(id) {
  const result = await query(
    `SELECT id, email_address, inbox_type, status, pop3_host, pop3_port, pop3_tls,
            last_seen_uid, created_at, updated_at
     FROM inboxes
     WHERE id = $1 AND status = $2`,
    [id, INBOX_STATUS_ACTIVE]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('Inbox', id);
  }

  return result.rows[0];
}

/**
 * Get decrypted POP3 credentials for an inbox.
 * Only used internally for POP3 connections — never exposed via API.
 */
export async function getInboxCredentials(id) {
  const result = await query(
    `SELECT id, pop3_host, pop3_port, pop3_tls,
            pop3_username_enc, pop3_password_enc
     FROM inboxes
     WHERE id = $1 AND status = $2`,
    [id, INBOX_STATUS_ACTIVE]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('Inbox', id);
  }

  const row = result.rows[0];
  return {
    host: row.pop3_host,
    port: row.pop3_port,
    useTls: row.pop3_tls,
    username: decrypt(row.pop3_username_enc),
    password: decrypt(row.pop3_password_enc),
  };
}

/**
 * Update the last_seen_uid for incremental fetching.
 */
export async function updateLastSeenUid(id, lastSeenUid) {
  await query(
    `UPDATE inboxes SET last_seen_uid = $1 WHERE id = $2`,
    [lastSeenUid, id]
  );
}

/**
 * Soft-delete an inbox and cascade-wipe all related data.
 */
export async function deleteInbox(id) {
  return withTransaction(async (client) => {
    // Verify it exists
    const check = await client.query(
      `SELECT id FROM inboxes WHERE id = $1 AND status = $2`,
      [id, INBOX_STATUS_ACTIVE]
    );
    if (check.rows.length === 0) {
      throw new NotFoundError('Inbox', id);
    }

    // Delete attachments (references messages which references inbox)
    await client.query(
      `DELETE FROM attachments WHERE inbox_id = $1`,
      [id]
    );

    // Delete messages
    await client.query(
      `DELETE FROM messages WHERE inbox_id = $1`,
      [id]
    );

    // Revoke all tokens
    await client.query(
      `UPDATE tokens SET status = 'revoked', revoked_at = NOW()
       WHERE inbox_id = $1 AND status = 'active'`,
      [id]
    );

    // Soft-delete the inbox and wipe encrypted credentials
    await client.query(
      `UPDATE inboxes
       SET status = $1,
           deleted_at = NOW(),
           pop3_username_enc = '',
           pop3_password_enc = ''
       WHERE id = $2`,
      [INBOX_STATUS_DELETED, id]
    );

    return { id, deleted: true };
  });
}

/**
 * Count inboxes created by a specific IP (for rate limiting).
 */
export async function countInboxesByIp(ip) {
  const result = await query(
    `SELECT COUNT(*) as count FROM inboxes
     WHERE created_by_ip = $1 AND status = $2`,
    [ip, INBOX_STATUS_ACTIVE]
  );
  return parseInt(result.rows[0].count, 10);
}
