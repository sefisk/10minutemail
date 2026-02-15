/**
 * Application-wide constants.
 */

// Inbox types
export const INBOX_TYPE_EXTERNAL = 'external';
export const INBOX_TYPE_GENERATED = 'generated';

// Inbox statuses
export const INBOX_STATUS_ACTIVE = 'active';
export const INBOX_STATUS_DELETED = 'deleted';
export const INBOX_STATUS_SUSPENDED = 'suspended';

// Token statuses
export const TOKEN_STATUS_ACTIVE = 'active';
export const TOKEN_STATUS_REVOKED = 'revoked';
export const TOKEN_STATUS_EXPIRED = 'expired';

// Audit event types
export const AUDIT_INBOX_CREATED = 'inbox.created';
export const AUDIT_INBOX_DELETED = 'inbox.deleted';
export const AUDIT_TOKEN_ISSUED = 'token.issued';
export const AUDIT_TOKEN_ROTATED = 'token.rotated';
export const AUDIT_TOKEN_REVOKED = 'token.revoked';
export const AUDIT_MESSAGES_FETCHED = 'messages.fetched';
export const AUDIT_ATTACHMENT_DOWNLOADED = 'attachment.downloaded';
export const AUDIT_POP3_CONNECT = 'pop3.connect';
export const AUDIT_POP3_ERROR = 'pop3.error';

// POP3
export const POP3_STATE_DISCONNECTED = 'disconnected';
export const POP3_STATE_CONNECTED = 'connected';
export const POP3_STATE_AUTHENTICATED = 'authenticated';
export const POP3_STATE_TRANSACTION = 'transaction';

// HTTP headers
export const HEADER_REQUEST_ID = 'x-request-id';
export const HEADER_RATE_LIMIT_REMAINING = 'x-ratelimit-remaining';
export const HEADER_RATE_LIMIT_RESET = 'x-ratelimit-reset';

// Pagination defaults
export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 50;
