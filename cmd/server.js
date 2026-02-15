import Fastify from 'fastify';
import config from '../config/index.js';
import logger from '../pkg/logger.js';
import { registerPlugins } from '../api/plugins/index.js';
import inboxRoutes from '../api/routes/inboxes.js';
import messageRoutes from '../api/routes/messages.js';
import attachmentRoutes from '../api/routes/attachments.js';
import adminRoutes from '../api/routes/admin.js';
import { getPool, closePool } from '../db/connection.js';
import { cleanExpiredTokens } from '../db/repositories/tokens.js';

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
    caseSensitive: true,
    ignoreTrailingSlash: false,
  });

  try {
    // Register plugins (helmet, cors, rate-limit, swagger, error handler)
    await registerPlugins(fastify);

    // Register API routes
    await fastify.register(inboxRoutes);
    await fastify.register(messageRoutes);
    await fastify.register(attachmentRoutes);
    await fastify.register(adminRoutes);

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

    // Start server
    await fastify.listen({ port: config.port, host: config.host });
    logger.info(
      { port: config.port, host: config.host, env: config.env },
      '10MinuteMail API server started'
    );

    // Graceful shutdown
    const shutdown = async (signal) => {
      logger.info({ signal }, 'Shutdown signal received');
      clearInterval(tokenCleanupInterval);

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
