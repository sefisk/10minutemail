import { resolve } from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import config from '../config/index.js';
import logger from '../pkg/logger.js';
import { registerPlugins } from '../api/plugins/index.js';
import inboxRoutes from '../api/routes/inboxes.js';
import messageRoutes from '../api/routes/messages.js';
import attachmentRoutes from '../api/routes/attachments.js';
import adminRoutes from '../api/routes/admin.js';
import { getPool, closePool } from '../db/connection.js';
import { cleanExpiredTokens } from '../db/repositories/tokens.js';
import { startSmtpServer, stopSmtpServer } from '../internal/smtp/server.js';

/**
 * Bootstrap and start the 10MinuteMail API server.
 */
async function main() {
  // Create Fastify instance
  const fastify = Fastify({
    logger: false, // We use our own pino logger
    trustProxy: true,
    requestIdHeader: 'x-request-id',
    bodyLimit: 1048576, // 1MB
    routerOptions: {
      caseSensitive: true,
      ignoreTrailingSlash: false,
    },
  });

  try {
    // Register plugins (helmet, cors, rate-limit, swagger, error handler)
    await registerPlugins(fastify);

    // Serve static UI files (CSS, JS, images)
    await fastify.register(fastifyStatic, {
      root: resolve(process.cwd(), 'public'),
      prefix: '/',
      decorateReply: true,
    });

    // Register API routes
    await fastify.register(inboxRoutes);
    await fastify.register(messageRoutes);
    await fastify.register(attachmentRoutes);
    await fastify.register(adminRoutes);

    // Root — serve the public UI
    fastify.get('/', async (request, reply) => {
      return reply.sendFile('index.html');
    });

    // Admin UI
    fastify.get('/admin', async (request, reply) => {
      return reply.sendFile('admin.html');
    });

    // API info endpoint (for programmatic consumers)
    fastify.get('/api', async () => {
      return {
        service: '10MinuteMail API',
        version: '1.0.0',
        docs: '/docs',
        health: '/health',
        endpoints: {
          create_inbox: 'POST /v1/inboxes',
          fetch_messages: 'GET /v1/inboxes/:id/messages',
          download_attachment: 'GET /v1/inboxes/:id/messages/:uid/attachments/:attachmentId',
          rotate_token: 'POST /v1/inboxes/:id/token/rotate',
          delete_inbox: 'DELETE /v1/inboxes/:id',
          admin_domains: 'GET /v1/admin/domains',
          admin_generate: 'POST /v1/admin/generate',
          admin_export: 'GET /v1/admin/export',
          admin_stats: 'GET /v1/admin/stats',
        },
      };
    });

    // Health check endpoint (no auth required)
    fastify.get('/health', {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              timestamp: { type: 'string' },
              uptime: { type: 'number' },
            },
          },
        },
      },
    }, async () => {
      // Quick DB connectivity check
      const pool = getPool();
      await pool.query('SELECT 1');
      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      };
    });

    // Ready check (for k8s readiness probes)
    fastify.get('/ready', async () => {
      const pool = getPool();
      await pool.query('SELECT 1');
      return { ready: true };
    });

    // 404 handler — set AFTER static plugin so static files are served first
    fastify.setNotFoundHandler((request, reply) => {
      reply.code(404).send({
        error: {
          code: 'NOT_FOUND',
          message: `Route ${request.method} ${request.url} not found`,
        },
      });
    });

    // Background: expired token cleanup every 5 minutes
    const tokenCleanupInterval = setInterval(async () => {
      try {
        const cleaned = await cleanExpiredTokens();
        if (cleaned > 0) {
          logger.info({ cleaned }, 'Expired tokens cleaned');
        }
      } catch (err) {
        logger.error({ err }, 'Token cleanup failed');
      }
    }, 5 * 60 * 1000);

    // Verify database connectivity before starting
    const pool = getPool();
    await pool.query('SELECT 1');
    logger.info('Database connection verified');

    // Start HTTP server
    await fastify.listen({ port: config.port, host: config.host });
    logger.info(
      { port: config.port, host: config.host, env: config.env },
      '10MinuteMail API server started'
    );

    // Start built-in SMTP server for local domains
    try {
      await startSmtpServer();
    } catch (err) {
      logger.error({ err }, 'Failed to start SMTP server (mail receiving disabled)');
    }

    // Graceful shutdown
    const shutdown = async (signal) => {
      logger.info({ signal }, 'Shutdown signal received');
      clearInterval(tokenCleanupInterval);

      try {
        await stopSmtpServer();
      } catch (err) {
        logger.error({ err }, 'Error closing SMTP server');
      }

      try {
        await fastify.close();
        logger.info('HTTP server closed');
      } catch (err) {
        logger.error({ err }, 'Error closing HTTP server');
      }

      try {
        await closePool();
      } catch (err) {
        logger.error({ err }, 'Error closing database pool');
      }

      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Handle unhandled rejections
    process.on('unhandledRejection', (err) => {
      logger.error({ err }, 'Unhandled rejection');
    });

  } catch (err) {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }
}

main();
