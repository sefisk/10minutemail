import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { getPool, closePool } from '../db/connection.js';
import logger from '../pkg/logger.js';

/**
 * Simple forward-only migration runner.
 * Reads SQL files from db/migrations/ in sorted order,
 * tracks applied migrations in a _migrations table,
 * and applies any that haven't been run yet.
 */

const MIGRATIONS_DIR = resolve(process.cwd(), 'db', 'migrations');

async function ensureMigrationsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(pool) {
  const result = await pool.query('SELECT filename FROM _migrations ORDER BY id');
  return new Set(result.rows.map((r) => r.filename));
}

async function applyMigration(pool, filename, sql) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [filename]);
    await client.query('COMMIT');
    logger.info({ filename }, 'Migration applied');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const pool = getPool();

  try {
    await ensureMigrationsTable(pool);
    const applied = await getAppliedMigrations(pool);

    // Read migration files in sorted order
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) {
        logger.info({ filename: file }, 'Migration already applied, skipping');
        continue;
      }

      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
      await applyMigration(pool, file, sql);
      count++;
    }

    if (count === 0) {
      logger.info('All migrations already applied');
    } else {
      logger.info({ count }, 'Migrations completed');
    }
  } catch (err) {
    logger.error({ err }, 'Migration failed');
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

main();
