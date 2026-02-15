import { getPool, closePool } from '../db/connection.js';
import logger from '../pkg/logger.js';

/**
 * Seed script for development: inserts sample data for testing.
 * NEVER run this in production.
 */

async function main() {
  const pool = getPool();

  try {
    logger.info('Seed script started');

    // This is intentionally minimal — the API endpoints are the proper way
    // to create inboxes. This script just verifies the database schema works.
    const result = await pool.query('SELECT COUNT(*) as count FROM inboxes');
    logger.info({ existingInboxes: result.rows[0].count }, 'Current inbox count');

    logger.info('Seed complete. Use the API to create inboxes.');
  } catch (err) {
    logger.error({ err }, 'Seed failed');
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

main();
