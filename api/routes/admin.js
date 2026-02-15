import { authenticateAdmin } from '../../internal/auth/admin.js';
import { audit } from '../middleware/audit.js';
import { generateBulkInboxAddresses } from '../../internal/inbox/generator.js';
import * as domainRepo from '../../db/repositories/domains.js';
import * as tokenRepo from '../../db/repositories/tokens.js';
import { query, withTransaction } from '../../db/connection.js';
import { encrypt, decrypt } from '../../internal/crypto/encryption.js';
import { ValidationError } from '../../pkg/errors.js';
import config from '../../config/index.js';
import { INBOX_TYPE_GENERATED, INBOX_STATUS_ACTIVE } from '../../pkg/constants.js';

/**
 * Admin routes — all require X-Admin-Key authentication.
 */
export default async function adminRoutes(fastify) {
  // Apply admin auth to all routes in this plugin
  fastify.addHook('preHandler', authenticateAdmin);

  // ==========================================================
  // DOMAIN MANAGEMENT
  // ==========================================================

  // POST /v1/admin/domains — Add a new domain
  fastify.post('/v1/admin/domains', {
    schema: {
      body: {
        type: 'object',
        required: ['domain', 'pop3_host'],
        additionalProperties: false,
        properties: {
          domain: { type: 'string', maxLength: 255 },
          pop3_host: { type: 'string', maxLength: 255 },
          pop3_port: { type: 'integer', minimum: 1, maximum: 65535, default: 995 },
          pop3_tls: { type: 'boolean', default: true },
        },
      },
    },
  }, async (request, reply) => {
    const { domain, pop3_host, pop3_port, pop3_tls } = request.body;

    const result = await domainRepo.createDomain({
      domain,
      pop3Host: pop3_host,
      pop3Port: pop3_port || 995,
      pop3Tls: pop3_tls !== false,
    });

    await audit('admin.domain.created', request, { domain_id: result.id, domain });

    reply.code(201);
    return result;
  });

  // GET /v1/admin/domains — List all domains
  fastify.get('/v1/admin/domains', async (request) => {
    const domains = await domainRepo.listDomains();
    return { domains, count: domains.length };
  });

  // PUT /v1/admin/domains/:id — Update a domain
  fastify.put('/v1/admin/domains/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          domain: { type: 'string', maxLength: 255 },
          pop3_host: { type: 'string', maxLength: 255 },
          pop3_port: { type: 'integer', minimum: 1, maximum: 65535 },
          pop3_tls: { type: 'boolean' },
          is_active: { type: 'boolean' },
        },
      },
    },
  }, async (request) => {
    const { id } = request.params;
    const updates = {};
    if (request.body.domain !== undefined) updates.domain = request.body.domain;
    if (request.body.pop3_host !== undefined) updates.pop3Host = request.body.pop3_host;
    if (request.body.pop3_port !== undefined) updates.pop3Port = request.body.pop3_port;
    if (request.body.pop3_tls !== undefined) updates.pop3Tls = request.body.pop3_tls;
    if (request.body.is_active !== undefined) updates.isActive = request.body.is_active;

    const result = await domainRepo.updateDomain(id, updates);
    await audit('admin.domain.updated', request, { domain_id: id });
    return result;
  });

  // DELETE /v1/admin/domains/:id — Delete a domain
  fastify.delete('/v1/admin/domains/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
    },
  }, async (request) => {
    const { id } = request.params;
    const result = await domainRepo.deleteDomain(id);
    await audit('admin.domain.deleted', request, { domain_id: id });
    return result;
  });

  // ==========================================================
  // BULK EMAIL GENERATION
  // ==========================================================

  // POST /v1/admin/generate — Generate multiple random email inboxes
  fastify.post('/v1/admin/generate', {
    schema: {
      body: {
        type: 'object',
        required: ['count'],
        additionalProperties: false,
        properties: {
          count: {
            type: 'integer',
            minimum: 1,
            maximum: 1000,
            description: 'Number of inboxes to generate',
          },
          domain_ids: {
            type: 'array',
            items: { type: 'string', format: 'uuid' },
            minItems: 0,
            maxItems: 50,
            description: 'Specific domain IDs to use. If empty, uses all active domains.',
          },
          token_ttl_seconds: {
            type: 'integer',
            minimum: 60,
            maximum: 604800,
            default: 600,
            description: 'Token TTL in seconds. Admin can set up to 7 days (604800s).',
          },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            batch_id: { type: 'string', format: 'uuid' },
            generated: { type: 'integer' },
            inboxes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  inbox_id: { type: 'string', format: 'uuid' },
                  email_address: { type: 'string' },
                  password: { type: 'string' },
                  access_token: { type: 'string' },
                  token_expires_at: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { count, domain_ids: domainIds, token_ttl_seconds: ttl } = request.body;
    const clientIp = request.ip;
    const effectiveTtl = ttl || config.token.defaultTtlSeconds;

    // Get domains to use
    const domains = await domainRepo.getDomainsForGeneration(domainIds || []);
    if (domains.length === 0) {
      throw new ValidationError(
        'No active domains available. Add domains first via POST /v1/admin/domains'
      );
    }

    // Generate email addresses with realistic names
    const generated = generateBulkInboxAddresses(count, domains);

    // Create all inboxes and tokens in a transaction
    const results = await withTransaction(async (client) => {
      // Record the bulk generation batch
      const batchResult = await client.query(
        `INSERT INTO bulk_generations (count, domain_ids, token_ttl_seconds, generated_by_ip)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [count, JSON.stringify(domainIds || []), effectiveTtl, clientIp]
      );
      const batchId = batchResult.rows[0].id;

      const inboxes = [];

      for (const gen of generated) {
        // Encrypt credentials
        const pop3UsernameEnc = encrypt(gen.username);
        const pop3PasswordEnc = encrypt(gen.password);

        // Create inbox
        const inboxResult = await client.query(
          `INSERT INTO inboxes (
            email_address, inbox_type, status,
            pop3_host, pop3_port, pop3_tls,
            pop3_username_enc, pop3_password_enc,
            created_by_ip, domain_id, token_ttl_seconds
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING id, email_address`,
          [
            gen.emailAddress,
            INBOX_TYPE_GENERATED,
            INBOX_STATUS_ACTIVE,
            gen.pop3Host,
            gen.pop3Port,
            gen.useTls,
            pop3UsernameEnc,
            pop3PasswordEnc,
            clientIp,
            gen.domainId,
            effectiveTtl,
          ]
        );

        const inbox = inboxResult.rows[0];

        // Create token for this inbox
        const tokenData = await tokenRepo.createToken({
          inboxId: inbox.id,
          issuedByIp: clientIp,
          ttlSeconds: effectiveTtl,
        });

        inboxes.push({
          inbox_id: inbox.id,
          email_address: inbox.email_address,
          password: gen.password, // Only returned at creation time
          access_token: tokenData.token,
          token_expires_at: tokenData.expires_at.toISOString(),
        });
      }

      return { batchId, inboxes };
    });

    await audit('admin.bulk.generated', request, {
      batch_id: results.batchId,
      count,
      domain_count: domains.length,
      ttl: effectiveTtl,
    });

    reply.code(201);
    return {
      batch_id: results.batchId,
      generated: results.inboxes.length,
      inboxes: results.inboxes,
    };
  });

  // ==========================================================
  // EXPORT — email:password format
  // ==========================================================

  // GET /v1/admin/export — Export all active generated inboxes as email:password
  fastify.get('/v1/admin/export', {
    schema: {
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          format: {
            type: 'string',
            enum: ['text', 'json', 'csv'],
            default: 'text',
          },
          domain_id: {
            type: 'string',
            format: 'uuid',
            description: 'Filter by domain ID',
          },
          status: {
            type: 'string',
            enum: ['active', 'all'],
            default: 'active',
          },
        },
      },
    },
  }, async (request, reply) => {
    const { format, domain_id: domainId, status } = request.query;

    // Build query for generated inboxes with encrypted credentials
    let sql = `
      SELECT i.id, i.email_address, i.pop3_username_enc, i.pop3_password_enc,
             i.status, i.created_at, i.domain_id
      FROM inboxes i
      WHERE i.inbox_type = $1`;
    const params = [INBOX_TYPE_GENERATED];
    let paramIdx = 2;

    if (status !== 'all') {
      sql += ` AND i.status = $${paramIdx++}`;
      params.push(INBOX_STATUS_ACTIVE);
    }

    if (domainId) {
      sql += ` AND i.domain_id = $${paramIdx++}`;
      params.push(domainId);
    }

    sql += ` ORDER BY i.created_at ASC`;

    const result = await query(sql, params);

    // Decrypt credentials for export
    const entries = result.rows.map((row) => {
      let password = '';
      try {
        password = row.pop3_password_enc ? decrypt(row.pop3_password_enc) : '';
      } catch {
        password = '<decryption-failed>';
      }
      return {
        email: row.email_address,
        password,
        inbox_id: row.id,
        status: row.status,
        created_at: row.created_at,
      };
    });

    await audit('admin.export', request, {
      format,
      count: entries.length,
      domain_id: domainId || null,
    });

    // Format output
    if (format === 'json') {
      return {
        count: entries.length,
        entries: entries.map((e) => ({
          email: e.email,
          password: e.password,
          inbox_id: e.inbox_id,
          status: e.status,
          created_at: e.created_at,
        })),
      };
    }

    if (format === 'csv') {
      const header = 'email,password,inbox_id,status,created_at';
      const rows = entries.map((e) =>
        `${e.email},${e.password},${e.inbox_id},${e.status},${e.created_at}`
      );
      const csv = [header, ...rows].join('\n');

      reply
        .header('Content-Type', 'text/csv')
        .header('Content-Disposition', 'attachment; filename="inboxes_export.csv"');
      return csv;
    }

    // Default: plain text email:password format
    const text = entries.map((e) => `${e.email}:${e.password}`).join('\n');

    reply
      .header('Content-Type', 'text/plain')
      .header('Content-Disposition', 'attachment; filename="inboxes_export.txt"');
    return text;
  });

  // ==========================================================
  // ADMIN STATS
  // ==========================================================

  // GET /v1/admin/stats — System statistics
  fastify.get('/v1/admin/stats', async () => {
    const [inboxStats, tokenStats, messageStats, domainStats] = await Promise.all([
      query(`SELECT
               COUNT(*) FILTER (WHERE status = 'active') AS active_inboxes,
               COUNT(*) FILTER (WHERE status = 'deleted') AS deleted_inboxes,
               COUNT(*) FILTER (WHERE inbox_type = 'external') AS external_inboxes,
               COUNT(*) FILTER (WHERE inbox_type = 'generated') AS generated_inboxes,
               COUNT(*) AS total_inboxes
             FROM inboxes`),
      query(`SELECT
               COUNT(*) FILTER (WHERE status = 'active' AND expires_at > NOW()) AS active_tokens,
               COUNT(*) FILTER (WHERE status = 'expired' OR expires_at <= NOW()) AS expired_tokens,
               COUNT(*) FILTER (WHERE status = 'revoked') AS revoked_tokens,
               COUNT(*) AS total_tokens
             FROM tokens`),
      query(`SELECT COUNT(*) AS total_messages FROM messages`),
      query(`SELECT COUNT(*) FILTER (WHERE is_active = true) AS active_domains,
                    COUNT(*) AS total_domains FROM domains`),
    ]);

    return {
      inboxes: inboxStats.rows[0],
      tokens: tokenStats.rows[0],
      messages: messageStats.rows[0],
      domains: domainStats.rows[0],
    };
  });
}
