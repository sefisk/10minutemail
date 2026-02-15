import { randomBytes } from 'node:crypto';
import logger from '../../pkg/logger.js';
import { HEADER_REQUEST_ID } from '../../pkg/constants.js';

/**
 * Fastify plugin that adds security headers and request tracking.
 */
export default async function securityPlugin(fastify) {
  // Assign a unique request ID to every request
  fastify.addHook('onRequest', async (request, reply) => {
    request.requestId = request.headers[HEADER_REQUEST_ID] || randomBytes(8).toString('hex');
    reply.header(HEADER_REQUEST_ID, request.requestId);
  });

  // Security headers (supplements @fastify/helmet)
  fastify.addHook('onSend', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-XSS-Protection', '0'); // Modern CSP is preferred over this legacy header
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate');
    reply.header('Pragma', 'no-cache');

    // Remove server identification
    reply.removeHeader('X-Powered-By');
  });

  // Request logging
  fastify.addHook('onResponse', async (request, reply) => {
    logger.info({
      requestId: request.requestId,
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      responseTime: reply.elapsedTime,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    }, 'Request completed');
  });

  // Limit request body size (1MB default)
  fastify.addHook('onRequest', async (request) => {
    const contentLength = parseInt(request.headers['content-length'] || '0', 10);
    if (contentLength > 1048576) {
      const err = new Error('Request body too large');
      err.statusCode = 413;
      throw err;
    }
  });
}
