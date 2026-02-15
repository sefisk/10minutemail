import { query } from '../connection.js';
import { hashToken } from '../../internal/crypto/encryption.js';
import { signToken, generateOpaqueToken } from '../../internal/auth/jwt.js';
import { NotFoundError } from '../../pkg/errors.js';
import { TOKEN_STATUS_ACTIVE, TOKEN_STATUS_REVOKED } from '../../pkg/constants.js';

/**
 * Create a new access token for an inbox.
 * Stores the token hash in DB; returns the raw JWT to the client.
 */
export async function createToken({ inboxId, issuedByIp, ttlSeconds }) {
  // Generate JWT
  const tokenId = generateOpaqueToken().slice(0, 16); // short unique ID
  const { token: rawJwt, expiresAt } = signToken(
    { inbox_id: inboxId, token_id: tokenId },
    ttlSeconds
  );

  // Store hash of JWT for server-side validation
  const tokenHash = hashToken(rawJwt);

  const result = await query(
    `INSERT INTO tokens (inbox_id, token_hash, status, expires_at, issued_by_ip)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, inbox_id, status, expires_at, created_at`,
    [inboxId, tokenHash, TOKEN_STATUS_ACTIVE, expiresAt, issuedByIp]
  );

  return {
    ...result.rows[0],
    token: rawJwt,
    expires_at: expiresAt,
  };
}

/**
 * Revoke all active tokens for an inbox.
 */
export async function revokeAllTokens(inboxId) {
  await query(
    `UPDATE tokens
     SET status = $1, revoked_at = NOW()
     WHERE inbox_id = $2 AND status = $3`,
    [TOKEN_STATUS_REVOKED, inboxId, TOKEN_STATUS_ACTIVE]
  );
}

/**
 * Rotate token: revoke all existing, issue a new one.
 */
export async function rotateToken({ inboxId, issuedByIp, ttlSeconds }) {
  await revokeAllTokens(inboxId);
  return createToken({ inboxId, issuedByIp, ttlSeconds });
}

/**
 * Find an active token by its hash.
 */
export async function findActiveTokenByHash(tokenHash) {
  const result = await query(
    `SELECT t.id, t.inbox_id, t.status, t.expires_at, i.status as inbox_status
     FROM tokens t
     JOIN inboxes i ON i.id = t.inbox_id
     WHERE t.token_hash = $1 AND t.status = $2`,
    [tokenHash, TOKEN_STATUS_ACTIVE]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
}

/**
 * Clean up expired tokens (background maintenance).
 */
export async function cleanExpiredTokens() {
  const result = await query(
    `UPDATE tokens
     SET status = 'expired'
     WHERE status = $1 AND expires_at < NOW()`,
    [TOKEN_STATUS_ACTIVE]
  );
  return result.rowCount;
}
