import { hashToken } from '../crypto/encryption.js';
import { query } from '../../db/connection.js';
import { AuthenticationError, AuthorizationError } from '../../pkg/errors.js';
import { TOKEN_STATUS_ACTIVE } from '../../pkg/constants.js';

/**
 * Fastify preHandler hook that extracts and validates the Bearer token.
 * Sets request.inboxId and request.tokenId on success.
 */
export async function authenticate(request, reply) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AuthenticationError('Missing or malformed Authorization header');
  }

  const rawToken = authHeader.slice(7);
  if (!rawToken) {
    throw new AuthenticationError('Empty bearer token');
  }

  // Look up token by hash in the database
  const tokenHash = hashToken(rawToken);
  const result = await query(
    `SELECT t.id, t.inbox_id, t.status, t.expires_at, i.status AS inbox_status
     FROM tokens t
     JOIN inboxes i ON i.id = t.inbox_id
     WHERE t.token_hash = $1`,
    [tokenHash]
  );

  if (result.rows.length === 0) {
    throw new AuthenticationError('Token not found');
  }

  const tokenRow = result.rows[0];

  if (tokenRow.status !== TOKEN_STATUS_ACTIVE) {
    throw new AuthenticationError('Token has been revoked');
  }

  if (new Date(tokenRow.expires_at) < new Date()) {
    throw new AuthenticationError('Token has expired');
  }

  if (tokenRow.inbox_status !== 'active') {
    throw new AuthorizationError('Inbox is not active');
  }

  // Attach inbox context to request
  request.inboxId = tokenRow.inbox_id;
  request.tokenId = tokenRow.id;
}

/**
 * Verify that the authenticated user has access to the requested inbox.
 * Must be used after authenticate middleware.
 */
export async function authorizeInbox(request, reply) {
  const { id } = request.params;
  if (id && request.inboxId !== id) {
    throw new AuthorizationError('Token does not grant access to this inbox');
  }
}
