-- Migration 003: Built-in SMTP mail server support
-- Adds is_local flag to domains for self-hosted mail receiving.
-- Local domains use the built-in SMTP server instead of external POP3.

-- ============================================================
-- Add is_local column to domains
-- When true, the built-in SMTP server receives mail for this domain
-- and stores it directly in the database.
-- ============================================================
ALTER TABLE domains ADD COLUMN IF NOT EXISTS is_local BOOLEAN NOT NULL DEFAULT false;

-- ============================================================
-- Add domain_id to inboxes index for fast SMTP recipient lookup
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_inboxes_email_address ON inboxes (email_address);
CREATE INDEX IF NOT EXISTS idx_inboxes_domain_id ON inboxes (domain_id);
