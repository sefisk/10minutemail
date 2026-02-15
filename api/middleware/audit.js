import { writeAuditLog } from '../../db/repositories/auditLogs.js';

/**
 * Create a Fastify preHandler/onResponse hook that logs an audit event.
 * Usage: { onResponse: auditHook('inbox.created') }
 */
export function auditHook(eventType) {
  return async (request, reply) => {
    // Only audit successful responses
    if (reply.statusCode >= 400) return;

    await writeAuditLog({
      eventType,
      inboxId: request.inboxId || request.params?.id || null,
      actorIp: request.ip,
      metadata: {
        method: request.method,
        path: request.url,
        requestId: request.requestId,
        statusCode: reply.statusCode,
      },
    });
  };
}

/**
 * Directly write an audit log from a route handler.
 */
export async function audit(eventType, request, extra = {}) {
  await writeAuditLog({
    eventType,
    inboxId: request.inboxId || request.params?.id || null,
    actorIp: request.ip,
    metadata: {
      method: request.method,
      path: request.url,
      requestId: request.requestId,
      ...extra,
    },
  });
}
