#!/bin/bash
set -e

# Initialize multiple PostgreSQL databases for IORA services.
# This script is mounted into the postgres container's
# /docker-entrypoint-initdb.d/ and runs ONLY on the first start
# (when the data directory is empty).

# Create the dedicated 'iora' application role if it doesn't exist,
# using POSTGRES_PASSWORD as the default (overridable via IORA_DB_PASSWORD).
IORA_DB_PASS="${IORA_DB_PASSWORD:-$POSTGRES_PASSWORD}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
    -- Create iora application role (if not already done)
    DO \$\$BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'iora') THEN
        CREATE ROLE iora LOGIN PASSWORD '${IORA_DB_PASS//\'/''}';
      END IF;
    END\$\$;

    -- Create additional databases owned by iora
    CREATE DATABASE iora_core OWNER iora;
    CREATE DATABASE iora_security OWNER iora;
    CREATE DATABASE iora_secrets OWNER iora;
    CREATE DATABASE iora_appstore OWNER iora;

    -- Grant all privileges
    GRANT ALL PRIVILEGES ON DATABASE iora_home TO $POSTGRES_USER;
    GRANT ALL PRIVILEGES ON DATABASE iora_core TO $POSTGRES_USER;
    GRANT ALL PRIVILEGES ON DATABASE iora_security TO $POSTGRES_USER;
    GRANT ALL PRIVILEGES ON DATABASE iora_secrets TO $POSTGRES_USER;
    GRANT ALL PRIVILEGES ON DATABASE iora_appstore TO $POSTGRES_USER;
EOSQL

echo "IORA databases initialized successfully"
