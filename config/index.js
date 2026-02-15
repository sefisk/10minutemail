import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Load .env file if present (not in production containers where env is injected)
try {
  const envPath = resolve(process.cwd(), '.env');
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
} catch {
  // .env file not found — fine in production
}

function required(key) {
  const val = process.env[key];
  if (val === undefined || val === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return val;
}

function optional(key, fallback) {
  return process.env[key] || fallback;
}

const config = Object.freeze({
  env: optional('NODE_ENV', 'development'),
  port: parseInt(optional('PORT', '3000'), 10),
  host: optional('HOST', '0.0.0.0'),

  // Database
  db: Object.freeze({
    host: optional('DB_HOST', 'localhost'),
    port: parseInt(optional('DB_PORT', '5432'), 10),
    database: optional('DB_NAME', 'tenminutemail'),
    user: optional('DB_USER', 'tmmail'),
    password: required('DB_PASSWORD'),
    maxConnections: parseInt(optional('DB_MAX_CONNECTIONS', '20'), 10),
    idleTimeout: parseInt(optional('DB_IDLE_TIMEOUT', '30000'), 10),
    connectionTimeout: parseInt(optional('DB_CONNECTION_TIMEOUT', '5000'), 10),
    ssl: optional('DB_SSL', 'false') === 'true',
  }),

  // Redis
  redis: Object.freeze({
    host: optional('REDIS_HOST', 'localhost'),
    port: parseInt(optional('REDIS_PORT', '6379'), 10),
    password: optional('REDIS_PASSWORD', ''),
    db: parseInt(optional('REDIS_DB', '0'), 10),
    keyPrefix: optional('REDIS_KEY_PREFIX', 'tmmail:'),
  }),

  // JWT
  jwt: Object.freeze({
    secret: required('JWT_SECRET'),
    expiresIn: optional('JWT_EXPIRES_IN', '600'), // 10 minutes in seconds
    issuer: optional('JWT_ISSUER', '10minutemail'),
    algorithm: 'HS256',
  }),

  // Encryption for stored POP3 credentials
  encryption: Object.freeze({
    key: required('ENCRYPTION_KEY'), // 32-byte hex string for AES-256
    algorithm: 'aes-256-gcm',
  }),

  // POP3 settings
  pop3: Object.freeze({
    defaultPort: parseInt(optional('POP3_DEFAULT_PORT', '995'), 10),
    connectionTimeout: parseInt(optional('POP3_CONN_TIMEOUT', '10000'), 10),
    commandTimeout: parseInt(optional('POP3_CMD_TIMEOUT', '15000'), 10),
    maxRetries: parseInt(optional('POP3_MAX_RETRIES', '3'), 10),
    retryDelayMs: parseInt(optional('POP3_RETRY_DELAY_MS', '1000'), 10),
    maxConcurrentConnections: parseInt(optional('POP3_MAX_CONCURRENT', '10'), 10),
    tlsEnabled: optional('POP3_TLS', 'true') === 'true',
  }),

  // Rate limiting
  rateLimit: Object.freeze({
    global: Object.freeze({
      max: parseInt(optional('RATE_LIMIT_GLOBAL_MAX', '100'), 10),
      timeWindow: optional('RATE_LIMIT_GLOBAL_WINDOW', '1 minute'),
    }),
    createInbox: Object.freeze({
      max: parseInt(optional('RATE_LIMIT_CREATE_MAX', '5'), 10),
      timeWindow: optional('RATE_LIMIT_CREATE_WINDOW', '1 minute'),
    }),
    fetchMessages: Object.freeze({
      max: parseInt(optional('RATE_LIMIT_FETCH_MAX', '30'), 10),
      timeWindow: optional('RATE_LIMIT_FETCH_WINDOW', '1 minute'),
    }),
  }),

  // System-generated inbox settings (Mode B)
  generatedInbox: Object.freeze({
    domain: optional('GENERATED_INBOX_DOMAIN', 'tmpmail.local'),
    pop3Host: optional('GENERATED_INBOX_POP3_HOST', 'localhost'),
    pop3Port: parseInt(optional('GENERATED_INBOX_POP3_PORT', '995'), 10),
    useTls: optional('GENERATED_INBOX_TLS', 'true') === 'true',
  }),

  // Logging
  log: Object.freeze({
    level: optional('LOG_LEVEL', 'info'),
    prettyPrint: optional('LOG_PRETTY', 'false') === 'true',
  }),

  // Token settings
  token: Object.freeze({
    defaultTtlSeconds: parseInt(optional('TOKEN_TTL_SECONDS', '600'), 10),
    maxTtlSeconds: parseInt(optional('TOKEN_MAX_TTL_SECONDS', '3600'), 10),
  }),

  // Inbox limits
  inbox: Object.freeze({
    maxPerIp: parseInt(optional('MAX_INBOXES_PER_IP', '10'), 10),
    maxMessageFetch: parseInt(optional('MAX_MESSAGE_FETCH', '50'), 10),
    maxAttachmentSizeMb: parseInt(optional('MAX_ATTACHMENT_SIZE_MB', '25'), 10),
  }),
});

export default config;
