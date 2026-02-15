import { query } from '../connection.js';

/**
 * Write an audit log entry. Fire-and-forget — errors are logged but not thrown.
 */
export async function writeAuditLog({ eventType, inboxId = null, actorIp = null, metadata = {} }) {
  try {
    await query(
      `INSERT INTO audit_logs (event_type, inbox_id, actor_ip, metadata)
       VALUES ($1, $2, $3, $4)`,
      [eventType, inboxId, actorIp, JSON.stringify(metadata)]
    );
  } catch (err) {
    // Audit log failures must not break the request flow.
    // Use console.error as a fallback since the logger might be the issue.
    console.error('Audit log write failed:', err.message);
  }
}

/**
 * Query audit logs for an inbox.
 */
export async function getAuditLogs(inboxId, { limit = 100, offset = 0 } = {}) {
  const result = await query(
    `SELECT id, event_type, inbox_id, actor_ip, metadata, created_at
     FROM audit_logs
     WHERE inbox_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [inboxId, limit, offset]
  );

  return result.rows;
}

/**
 * Query audit logs by event type (for security monitoring).
 */
export async function getAuditLogsByEvent(eventType, { limit = 100, offset = 0 } = {}) {
  const result = await query(
    `SELECT id, event_type, inbox_id, actor_ip, metadata, created_at
     FROM audit_logs
     WHERE event_type = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [eventType, limit, offset]
  );

  return result.rows;
}
