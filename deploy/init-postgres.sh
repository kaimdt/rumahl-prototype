#!/bin/bash
set -e

# Initialize multiple PostgreSQL databases for rumahl services.
# This script is mounted into the postgres container's
# /docker-entrypoint-initdb.d/ and runs ONLY on the first start
# (when the data directory is empty).

# Create the dedicated 'ora' application role if it doesn't exist,
# using POSTGRES_PASSWORD as the default (overridable via RUMAHL_DB_PASSWORD).
RUMAHL_DB_PASS="${RUMAHL_DB_PASSWORD:-$POSTGRES_PASSWORD}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
    -- Create ora application role (if not already done)
    DO \$\$BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ora') THEN
        CREATE ROLE ora LOGIN PASSWORD '${RUMAHL_DB_PASS//\'/''}';
      END IF;
    END\$\$;

    -- Create additional databases owned by ora
    CREATE DATABASE rumahl_core OWNER ora;
    CREATE DATABASE rumahl_security OWNER ora;
    CREATE DATABASE rumahl_secrets OWNER ora;
    CREATE DATABASE rumahl_appstore OWNER ora;

    -- Grant all privileges
    GRANT ALL PRIVILEGES ON DATABASE rumahl_home TO $POSTGRES_USER;
    GRANT ALL PRIVILEGES ON DATABASE rumahl_core TO $POSTGRES_USER;
    GRANT ALL PRIVILEGES ON DATABASE rumahl_security TO $POSTGRES_USER;
    GRANT ALL PRIVILEGES ON DATABASE rumahl_secrets TO $POSTGRES_USER;
    GRANT ALL PRIVILEGES ON DATABASE rumahl_appstore TO $POSTGRES_USER;
EOSQL

echo "rumahl databases initialized successfully"
