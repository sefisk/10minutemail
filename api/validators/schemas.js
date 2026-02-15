/**
 * JSON Schema definitions for Fastify request/response validation.
 * Fastify uses Ajv under the hood — these schemas validate and coerce inputs
 * and strip unknown properties (additionalProperties: false).
 */

// ============================================================
// POST /v1/inboxes — Create inbox
// ============================================================
export const createInboxSchema = {
  body: {
    type: 'object',
    required: ['mode'],
    additionalProperties: false,
    properties: {
      mode: {
        type: 'string',
        enum: ['external', 'generated'],
        description: 'Inbox mode: "external" (bring-your-own) or "generated" (system-assigned)',
      },
      // Required for mode=external
      email_address: { type: 'string', maxLength: 320 },
      pop3_host: { type: 'string', maxLength: 255 },
      pop3_port: { type: 'integer', minimum: 1, maximum: 65535, default: 995 },
      pop3_tls: { type: 'boolean', default: true },
      pop3_username: { type: 'string', maxLength: 255 },
      pop3_password: { type: 'string', maxLength: 1024 },
      // Optional TTL override
      token_ttl_seconds: { type: 'integer', minimum: 60, maximum: 3600 },
    },
  },
  response: {
    201: {
      type: 'object',
      properties: {
        inbox_id: { type: 'string', format: 'uuid' },
        email_address: { type: 'string' },
        inbox_type: { type: 'string' },
        access_token: { type: 'string' },
        token_expires_at: { type: 'string', format: 'date-time' },
        created_at: { type: 'string', format: 'date-time' },
      },
    },
  },
};

// ============================================================
// GET /v1/inboxes/:id/messages — Fetch messages
// ============================================================
export const getMessagesSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
  },
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      since_uid: { type: 'string', maxLength: 255 },
      limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
      fetch_new: { type: 'boolean', default: true },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        inbox_id: { type: 'string', format: 'uuid' },
        messages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              uid: { type: 'string' },
              message_id: { type: ['string', 'null'] },
              sender: { type: 'string' },
              recipients: { type: 'array' },
              subject: { type: 'string' },
              text_body: { type: 'string' },
              html_body: { type: 'string' },
              headers: { type: 'object' },
              size_bytes: { type: 'integer' },
              received_at: { type: ['string', 'null'] },
              fetched_at: { type: 'string' },
              attachments: { type: 'array' },
            },
          },
        },
        count: { type: 'integer' },
      },
    },
  },
};

// ============================================================
// GET /v1/inboxes/:id/messages/:uid/attachments/:attachmentId
// ============================================================
export const getAttachmentSchema = {
  params: {
    type: 'object',
    required: ['id', 'uid', 'attachmentId'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      uid: { type: 'string' },
      attachmentId: { type: 'string', format: 'uuid' },
    },
  },
};

// ============================================================
// POST /v1/inboxes/:id/token/rotate
// ============================================================
export const rotateTokenSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
  },
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      token_ttl_seconds: { type: 'integer', minimum: 60, maximum: 3600 },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        inbox_id: { type: 'string', format: 'uuid' },
        access_token: { type: 'string' },
        token_expires_at: { type: 'string', format: 'date-time' },
      },
    },
  },
};

// ============================================================
// DELETE /v1/inboxes/:id
// ============================================================
export const deleteInboxSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        inbox_id: { type: 'string', format: 'uuid' },
        deleted: { type: 'boolean' },
      },
    },
  },
};
