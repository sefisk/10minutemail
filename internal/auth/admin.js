import { createHash, timingSafeEqual } from 'node:crypto';
import config from '../../config/index.js';
import { AuthenticationError } from '../../pkg/errors.js';

/**
 * Admin authentication middleware using a pre-shared API key.
 * The admin key is set via ADMIN_API_KEY environment variable.
 *
 * Usage: Pass the key via X-Admin-Key header.
 */
export async function authenticateAdmin(request, reply) {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) {
    throw new AuthenticationError('Admin API is not configured');
  }

  const providedKey = request.headers['x-admin-key'];
  if (!providedKey) {
    throw new AuthenticationError('Missing X-Admin-Key header');
  }

  // Timing-safe comparison to prevent timing attacks
  const expectedHash = createHash('sha256').update(adminKey).digest();
  const providedHash = createHash('sha256').update(providedKey).digest();

  if (!timingSafeEqual(expectedHash, providedHash)) {
    throw new AuthenticationError('Invalid admin API key');
  }

  request.isAdmin = true;
}
