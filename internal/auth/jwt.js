import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import config from '../../config/index.js';
import { AuthenticationError } from '../../pkg/errors.js';

/**
 * Generate a cryptographically random opaque token.
 */
export function generateOpaqueToken() {
  return randomBytes(32).toString('hex');
}

/**
 * Sign a JWT for an inbox.
 * @param {object} payload - Must include inbox_id and token_id
 * @param {number} [ttlSeconds] - Override TTL
 * @returns {{ token: string, expiresAt: Date }}
 */
export function signToken(payload, ttlSeconds) {
  const ttl = ttlSeconds || parseInt(config.jwt.expiresIn, 10);
  const expiresAt = new Date(Date.now() + ttl * 1000);

  const token = jwt.sign(
    {
      sub: payload.inbox_id,
      tid: payload.token_id,
      iat: Math.floor(Date.now() / 1000),
    },
    config.jwt.secret,
    {
      algorithm: config.jwt.algorithm,
      expiresIn: ttl,
      issuer: config.jwt.issuer,
    }
  );

  return { token, expiresAt };
}

/**
 * Verify and decode a JWT.
 * @param {string} token
 * @returns {{ sub: string, tid: string, iat: number, exp: number }}
 */
export function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwt.secret, {
      algorithms: [config.jwt.algorithm],
      issuer: config.jwt.issuer,
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new AuthenticationError('Token has expired');
    }
    if (err.name === 'JsonWebTokenError') {
      throw new AuthenticationError('Invalid token');
    }
    throw new AuthenticationError('Token verification failed');
  }
}
