import { randomBytes } from 'node:crypto';
import config from '../../config/index.js';

const TOKEN_LENGTH = 15;
const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/**
 * Generate a cryptographically random 15-character alphanumeric token.
 * Uses a password-friendly charset (no ambiguous chars like 0/O, 1/l/I).
 */
export function generateOpaqueToken() {
  const bytes = randomBytes(TOKEN_LENGTH);
  let token = '';
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    token += CHARSET[bytes[i] % CHARSET.length];
  }
  return token;
}

/**
 * Create an opaque access token with an expiration date.
 * @param {object} payload - Must include inbox_id
 * @param {number} [ttlSeconds] - Override TTL
 * @returns {{ token: string, expiresAt: Date }}
 */
export function signToken(payload, ttlSeconds) {
  const ttl = ttlSeconds || parseInt(config.jwt.expiresIn, 10);
  const expiresAt = new Date(Date.now() + ttl * 1000);
  const token = generateOpaqueToken();
  return { token, expiresAt };
}
