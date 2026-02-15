import { query } from '../connection.js';
import { NotFoundError, ConflictError } from '../../pkg/errors.js';

/**
 * Create a new domain.
 */
export async function createDomain({ domain, pop3Host, pop3Port, pop3Tls, isLocal }) {
  // Check for duplicate
  const existing = await query(
    `SELECT id FROM domains WHERE domain = $1`,
    [domain]
  );
  if (existing.rows.length > 0) {
    throw new ConflictError(`Domain "${domain}" already exists`);
  }

  const result = await query(
    `INSERT INTO domains (domain, pop3_host, pop3_port, pop3_tls, is_local)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, domain, pop3_host, pop3_port, pop3_tls, is_local, is_active, created_at`,
    [domain, pop3Host, pop3Port, pop3Tls, isLocal || false]
  );

  return result.rows[0];
}

/**
 * List all domains.
 */
export async function listDomains({ activeOnly = false } = {}) {
  let sql = `SELECT id, domain, pop3_host, pop3_port, pop3_tls, is_local, is_active, created_at, updated_at
             FROM domains`;
  const params = [];

  if (activeOnly) {
    sql += ` WHERE is_active = true`;
  }

  sql += ` ORDER BY created_at ASC`;

  const result = await query(sql, params);
  return result.rows;
}

/**
 * Get a domain by ID.
 */
export async function getDomainById(id) {
  const result = await query(
    `SELECT id, domain, pop3_host, pop3_port, pop3_tls, is_active, created_at, updated_at
     FROM domains WHERE id = $1`,
    [id]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('Domain', id);
  }

  return result.rows[0];
}

/**
 * Get random active domains by IDs (for bulk generation).
 * If domainIds is empty, returns all active domains.
 */
export async function getDomainsForGeneration(domainIds) {
  if (domainIds && domainIds.length > 0) {
    const placeholders = domainIds.map((_, i) => `$${i + 1}`).join(', ');
    const result = await query(
      `SELECT id, domain, pop3_host, pop3_port, pop3_tls
       FROM domains
       WHERE id IN (${placeholders}) AND is_active = true`,
      domainIds
    );
    return result.rows;
  }

  const result = await query(
    `SELECT id, domain, pop3_host, pop3_port, pop3_tls
     FROM domains WHERE is_active = true`
  );
  return result.rows;
}

/**
 * Update a domain.
 */
export async function updateDomain(id, updates) {
  const fields = [];
  const values = [];
  let idx = 1;

  if (updates.domain !== undefined) {
    fields.push(`domain = $${idx++}`);
    values.push(updates.domain);
  }
  if (updates.pop3Host !== undefined) {
    fields.push(`pop3_host = $${idx++}`);
    values.push(updates.pop3Host);
  }
  if (updates.pop3Port !== undefined) {
    fields.push(`pop3_port = $${idx++}`);
    values.push(updates.pop3Port);
  }
  if (updates.pop3Tls !== undefined) {
    fields.push(`pop3_tls = $${idx++}`);
    values.push(updates.pop3Tls);
  }
  if (updates.isActive !== undefined) {
    fields.push(`is_active = $${idx++}`);
    values.push(updates.isActive);
  }
  if (updates.isLocal !== undefined) {
    fields.push(`is_local = $${idx++}`);
    values.push(updates.isLocal);
  }

  if (fields.length === 0) {
    return getDomainById(id);
  }

  values.push(id);
  const result = await query(
    `UPDATE domains SET ${fields.join(', ')} WHERE id = $${idx}
     RETURNING id, domain, pop3_host, pop3_port, pop3_tls, is_local, is_active, created_at, updated_at`,
    values
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('Domain', id);
  }

  return result.rows[0];
}

/**
 * Delete a domain.
 */
export async function deleteDomain(id) {
  const result = await query(
    `DELETE FROM domains WHERE id = $1 RETURNING id`,
    [id]
  );

  if (result.rows.length === 0) {
    throw new NotFoundError('Domain', id);
  }

  return { id, deleted: true };
}
