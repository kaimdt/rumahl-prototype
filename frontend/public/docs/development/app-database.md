# App Database (SQLite) Guide

Apps in IORA can optionally use their own SQLite database instead of the shared PostgreSQL database. This is ideal for apps that need to store large amounts of relational data, use SQLite-specific features, or operate offline.

## Overview

Each app can provision **one** SQLite database. The system manages creation, backups, and provides a SQL execution API.

### When to Use SQLite

- Your app needs complex relational queries
- You want to use SQLite features (FTS5, JSON1, CTEs)
- You don't want to depend on the shared PostgreSQL pool
- Your app should work in offline/air-gapped deployments
- You need to store large datasets efficiently

### When to Use PostgreSQL

- Your app needs concurrent write access from multiple instances
- You need row-level security or PostgreSQL-specific extensions
- Your app is already using the shared IORA database

## Declaring a Database in the Manifest

```json
{
  "id": "my-app",
  "name": "My App",
  "version": "1.0.0",
  "type": "app",
  "database": {
    "backend": "sqlite",
    "sqlite": {
      "init_sql": [
        "CREATE TABLE IF NOT EXISTS todos (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, done BOOLEAN DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))",
        "CREATE INDEX IF NOT EXISTS idx_todos_done ON todos(done)"
      ],
      "wal_mode": true,
      "max_size_bytes": 104857600,
      "auto_backup": true,
      "backup_interval_minutes": 1440
    }
  }
}
```

### SQLite Configuration Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `init_sql` | string[] | `[]` | SQL to run after DB creation |
| `wal_mode` | boolean | `true` | Enable WAL mode for better reads |
| `max_size_bytes` | number | `104857600` (100 MB) | Maximum database size |
| `auto_backup` | boolean | `true` | Enable automatic backups |
| `backup_interval_minutes` | number | `1440` (24h) | Backup interval |

### PostgreSQL Alternative

```json
{
  "database": {
    "backend": "postgres",
    "postgres": {
      "schema": "app_my_app",
      "max_connections": 5
    }
  }
}
```

## Required Permissions

| Permission | Description |
|------------|-------------|
| `AppDatabaseSqlite` | Provision and use a per-app SQLite database |
| `AppDatabaseManage` | Manage database settings and backups |

## API Reference

### Database Lifecycle

```typescript
// Provision a new SQLite database
POST /api/apps/:app_id/database/provision
{
  "init_sql": ["CREATE TABLE IF NOT EXISTS ..."],
  "wal_mode": true,
  "max_size_bytes": 104857600,
  "auto_backup": true
}

// Get database status
GET /api/apps/:app_id/database/status

// Drop the database
DELETE /api/apps/:app_id/database
```

### SQL Execution

```typescript
// Execute SQL queries
POST /api/apps/:app_id/database/execute
{
  "sql": "SELECT * FROM todos WHERE done = ?",
  "params": [false]
}

// Response for SELECT
{
  "success": true,
  "columns": ["id", "title", "done", "created_at"],
  "rows": [[1, "Buy groceries", false, "2026-04-28 12:00:00"]],
  "duration_ms": 2
}

// Response for INSERT/UPDATE/DELETE
{
  "success": true,
  "rows_affected": 1,
  "duration_ms": 3
}
```

### Backups

```typescript
// Trigger a manual backup
POST /api/apps/:app_id/database/backup

// List available backups
GET /api/apps/:app_id/database/backups
```

## SDK Usage (JavaScript/TypeScript)

```typescript
import IoraClient from '@iora/sdk';

const client = new IoraClient('http://localhost:8126', 'your-api-key');
client.setAppId('my-app');

// Provision database with initial schema
await client.appDatabase.provision({
  init_sql: [
    `CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`
  ],
  wal_mode: true
});

// Execute a query
const result = await client.appDatabase.execute(
  'SELECT * FROM notes ORDER BY created_at DESC'
);
console.log('Notes:', result.rows);

// Insert data
await client.appDatabase.execute(
  'INSERT INTO notes (title, content) VALUES (?, ?)',
  ['Hello', 'World']
);

// Backup
await client.appDatabase.backup();
```

## Best Practices

1. **Initialize schema on provision** – use `init_sql` in the manifest
2. **Use parameterized queries** – always use `?` placeholders, never concatenate SQL
3. **Set a reasonable max size** – don't request 1 GB if you only need 10 MB
4. **Enable auto-backup** – protects against accidental data loss
5. **Drop unused tables** – clean up when your app is uninstalled
6. **Use WAL mode** – significantly improves concurrent read performance
7. **Keep transactions short** – SQLite locks the entire database during writes

## Limitations

- One SQLite database per app
- Maximum database size: 100 MB (configurable)
- No concurrent write access from multiple instances
- SQLite does not support row-level security
- Backup is a file-level copy (inconsistent if writes happen during backup)
