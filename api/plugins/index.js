import fastifyHelmet from '@fastify/helmet';
import fastifyCors from '@fastify/cors';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifySensible from '@fastify/sensible';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import config from '../../config/index.js';
import securityPlugin from '../middleware/security.js';
import { rateLimitPresets } from '../middleware/rateLimit.js';
import { AppError } from '../../pkg/errors.js';
import logger from '../../pkg/logger.js';

/**
 * Register all Fastify plugins and global error handler.
 */
export async function registerPlugins(fastify) {
  // Sensible defaults (httpErrors, etc.)
  await fastify.register(fastifySensible);

  // Helmet for security headers
  await fastify.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameSrc: ["'self'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
  });

  // CORS
  await fastify.register(fastifyCors, {
    origin: config.env === 'production' ? false : true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-Admin-Key'],
    maxAge: 600,
    credentials: false,
  });

  // Global rate limiting
  await fastify.register(fastifyRateLimit, {
    ...rateLimitPresets.global,
    redis: null, // Use in-memory store; swap to Redis in production
    addHeadersOnExceeding: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
    },
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
  });

  // Swagger documentation
  await fastify.register(fastifySwagger, {
    openapi: {
      info: {
        title: '10MinuteMail API',
        description: 'Temporary email access API with POP3 retrieval',
        version: '1.0.0',
      },
      servers: [
        { url: `http://localhost:${config.port}`, description: 'Development' },
      ],
      components: {
        securitySchemes: {
          BearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
      security: [{ BearerAuth: [] }],
    },
  });

  await fastify.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      deepLinking: true,
    },
  });

  // Custom security middleware
  await fastify.register(securityPlugin);

  // Global error handler
  fastify.setErrorHandler((error, request, reply) => {
    // Handle our custom AppError types
    if (error instanceof AppError) {
      logger.warn({
        requestId: request.requestId,
        error: error.code,
        message: error.message,
        statusCode: error.statusCode,
      }, 'Application error');

      return reply.code(error.statusCode).send(error.toJSON());
    }

    // Handle Fastify validation errors
    if (error.validation) {
      logger.warn({
        requestId: request.requestId,
        validation: error.validation,
      }, 'Validation error');

      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: error.validation,
        },
      });
    }

    // Handle rate limit errors
    if (error.statusCode === 429) {
      return reply.code(429).send({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: error.message || 'Too many requests',
        },
      });
    }

    // Unexpected errors — don't leak internals
    logger.error({
      requestId: request.requestId,
      err: error,
    }, 'Unhandled error');

    return reply.code(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: config.env === 'production'
          ? 'An internal error occurred'
          : error.message,
      },
    });
  });

  // 404 handler
  fastify.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      error: {
        code: 'NOT_FOUND',
        message: `Route ${request.method} ${request.url} not found`,
      },
    });
  });
}
