import config from '../../config/index.js';

/**
 * Rate limit configuration presets for different endpoint groups.
 * Used with @fastify/rate-limit per-route config.
 */
export const rateLimitPresets = {
  createInbox: {
    max: config.rateLimit.createInbox.max,
    timeWindow: config.rateLimit.createInbox.timeWindow,
    keyGenerator: (request) => request.ip,
    errorResponseBuilder: () => ({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many inbox creation requests. Please try again later.',
      },
    }),
  },

  fetchMessages: {
    max: config.rateLimit.fetchMessages.max,
    timeWindow: config.rateLimit.fetchMessages.timeWindow,
    keyGenerator: (request) => `${request.ip}:${request.params.id}`,
    errorResponseBuilder: () => ({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many message fetch requests. Please try again later.',
      },
    }),
  },

  global: {
    max: config.rateLimit.global.max,
    timeWindow: config.rateLimit.global.timeWindow,
    keyGenerator: (request) => request.ip,
    errorResponseBuilder: () => ({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please try again later.',
      },
    }),
  },
};
