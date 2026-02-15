# 10MinuteMail — Temporary Email Access API

A production-ready API service that provides temporary email access credentials and on-demand POP3 retrieval. Clients receive a short-lived JWT token to read messages from an inbox without ever seeing the real mailbox password after initial registration.

## Features

- **Two inbox modes**: Bring-your-own POP3 mailbox (Mode A) or system-generated inbox (Mode B)
- **Admin bulk generation**: Generate hundreds of random inboxes across multiple domains with custom TTL
- **email:password export**: Export generated inboxes in text, JSON, or CSV format
- **Realistic email addresses**: Generated emails use natural-looking names (e.g., `sarah.mitchell42@domain.com`)
- **AES-256-GCM encryption**: All stored POP3 credentials are encrypted at rest
- **JWT token auth**: Short-lived tokens with rotation support
- **POP3 over TLS**: Server-side POP3 connections with connection pooling and retry logic
- **MIME parsing**: Full message parsing with text/HTML bodies and attachment extraction
- **Rate limiting**: Per-endpoint and global rate limits
- **Audit trail**: Every operation is logged to an immutable audit table
- **Docker-ready**: Full docker-compose setup with PostgreSQL and Redis

## Quick Start

### Prerequisites

- Node.js >= 20
- PostgreSQL >= 14
- Redis >= 7 (optional, for production rate limiting)

### Using Docker (recommended)

```bash
# 1. Copy environment config
cp .env.example .env
# Edit .env with your secrets (JWT_SECRET, ENCRYPTION_KEY, DB_PASSWORD, ADMIN_API_KEY)

# 2. Start all services
docker compose up -d

# 3. Run migrations
docker compose run --rm migrate

# 4. Server is running at http://localhost:3000
# Swagger docs at http://localhost:3000/docs
```

### Local Development

```bash
# 1. Install dependencies
npm install

# 2. Copy and configure environment
cp .env.example .env
# Edit .env — set DB_PASSWORD, JWT_SECRET, ENCRYPTION_KEY, ADMIN_API_KEY

# 3. Start PostgreSQL and Redis (or use Docker for just those)
docker compose up -d postgres redis

# 4. Run database migrations
npm run migrate

# 5. Start development server (auto-reload)
npm run dev
```

### Generate Secrets

```bash
# Generate ENCRYPTION_KEY (64 hex chars)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Generate JWT_SECRET
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

# Generate ADMIN_API_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Usage Examples

### Create a generated inbox

```bash
curl -X POST http://localhost:3000/v1/inboxes \
  -H "Content-Type: application/json" \
  -d '{"mode": "generated"}'
```

### Fetch messages

```bash
curl http://localhost:3000/v1/inboxes/{inbox_id}/messages \
  -H "Authorization: Bearer {access_token}"
```

### Rotate token

```bash
curl -X POST http://localhost:3000/v1/inboxes/{inbox_id}/token:rotate \
  -H "Authorization: Bearer {access_token}" \
  -H "Content-Type: application/json" \
  -d '{"token_ttl_seconds": 1800}'
```

### Admin: Add a domain

```bash
curl -X POST http://localhost:3000/v1/admin/domains \
  -H "X-Admin-Key: your-admin-key" \
  -H "Content-Type: application/json" \
  -d '{"domain": "tempbox.io", "pop3_host": "mail.tempbox.io", "pop3_port": 995}'
```

### Admin: Bulk generate 100 random emails (1-hour TTL)

```bash
curl -X POST http://localhost:3000/v1/admin/generate \
  -H "X-Admin-Key: your-admin-key" \
  -H "Content-Type: application/json" \
  -d '{"count": 100, "token_ttl_seconds": 3600}'
```

### Admin: Export as email:password

```bash
# Plain text (email:password per line)
curl http://localhost:3000/v1/admin/export \
  -H "X-Admin-Key: your-admin-key"

# JSON format
curl "http://localhost:3000/v1/admin/export?format=json" \
  -H "X-Admin-Key: your-admin-key"

# CSV format
curl "http://localhost:3000/v1/admin/export?format=csv" \
  -H "X-Admin-Key: your-admin-key" -o inboxes.csv
```

## Project Structure

```
├── cmd/                    # Application entry point
│   └── server.js           # Fastify server bootstrap
├── internal/               # Internal business logic
│   ├── auth/               # JWT signing, verification, admin auth
│   ├── crypto/             # AES-256-GCM encryption/decryption
│   ├── pop3/               # POP3 client and connection pool
│   ├── mail/               # MIME parser and worker queue
│   └── inbox/              # Inbox address generator (realistic names)
├── api/                    # HTTP API layer
│   ├── routes/             # Route handlers (inboxes, messages, attachments, admin)
│   ├── validators/         # JSON Schema request validation
│   ├── middleware/          # Security, audit, rate limiting
│   └── plugins/            # Fastify plugin registration
├── pkg/                    # Shared utilities
│   ├── logger.js           # Structured logging (pino)
│   ├── errors.js           # Error class hierarchy
│   └── constants.js        # Application constants
├── config/                 # Environment-based configuration
├── db/                     # Database layer
│   ├── connection.js       # PostgreSQL pool management
│   ├── migrations/         # SQL migration files
│   └── repositories/       # Data access objects
├── scripts/                # Migration runner, seed script
├── docker/                 # Docker init scripts
├── docs/                   # API documentation
├── Dockerfile              # Multi-stage production build
└── docker-compose.yml      # Full stack with PostgreSQL + Redis
```

## Architecture

```
Client → [Fastify API] → [Auth Middleware] → [Route Handler]
                                                   │
                              ┌────────────────────┤
                              ▼                    ▼
                      [PostgreSQL]          [POP3 Pool]
                      ├── inboxes           ├── TLS connections
                      ├── tokens            ├── Retry logic
                      ├── messages          ├── Provider throttling
                      ├── attachments       └── Concurrency control
                      ├── domains
                      ├── audit_logs
                      └── bulk_generations
```

### Request Flow

1. Client sends request with Bearer token
2. Auth middleware verifies JWT signature and checks token status in DB
3. Authorization middleware confirms token grants access to the requested inbox
4. Route handler executes business logic
5. For message fetches: worker queue connects to POP3 server, retrieves and parses new mail
6. Audit log records the operation
7. Response returned to client

### Security Model

- **Credential encryption**: POP3 usernames and passwords are encrypted with AES-256-GCM before database storage. The encryption key never touches the database.
- **Token hashing**: JWTs are stored as SHA-256 hashes in the tokens table. The raw JWT only exists in transit.
- **No credential exposure**: After inbox creation, POP3 passwords are never returned by any endpoint.
- **Admin isolation**: Admin endpoints use a separate API key mechanism, not JWT tokens.
- **SSRF protection**: External POP3 hosts are validated against private/loopback addresses in production.
- **Rate limiting**: Per-IP limits on inbox creation, per-inbox limits on message fetching, and global request limits.
- **Security headers**: Helmet-managed CSP, X-Frame-Options, X-Content-Type-Options, CORS restrictions.
- **Request logging**: Every request is logged with a unique request ID. Sensitive data (passwords, tokens) is redacted.
- **SQL injection protection**: All queries use parameterized statements via pg driver.

## Scaling Recommendations

### Vertical Scaling

- Increase `DB_MAX_CONNECTIONS` for more concurrent DB operations
- Increase `POP3_MAX_CONCURRENT` for more parallel POP3 fetches
- Add Redis for rate limiting to replace in-memory store

### Horizontal Scaling

- The API server is stateless — run multiple instances behind a load balancer
- Use Redis for shared rate limiting across instances
- Use PostgreSQL connection pooling (PgBouncer) between instances and the database
- Consider read replicas for message/attachment read queries
- Partition the `audit_logs` table by `created_at` for time-series performance
- For very high throughput, extract the POP3 worker into a separate service communicating via a message queue (Redis Streams, RabbitMQ, or SQS)

### Production Checklist

- [ ] Generate strong secrets for `JWT_SECRET`, `ENCRYPTION_KEY`, `ADMIN_API_KEY`
- [ ] Enable `DB_SSL=true`
- [ ] Set `NODE_ENV=production`
- [ ] Configure a reverse proxy (nginx/Caddy) with TLS termination
- [ ] Set up log aggregation (ship pino JSON logs to ELK/Datadog/etc.)
- [ ] Set up monitoring on `/health` and `/ready` endpoints
- [ ] Configure backup strategy for PostgreSQL
- [ ] Review and tighten rate limits for your expected traffic
- [ ] Set `CORS` origin to your specific frontend domain
- [ ] Deploy Redis for production rate limiting

## License

Private. All rights reserved.
