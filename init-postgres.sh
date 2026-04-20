#!/bin/bash
set -e

# Initialize multiple PostgreSQL databases for IORA services

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- Create additional databases
    CREATE DATABASE iora_core;
    CREATE DATABASE iora_security;
    CREATE DATABASE iora_secrets;
    CREATE DATABASE iora_appstore;

    -- Grant all privileges
    GRANT ALL PRIVILEGES ON DATABASE iora_home TO $POSTGRES_USER;
    GRANT ALL PRIVILEGES ON DATABASE iora_core TO $POSTGRES_USER;
    GRANT ALL PRIVILEGES ON DATABASE iora_security TO $POSTGRES_USER;
    GRANT ALL PRIVILEGES ON DATABASE iora_secrets TO $POSTGRES_USER;
    GRANT ALL PRIVILEGES ON DATABASE iora_appstore TO $POSTGRES_USER;
EOSQL

echo "IORA databases initialized successfully"
