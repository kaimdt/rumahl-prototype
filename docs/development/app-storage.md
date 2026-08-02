# App Storage Guide

Apps in IORA can store and retrieve files and structured key-value data through a dedicated per-app storage area. The storage is fully isolated – no other app can read your app's data.

## Overview

Two storage modes are available:

- **File Storage** – Binary blobs (images, configuration files, archives)
- **Key-Value Storage** – Structured JSON data for app settings, state, etc.

Each app has configurable storage quotas declared in its manifest.

## Declaring Storage in the Manifest

To enable storage, add a `storage` field to your `manifest.json`:

```json
{
  "id": "my-app",
  "name": "My App",
  "version": "1.0.0",
  "type": "app",
  "storage": {
    "enabled": true,
    "quota": {
      "max_file_storage_bytes": 20971520,
      "max_kv_entries": 500,
      "max_file_size_bytes": 5242880
    },
    "public_files": false,
    "allowed_mime_types": ["image/png", "application/json"]
  }
}
```

### Storage Configuration Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable storage |
| `quota.max_file_storage_bytes` | number | `10485760` (10 MB) | Maximum total file storage |
| `quota.max_kv_entries` | number | `1000` | Maximum KV entries |
| `quota.max_file_size_bytes` | number | `5242880` (5 MB) | Max size per file |
| `public_files` | boolean | `false` | Allow public file URLs |
| `allowed_mime_types` | string[] | `[]` | Restrict upload MIME types |

## Required Permissions

| Permission | Description |
|------------|-------------|
| `AppStorageRead` | Read files and KV entries |
| `AppStorageWrite` | Upload files and set KV entries |
| `AppStorageDelete` | Delete files and KV entries |
| `AppStorageManage` | Manage storage quotas and settings |

## API Reference

### File Storage

```typescript
// List stored files
GET /api/apps/:app_id/storage/files?limit=50&offset=0&prefix=

// Upload a file (base64-encoded)
POST /api/apps/:app_id/storage/files
{
  "name": "config.json",
  "mime_type": "application/json",
  "content": "<base64-encoded-content>",
  "metadata": { "version": 1 }
}

// Download a file
GET /api/apps/:app_id/storage/files/:file_id

// Delete a file
DELETE /api/apps/:app_id/storage/files/:file_id
```

### Key-Value Storage

```typescript
// List all KV entries
GET /api/apps/:app_id/storage/kv

// Set a KV entry
PUT /api/apps/:app_id/storage/kv/:key
{
  "key": "my-setting",
  "value": { "theme": "dark", "volume": 80 }
}

// Get a KV entry
GET /api/apps/:app_id/storage/kv/:key

// Delete a KV entry
DELETE /api/apps/:app_id/storage/kv/:key
```

### Usage Statistics

```typescript
// Get storage usage
GET /api/apps/:app_id/storage/usage
```

## SDK Usage (JavaScript/TypeScript)

```typescript
import IoraClient from '@iora/sdk';

const client = new IoraClient('http://localhost:8126', 'your-api-key');
client.setAppId('my-app');

// Store a file
const result = await client.appStorage.uploadFile(
  'config.json',
  btoa(JSON.stringify({ key: 'value' })),
  'application/json'
);
console.log('File ID:', result.id);

// Set a KV entry
await client.appStorage.setKv('theme', { mode: 'dark' });

// Get storage usage
const usage = await client.appStorage.getUsage();
console.log('Usage:', usage.usage_percent.toFixed(1) + '%');
```

## User-selected ORA Cloud files

App storage is private to the app. If an iframe app needs a document from the user's personal ORA Cloud, use the system file picker instead of calling `/api/files` directly. ORA always shows a confirmation dialog and only returns the file selected by the user.

```typescript
import { createIoraIframe } from '@iora/sdk';

const ora = createIoraIframe('my-app');
await ora.ready();

// Opens the ORA system picker. The result contains only the selected file.
const file = await ora.openFile();
const bytes = Uint8Array.from(atob(file.dataBase64), value => value.charCodeAt(0));

// Opens the ORA save dialog. The user chooses the destination folder.
const saved = await ora.saveFile({
  name: 'report.json',
  mimeType: 'application/json',
  dataBase64: btoa(JSON.stringify({ status: 'complete' })),
});
```

The app never receives the user's authentication token, a physical storage path, or unrestricted folder access. Cancelling the system dialog rejects the SDK request without exposing a file.

## Best Practices

1. **Use KV storage for structured data** – simple key-value lookups are faster than file I/O
2. **Set appropriate quotas** – don't request more storage than your app needs
3. **Clean up old files** – delete temporary files after processing
4. **Use metadata** – tag files with metadata for easier filtering
5. **Compress large files** – compress JSON/text before uploading to save space

## Limitations

- Maximum file size: 5 MB (configurable in manifest)
- Maximum total storage: 10 MB default (configurable)
- Maximum KV entries: 1000 default (configurable)
- Files are stored in the app's isolated directory on the server
- Base64 encoding adds ~33% overhead to file uploads
