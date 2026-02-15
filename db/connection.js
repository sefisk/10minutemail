import pg from 'pg';
import config from '../config/index.js';
import logger from '../pkg/logger.js';

const { Pool } = pg;

let pool = null;

/**
 * Initialize and return the PostgreSQL connection pool.
 * Reuses the same pool across the application lifetime.
 */
export function getPool() {
  if (pool) return pool;

  pool = new Pool({
    host: config.db.host,
    port: config.db.port,
    database: config.db.database,
    user: config.db.user,
    password: config.db.password,
    max: config.db.maxConnections,
    idleTimeoutMillis: config.db.idleTimeout,
    connectionTimeoutMillis: config.db.connectionTimeout,
    ...(config.db.ssl && { ssl: { rejectUnauthorized: false } }),
  });

  pool.on('error', (err) => {
    logger.error({ err }, 'Unexpected PostgreSQL pool error');
  });

  pool.on('connect', () => {
    logger.debug('New PostgreSQL client connected');
  });

  return pool;
}

/**
 * Execute a single query using the pool.
 */
export async function query(text, params) {
  const start = Date.now();
  const result = await getPool().query(text, params);
  const duration = Date.now() - start;
  logger.debug({ query: text.slice(0, 80), duration, rows: result.rowCount }, 'Query executed');
  return result;
}

/**
 * Get a client from the pool for transactions.
 * Caller MUST call client.release() when done.
 */
export async function getClient() {
  const client = await getPool().connect();
  const originalQuery = client.query.bind(client);
  const originalRelease = client.release.bind(client);

  // Monkey-patch release to log warnings for unreleased clients
  const timeout = setTimeout(() => {
    logger.warn('Database client checked out for >5s without release');
  }, 5000);

  client.release = () => {
    clearTimeout(timeout);
    return originalRelease();
  };

  client.query = (...args) => {
    return originalQuery(...args);
  };

  return client;
}

/**
 * Execute a function within a database transaction.
 */
export async function withTransaction(fn) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Gracefully close the pool.
 */
export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('PostgreSQL pool closed');
  }
}
