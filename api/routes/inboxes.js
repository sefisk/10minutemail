import { authenticate, authorizeInbox } from '../../internal/auth/middleware.js';
import { audit } from '../middleware/audit.js';
import { rateLimitPresets } from '../middleware/rateLimit.js';
import { createInboxSchema, deleteInboxSchema, rotateTokenSchema } from '../validators/schemas.js';
import { generateInboxAddress, validateExternalPop3 } from '../../internal/inbox/generator.js';
import * as inboxRepo from '../../db/repositories/inboxes.js';
import * as tokenRepo from '../../db/repositories/tokens.js';
import { ValidationError } from '../../pkg/errors.js';
import config from '../../config/index.js';
import {
  INBOX_TYPE_EXTERNAL,
  INBOX_TYPE_GENERATED,
  AUDIT_INBOX_CREATED,
  AUDIT_INBOX_DELETED,
  AUDIT_TOKEN_ROTATED,
} from '../../pkg/constants.js';

/**
 * Register inbox-related routes.
 */
export default async function inboxRoutes(fastify) {
  // ==========================================================
  // POST /v1/inboxes — Create a new inbox
  // ==========================================================
  fastify.post('/v1/inboxes', {
    schema: createInboxSchema,
    config: { rateLimit: rateLimitPresets.createInbox },
  }, async (request, reply) => {
    const { mode, token_ttl_seconds } = request.body;
    const clientIp = request.ip;

    // Check per-IP inbox limit
    const existingCount = await inboxRepo.countInboxesByIp(clientIp);
    if (existingCount >= config.inbox.maxPerIp) {
      throw new ValidationError(
        `Maximum ${config.inbox.maxPerIp} active inboxes per IP address`,
        { current_count: existingCount, max: config.inbox.maxPerIp }
      );
    }

    let inboxData;

    if (mode === 'external') {
      // Mode A: External mailbox — validate POP3 credentials
      const errors = validateExternalPop3(request.body);
      if (errors.length > 0) {
        throw new ValidationError('Invalid POP3 configuration', errors);
      }

      inboxData = {
        emailAddress: request.body.email_address,
        inboxType: INBOX_TYPE_EXTERNAL,
        pop3Host: request.body.pop3_host,
        pop3Port: request.body.pop3_port || 995,
        pop3Tls: request.body.pop3_tls !== false,
        pop3Username: request.body.pop3_username,
        pop3Password: request.body.pop3_password,
        createdByIp: clientIp,
      };
    } else {
      // Mode B: System-generated inbox
      const generated = generateInboxAddress();
      inboxData = {
        emailAddress: generated.emailAddress,
        inboxType: INBOX_TYPE_GENERATED,
        pop3Host: generated.pop3Host,
        pop3Port: generated.pop3Port,
        pop3Tls: generated.useTls,
        pop3Username: generated.username,
        pop3Password: generated.password,
        createdByIp: clientIp,
      };
    }

    // Create inbox in database (credentials are encrypted internally)
    const inbox = await inboxRepo.createInbox(inboxData);

    // Issue initial access token
    const ttl = token_ttl_seconds || config.token.defaultTtlSeconds;
    const token = await tokenRepo.createToken({
      inboxId: inbox.id,
      issuedByIp: clientIp,
      ttlSeconds: Math.min(ttl, config.token.maxTtlSeconds),
    });

    // Audit log
    await audit(AUDIT_INBOX_CREATED, request, {
      inbox_id: inbox.id,
      inbox_type: inboxData.inboxType,
    });

    reply.code(201);
    return {
      inbox_id: inbox.id,
      email_address: inbox.email_address,
      inbox_type: inbox.inbox_type,
      access_token: token.token,
      token_expires_at: token.expires_at.toISOString(),
      created_at: inbox.created_at,
    };
  });

  // ==========================================================
  // POST /v1/inboxes/:id/token:rotate — Rotate access token
  // ==========================================================
  fastify.post('/v1/inboxes/:id/token\\:rotate', {
    schema: rotateTokenSchema,
    preHandler: [authenticate, authorizeInbox],
  }, async (request, reply) => {
    const { id } = request.params;
    const ttl = request.body?.token_ttl_seconds || config.token.defaultTtlSeconds;

    const token = await tokenRepo.rotateToken({
      inboxId: id,
      issuedByIp: request.ip,
      ttlSeconds: Math.min(ttl, config.token.maxTtlSeconds),
    });

    await audit(AUDIT_TOKEN_ROTATED, request, { inbox_id: id });

    return {
      inbox_id: id,
      access_token: token.token,
      token_expires_at: token.expires_at.toISOString(),
    };
  });

  // ==========================================================
  // DELETE /v1/inboxes/:id — Delete inbox and wipe all data
  // ==========================================================
  fastify.delete('/v1/inboxes/:id', {
    schema: deleteInboxSchema,
    preHandler: [authenticate, authorizeInbox],
  }, async (request, reply) => {
    const { id } = request.params;

    const result = await inboxRepo.deleteInbox(id);

    await audit(AUDIT_INBOX_DELETED, request, { inbox_id: id });

    return {
      inbox_id: result.id,
      deleted: result.deleted,
    };
  });
}
