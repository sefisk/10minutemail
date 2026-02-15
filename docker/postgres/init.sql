-- PostgreSQL init script for Docker
-- This runs on first container startup only (when pgdata volume is empty).
-- The application migration script (scripts/migrate.js) handles schema creation.
-- This file ensures the database and extensions are ready.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Grant permissions
GRANT ALL PRIVILEGES ON DATABASE tenminutemail TO tmmail;
