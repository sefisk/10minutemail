-- Migration 001: Initial schema for 10minutemail
-- Idempotent: uses IF NOT EXISTS throughout

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- INBOXES TABLE
-- Stores both external (bring-your-own) and system-generated inboxes.
-- POP3 credentials are encrypted at application level before storage.
-- ============================================================
CREATE TABLE IF NOT EXISTS inboxes (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email_address   VARCHAR(320) NOT NULL,
    inbox_type      VARCHAR(20) NOT NULL CHECK (inbox_type IN ('external', 'generated')),
    status          VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted', 'suspended')),

    -- Encrypted POP3 credentials (AES-256-GCM encrypted blobs stored as text)
    pop3_host       VARCHAR(255) NOT NULL,
    pop3_port       INTEGER NOT NULL DEFAULT 995,
    pop3_tls        BOOLEAN NOT NULL DEFAULT true,
    pop3_username_enc TEXT NOT NULL,
    pop3_password_enc TEXT NOT NULL,

    -- UID tracking: last seen UID for incremental fetching
    last_seen_uid   VARCHAR(255) DEFAULT NULL,

    -- Metadata
    created_by_ip   INET NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_inboxes_email ON inboxes (email_address);
CREATE INDEX IF NOT EXISTS idx_inboxes_status ON inboxes (status);
CREATE INDEX IF NOT EXISTS idx_inboxes_created_by_ip ON inboxes (created_by_ip);
CREATE INDEX IF NOT EXISTS idx_inboxes_created_at ON inboxes (created_at);

-- ============================================================
-- TOKENS TABLE
-- Short-lived access tokens for inbox operations.
-- Each inbox can have multiple tokens (only one active at a time).
-- ============================================================
CREATE TABLE IF NOT EXISTS tokens (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    inbox_id        UUID NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
    token_hash      VARCHAR(128) NOT NULL UNIQUE,
    status          VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
    expires_at      TIMESTAMPTZ NOT NULL,
    issued_by_ip    INET NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at      TIMESTAMPTZ DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_tokens_inbox_id ON tokens (inbox_id);
CREATE INDEX IF NOT EXISTS idx_tokens_token_hash ON tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_tokens_status ON tokens (status);
CREATE INDEX IF NOT EXISTS idx_tokens_expires_at ON tokens (expires_at);

-- ============================================================
-- MESSAGES TABLE
-- Cached messages retrieved from POP3 mailboxes.
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    inbox_id        UUID NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
    uid             VARCHAR(255) NOT NULL,
    message_id      VARCHAR(512) DEFAULT NULL,
    sender          VARCHAR(320) NOT NULL DEFAULT '',
    recipients      JSONB DEFAULT '[]',
    subject         TEXT DEFAULT '',
    text_body       TEXT DEFAULT '',
    html_body       TEXT DEFAULT '',
    headers         JSONB DEFAULT '{}',
    size_bytes      INTEGER DEFAULT 0,
    received_at     TIMESTAMPTZ DEFAULT NULL,
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(inbox_id, uid)
);

CREATE INDEX IF NOT EXISTS idx_messages_inbox_id ON messages (inbox_id);
CREATE INDEX IF NOT EXISTS idx_messages_uid ON messages (inbox_id, uid);
CREATE INDEX IF NOT EXISTS idx_messages_fetched_at ON messages (fetched_at);
CREATE INDEX IF NOT EXISTS idx_messages_received_at ON messages (received_at);

-- ============================================================
-- ATTACHMENTS TABLE
-- Metadata and binary storage for message attachments.
-- ============================================================
CREATE TABLE IF NOT EXISTS attachments (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id      UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    inbox_id        UUID NOT NULL REFERENCES inboxes(id) ON DELETE CASCADE,
    filename        VARCHAR(512) NOT NULL DEFAULT 'unnamed',
    content_type    VARCHAR(255) NOT NULL DEFAULT 'application/octet-stream',
    size_bytes      INTEGER NOT NULL DEFAULT 0,
    content_id      VARCHAR(512) DEFAULT NULL,
    checksum_sha256 VARCHAR(64) DEFAULT NULL,
    content         BYTEA NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attachments_message_id ON attachments (message_id);
CREATE INDEX IF NOT EXISTS idx_attachments_inbox_id ON attachments (inbox_id);

-- ============================================================
-- AUDIT LOGS TABLE
-- Immutable event log for security auditing.
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id              BIGSERIAL PRIMARY KEY,
    event_type      VARCHAR(50) NOT NULL,
    inbox_id        UUID DEFAULT NULL,
    actor_ip        INET DEFAULT NULL,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON audit_logs (event_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_inbox_id ON audit_logs (inbox_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at);

-- ============================================================
-- TRIGGER: Auto-update updated_at on inboxes
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_inboxes_updated_at ON inboxes;
CREATE TRIGGER trigger_inboxes_updated_at
    BEFORE UPDATE ON inboxes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- CLEANUP: Partitioning hint for audit_logs (manual for production)
-- In production, consider partitioning audit_logs by created_at
-- using PostgreSQL declarative partitioning for time-series data.
-- ============================================================
