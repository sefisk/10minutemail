-- Migration 002: Admin domains and bulk generation support

-- ============================================================
-- DOMAINS TABLE
-- Stores system-managed domains available for generating inboxes.
-- Admin can add/remove domains used by Mode B inbox generation.
-- ============================================================
CREATE TABLE IF NOT EXISTS domains (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    domain          VARCHAR(255) NOT NULL UNIQUE,
    pop3_host       VARCHAR(255) NOT NULL,
    pop3_port       INTEGER NOT NULL DEFAULT 995,
    pop3_tls        BOOLEAN NOT NULL DEFAULT true,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_domains_domain ON domains (domain);
CREATE INDEX IF NOT EXISTS idx_domains_active ON domains (is_active);

-- Apply the same updated_at trigger
DROP TRIGGER IF EXISTS trigger_domains_updated_at ON domains;
CREATE TRIGGER trigger_domains_updated_at
    BEFORE UPDATE ON domains
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Add token_ttl_seconds column to inboxes for custom TTL tracking
-- ============================================================
ALTER TABLE inboxes ADD COLUMN IF NOT EXISTS token_ttl_seconds INTEGER DEFAULT 600;

-- ============================================================
-- Add domain_id FK to inboxes for generated inboxes
-- ============================================================
ALTER TABLE inboxes ADD COLUMN IF NOT EXISTS domain_id UUID REFERENCES domains(id) DEFAULT NULL;

-- ============================================================
-- BULK_GENERATIONS TABLE
-- Tracks admin bulk generation batches for audit trail.
-- ============================================================
CREATE TABLE IF NOT EXISTS bulk_generations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    count           INTEGER NOT NULL,
    domain_ids      JSONB NOT NULL DEFAULT '[]',
    token_ttl_seconds INTEGER NOT NULL DEFAULT 600,
    generated_by_ip INET NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
