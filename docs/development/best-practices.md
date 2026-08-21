# rumahl App Development Best Practices

> Production-ready patterns and practices for building robust rumahl apps

## Table of Contents

1. [Error Handling](#error-handling)
2. [Performance](#performance)
3. [Security](#security)
4. [Testing](#testing)
5. [Manifest Design](#manifest-design)
6. [State Management](#state-management)
7. [API Usage](#api-usage)
8. [Resource Management](#resource-management)

## Error Handling

### Always Validate Inputs

```typescript
import { validateAppId, validateString, ValidationError } from '@rumahl/sdk';

function processUserInput(data: any) {
  try {
    validateString(data.name, 'name', { required: true, minLength: 3 });
    validateAppId(data.appId, 'appId');
    // Process validated data
  } catch (error) {
    if (error instanceof ValidationError) {
      console.error(`Validation failed: ${error.message}`);
      return { error: error.message };
    }
    throw error;
  }
}
```

### Use Try-Catch for Async Operations

```typescript
// ✅ Good: Proper error handling
async function loadEntities() {
  try {
    const entities = await client.entities.list();
    return { success: true, data: entities };
  } catch (error) {
    if (error instanceof rumahlError) {
      console.error('Failed to load entities:', error);
      return { success: false, error: error.message };
    }
    throw error;
  }
}

// ❌ Bad: Unhandled promise
function loadEntitiesBad() {
  client.entities.list(); // Unhandled rejection!
}
```

### Implement Graceful Degradation

```typescript
async function getData() {
  try {
    return await client.entities.list();
  } catch (error) {
    console.warn('API unavailable, using cached data');
    return getCachedData() || [];
  }
}
```

## Performance

### Cache Frequently Accessed Data

```typescript
class DataCache<T> {
  private cache = new Map<string, { data: T; timestamp: number }>();
  private ttl: number;

  constructor(ttlSeconds: number = 60) {
    this.ttl = ttlSeconds * 1000;
  }

  get(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  set(key: string, data: T): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  clear(): void {
    this.cache.clear();
  }
}

// Usage
const entityCache = new DataCache<Entity[]>(60);

async function getEntities(): Promise<Entity[]> {
  const cached = entityCache.get('all');
  if (cached) return cached;

  const entities = await client.entities.list();
  entityCache.set('all', entities);
  return entities;
}
```

### Debounce User Input

```typescript
function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;

  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

// Usage
const debouncedSearch = debounce(async (query: string) => {
  const results = await client.entities.list();
  // Update UI with results
}, 300);
```

### Use Request Batching

```typescript
class RequestBatcher {
  private queue: Array<() => Promise<any>> = [];
  private processing = false;

  async add<T>(request: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await request();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });

      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;

    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, 5); // Process 5 at a time
      await Promise.all(batch.map(req => req()));
      await new Promise(resolve => setTimeout(resolve, 100)); // Small delay
    }

    this.processing = false;
  }
}
```

## Security

### Never Expose Sensitive Data

```typescript
// ❌ Bad: Logging sensitive data
console.log('User data:', user);

// ✅ Good: Sanitized logging
console.log('User loaded:', {
  id: user.id,
  name: user.name
  // Don't log password, email, tokens, etc.
});
```

### Validate All External Data

```typescript
// ✅ Good: Validate webhook payloads
app.post('/webhook', async (req, res) => {
  try {
    validateObject(req.body, 'payload', {
      required: true,
      shape: {
        event: (val, field) => validateString(val, field, { required: true }),
        data: (val, field) => validateObject(val, field, { required: true })
      }
    });

    await processWebhook(req.body);
    res.json({ success: true });
  } catch (error) {
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Internal error' });
    }
  }
});
```

### Use Permissions Properly

```typescript
// ✅ Good: Request minimum permissions
{
  "permissions": [
    "EntityRead",
    "AppStorageWrite"
  ]
}

// ❌ Bad: Requesting unnecessary permissions
{
  "permissions": [
    "EntityRead",
    "EntityWrite",      // Not needed
    "SystemAdmin",      // Excessive
    "NetworkAccess"     // Not used
  ]
}
```

### Sanitize User Input

```typescript
function sanitizeHtml(html: string): string {
  const div = document.createElement('div');
  div.textContent = html;
  return div.innerHTML;
}

function renderUserContent(content: string) {
  const sanitized = sanitizeHtml(content);
  element.innerHTML = sanitized;
}
```

## Testing

### Unit Tests

```typescript
import { rumahlClient, rumahlError } from '@rumahl/sdk';

describe('EntityService', () => {
  let client: rumahlClient;

  beforeEach(() => {
    client = new rumahlClient({
      baseUrl: 'http://localhost:8126',
      defaultRetries: 0 // Disable retries in tests
    });
  });

  it('should load entities successfully', async () => {
    const entities = await client.entities.list();
    expect(entities).toBeInstanceOf(Array);
  });

  it('should handle errors gracefully', async () => {
    // Mock fetch to return error
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Server error')
      } as Response)
    );

    await expect(client.entities.list()).rejects.toThrow(rumahlError);
  });
});
```

### Integration Tests

```typescript
describe('App Integration', () => {
  it('should store and retrieve data', async () => {
    // Store data
    await client.appStorage.setKv('test-key', { value: 'test-data' });

    // Retrieve data
    const data = await client.appStorage.getKv('test-key');
    expect(data.value).toBe('test-data');

    // Cleanup
    await client.appStorage.deleteKv('test-key');
  });
});
```

### Mock rumahl Services

```typescript
class MockrumahlClient {
  entities = {
    list: jest.fn(() => Promise.resolve([
      { entity_id: 'light.bedroom', state: 'on', attributes: {} }
    ])),
    get: jest.fn((id) => Promise.resolve({
      entity_id: id,
      state: 'on',
      attributes: {}
    }))
  };
}

// Use in tests
const mockClient = new MockrumahlClient();
const result = await service.loadEntities(mockClient);
```

## Manifest Design

### Minimal Permissions

```json
{
  "id": "my-app",
  "name": "My App",
  "version": "1.0.0",
  "type": "app",
  "permissions": [
    "EntityRead"
  ],
  "description": "Clear description of what the app does"
}
```

### Resource Limits

```json
{
  "docker": {
    "image": "my-app:latest",
    "resources": {
      "memory": "256M",
      "cpu": "0.5"
    },
    "health_check": {
      "endpoint": "/health",
      "interval": 30,
      "timeout": 10,
      "retries": 3
    }
  }
}
```

### Network Access Whitelist

```json
{
  "permissions": ["NetworkAccess"],
  "network_access": {
    "allowed_domains": [
      "api.example.com",
      "cdn.example.com"
    ],
    "allow_user_domains": false
  }
}
```

## State Management

### Use React Context for Global State

```typescript
import React, { createContext, useContext, useReducer } from 'react';

interface AppState {
  entities: Entity[];
  loading: boolean;
  error: string | null;
}

type Action =
  | { type: 'SET_ENTITIES'; payload: Entity[] }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string };

const AppContext = createContext<{
  state: AppState;
  dispatch: React.Dispatch<Action>;
} | null>(null);

function appReducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_ENTITIES':
      return { ...state, entities: action.payload, loading: false };
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload, loading: false };
    default:
      return state;
  }
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, {
    entities: [],
    loading: false,
    error: null
  });

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within AppProvider');
  return context;
}
```

### Persist State to Storage

```typescript
async function saveState(state: AppState) {
  await client.appStorage.setKv('app-state', state);
}

async function loadState(): Promise<AppState | null> {
  try {
    const state = await client.appStorage.getKv('app-state');
    return state;
  } catch {
    return null;
  }
}
```

## API Usage

### Pagination

```typescript
async function loadAllEntities() {
  const entities: Entity[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const batch = await client.entities.list({ page, perPage: 100 });
    entities.push(...batch);
    hasMore = batch.length === 100;
    page++;
  }

  return entities;
}
```

### Parallel Requests

```typescript
async function loadMultipleResources() {
  const [entities, settings, storage] = await Promise.all([
    client.entities.list(),
    client.appConfig.get(),
    client.appStorage.listFiles()
  ]);

  return { entities, settings, storage };
}
```

### Request Cancellation

```typescript
let currentRequest: AbortController | null = null;

async function searchEntities(query: string) {
  // Cancel previous request
  if (currentRequest) {
    currentRequest.abort();
  }

  // Create new controller
  currentRequest = new AbortController();

  try {
    const results = await client.entities.list({
      signal: currentRequest.signal
    });
    return results.filter(e => e.entity_id.includes(query));
  } finally {
    currentRequest = null;
  }
}
```

## Resource Management

### Cleanup on Unmount

```typescript
import { useEffect } from 'react';

function MyComponent() {
  useEffect(() => {
    const interval = setInterval(async () => {
      await refreshData();
    }, 5000);

    // Cleanup
    return () => {
      clearInterval(interval);
    };
  }, []);

  return <div>...</div>;
}
```

### Memory Management

```typescript
class LargeDataProcessor {
  private data: LargeDataSet | null = null;

  async process() {
    this.data = await loadLargeData();
    const result = this.compute();
    this.cleanup();
    return result;
  }

  private cleanup() {
    this.data = null; // Allow garbage collection
  }
}
```

### Database Connection Pooling

```typescript
class DatabaseManager {
  private pool: Database[] = [];
  private maxConnections = 10;

  async getConnection(): Promise<Database> {
    if (this.pool.length > 0) {
      return this.pool.pop()!;
    }

    if (this.pool.length < this.maxConnections) {
      return await this.createConnection();
    }

    throw new Error('Connection pool exhausted');
  }

  releaseConnection(conn: Database) {
    this.pool.push(conn);
  }

  private async createConnection(): Promise<Database> {
    await client.appDatabase.provision();
    return new Database();
  }
}
```

## Logging

### Structured Logging

```typescript
interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: string;
  context?: Record<string, any>;
}

class Logger {
  private appId: string;

  constructor(appId: string) {
    this.appId = appId;
  }

  log(entry: Omit<LogEntry, 'timestamp'>) {
    const logEntry: LogEntry = {
      ...entry,
      timestamp: new Date().toISOString()
    };

    console.log(JSON.stringify({
      appId: this.appId,
      ...logEntry
    }));
  }

  info(message: string, context?: Record<string, any>) {
    this.log({ level: 'info', message, context });
  }

  error(message: string, error?: Error, context?: Record<string, any>) {
    this.log({
      level: 'error',
      message,
      context: {
        ...context,
        error: error?.message,
        stack: error?.stack
      }
    });
  }
}

// Usage
const logger = new Logger('my-app');
logger.info('App started', { version: '1.0.0' });
logger.error('Failed to load data', error, { userId: '123' });
```

## Deployment

### Health Checks

```typescript
app.get('/health', (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: process.env.APP_VERSION
  };

  res.json(health);
});
```

### Graceful Shutdown

```typescript
let isShuttingDown = false;

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, starting graceful shutdown');
  isShuttingDown = true;

  // Stop accepting new requests
  server.close(async () => {
    // Cleanup resources
    await cleanup();
    process.exit(0);
  });

  // Force exit after 30 seconds
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
});

async function cleanup() {
  // Close database connections
  await dbManager.closeAll();

  // Save state
  await saveState(currentState);

  // Clear caches
  cache.clear();
}
```

## Related Documentation

- [Error Handling Guide](./error-handling-guide.md)
- [App Development Guide](./app-development.md)
- [Plugin Development Guide](./plugin-development.md)
- [Security Guide](../security/app-security.md)
- [API Reference](./api-reference.md)
