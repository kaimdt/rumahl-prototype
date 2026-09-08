# SDK Error Handling Guide

> Comprehensive guide for handling errors robustly in rumahl apps

## Overview

The rumahl SDK provides enhanced error handling with:
- **Automatic retries** with exponential backoff
- **Circuit breaker** pattern to prevent cascading failures
- **Request timeouts** for better reliability
- **Detailed error context** for debugging
- **Type-safe error handling**

## Quick Start

### Basic Configuration

```typescript
import { rumahlClient, rumahlError } from '@rumahl/sdk';

const client = new rumahlClient({
  baseUrl: 'http://localhost:8126',
  apiKey: 'your-api-key',
  defaultTimeout: 30000,      // 30 seconds
  defaultRetries: 3,           // Retry failed requests up to 3 times
  retryDelay: 1000,            // Base delay of 1 second between retries
  onError: (error) => {
    console.error('rumahl API Error:', error);
  }
});
```

### Setting App ID

```typescript
client.setAppId('my-app-id');
```

## Error Types

### rumahlError Class

All SDK errors are instances of `rumahlError` with the following properties:

```typescript
class rumahlError extends Error {
  statusCode?: number;        // HTTP status code (if available)
  path?: string;              // API path that failed
  method?: string;            // HTTP method (GET, POST, etc.)
  retryable: boolean;         // Whether the error is automatically retryable
  context?: any;              // Additional context (original error, etc.)

  isRetryable(): boolean;     // Check if error can be retried
}
```

### Error Categories

| Status Code | Category | Retryable | Description |
|-------------|----------|-----------|-------------|
| 400 | Bad Request | ❌ | Invalid request data |
| 401 | Unauthorized | ❌ | Invalid or missing API key |
| 403 | Forbidden | ❌ | Permission denied |
| 404 | Not Found | ❌ | Resource doesn't exist |
| 408 | Timeout | ✅ | Request timed out |
| 429 | Rate Limited | ✅ | Too many requests |
| 500 | Server Error | ✅ | Internal server error |
| 502 | Bad Gateway | ✅ | Upstream service error |
| 503 | Service Unavailable | ✅ | Service temporarily down |
| 504 | Gateway Timeout | ✅ | Upstream timeout |

## Handling Errors

### Try-Catch Pattern

```typescript
try {
  const entities = await client.entities.list();
  console.log('Entities:', entities);
} catch (error) {
  if (error instanceof rumahlError) {
    // Handle rumahl-specific errors
    console.error('rumahl Error:', {
      message: error.message,
      statusCode: error.statusCode,
      path: error.path,
      retryable: error.isRetryable()
    });

    // Handle specific error codes
    if (error.statusCode === 401) {
      console.log('Authentication failed. Please check your API key.');
    } else if (error.statusCode === 404) {
      console.log('Resource not found.');
    } else if (error.statusCode === 503) {
      console.log('Service temporarily unavailable. Will retry automatically.');
    }
  } else {
    // Handle other errors
    console.error('Unexpected error:', error);
  }
}
```

### Error Handler Callback

Register a global error handler to track all errors:

```typescript
const client = new rumahlClient({
  baseUrl: 'http://localhost:8126',
  onError: (error) => {
    // Log to monitoring service
    console.error('[rumahl Error]', {
      timestamp: new Date().toISOString(),
      message: error.message,
      statusCode: error.statusCode,
      path: error.path,
      method: error.method,
      retryable: error.isRetryable()
    });

    // Show user-friendly message
    if (!error.isRetryable()) {
      showNotification({
        type: 'error',
        message: 'An error occurred. Please try again.'
      });
    }
  }
});
```

## Retry Logic

### Automatic Retries

The SDK automatically retries failed requests with:
- **Exponential backoff**: Delay doubles with each retry
- **Jitter**: Random delay added to prevent thundering herd
- **Smart retry**: Only retries transient errors (5xx, timeouts)

```typescript
// Default: 3 retries with 1 second base delay
// Retry 1: ~1 second
// Retry 2: ~2 seconds
// Retry 3: ~4 seconds

const client = new rumahlClient({
  defaultRetries: 3,
  retryDelay: 1000
});
```

### Custom Retry Configuration

Override retry behavior per-request:

```typescript
// Disable retries for a specific request
await client.entities.get('light.bedroom', { retries: 0 });

// More retries for critical operations
await client.appDatabase.execute(sql, params, {
  retries: 5,
  retryDelay: 2000
});
```

### Manual Retry Logic

For custom retry logic:

```typescript
async function fetchWithRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof rumahlError && error.isRetryable() && attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`Retry attempt ${attempt + 1} after ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
  throw new Error('Max retries exceeded');
}

// Usage
const data = await fetchWithRetry(() => client.entities.list());
```

## Timeouts

### Request Timeouts

Prevent requests from hanging indefinitely:

```typescript
// Global timeout (default: 30 seconds)
const client = new rumahlClient({
  defaultTimeout: 30000
});

// Per-request timeout
await client.entities.list({ timeout: 5000 }); // 5 seconds

// Long-running operation
await client.appDatabase.execute(longQuery, params, {
  timeout: 120000 // 2 minutes
});
```

### Abort Controllers

Cancel requests programmatically:

```typescript
const controller = new AbortController();

// Start request
const promise = client.entities.list({ signal: controller.signal });

// Cancel after 5 seconds
setTimeout(() => controller.abort(), 5000);

try {
  const entities = await promise;
} catch (error) {
  if (error instanceof rumahlError && error.statusCode === 408) {
    console.log('Request was cancelled or timed out');
  }
}
```

## Circuit Breaker

The SDK includes a circuit breaker to prevent cascading failures:

### How It Works

1. **CLOSED**: Normal operation, requests proceed
2. **OPEN**: After 5 consecutive failures, circuit opens for 60 seconds
3. **HALF_OPEN**: After timeout, allows 2 test requests
4. **Success**: Returns to CLOSED after 2 successful requests

### Circuit Breaker States

```typescript
// Circuit breaker is automatic and transparent
// When open, you'll receive a 503 error:

try {
  await client.entities.list();
} catch (error) {
  if (error instanceof rumahlError && error.statusCode === 503) {
    console.log('Circuit breaker is open. Service may be down.');
    // Wait and retry later, or use cached data
  }
}
```

## Best Practices

### 1. Always Use Try-Catch

```typescript
// ❌ Bad: Unhandled promise rejection
client.entities.turnOn('light.bedroom');

// ✅ Good: Properly handled
try {
  await client.entities.turnOn('light.bedroom');
} catch (error) {
  console.error('Failed to turn on light:', error);
}
```

### 2. Validate Before Sending

```typescript
// ✅ Good: Validate inputs first
function updateAppConfig(config: Record<string, any>) {
  if (!config || Object.keys(config).length === 0) {
    throw new Error('Config cannot be empty');
  }

  return client.appConfig.update(config);
}
```

### 3. Use Timeouts for Long Operations

```typescript
// ✅ Good: Set appropriate timeouts
await client.appDatabase.execute(
  'SELECT * FROM large_table WHERE ...',
  [],
  { timeout: 60000 } // 1 minute for large query
);
```

### 4. Handle Specific Error Cases

```typescript
try {
  await client.entities.get(entityId);
} catch (error) {
  if (error instanceof rumahlError) {
    switch (error.statusCode) {
      case 404:
        console.log('Entity not found');
        return null;
      case 401:
        console.log('Not authenticated');
        redirectToLogin();
        break;
      default:
        console.error('Unexpected error:', error);
        showErrorNotification(error.message);
    }
  }
}
```

### 5. Don't Retry Non-Idempotent Operations

```typescript
// ❌ Bad: Retrying a POST that creates data
await client.appStorage.uploadFile(name, content, type, {
  retries: 3 // May create duplicates!
});

// ✅ Good: Disable retries for non-idempotent operations
await client.appStorage.uploadFile(name, content, type, {
  retries: 0
});
```

### 6. Log Errors with Context

```typescript
const client = new rumahlClient({
  onError: (error) => {
    // Include useful context for debugging
    logger.error('rumahl API Error', {
      message: error.message,
      statusCode: error.statusCode,
      path: error.path,
      method: error.method,
      appId: client.getAppId(),
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      context: error.context
    });
  }
});
```

### 7. Graceful Degradation

```typescript
async function loadEntities() {
  try {
    const entities = await client.entities.list();
    return entities;
  } catch (error) {
    if (error instanceof rumahlError && error.isRetryable()) {
      console.warn('Failed to load entities, using cached data');
      return getCachedEntities();
    }
    throw error;
  }
}
```

## Testing Error Handling

### Simulate Errors

```typescript
// Test timeout handling
const client = new rumahlClient({
  defaultTimeout: 1 // Very short timeout
});

try {
  await client.entities.list();
} catch (error) {
  console.log('Timeout error caught:', error);
}

// Test network errors
const client = new rumahlClient({
  baseUrl: 'http://non-existent-server:9999'
});

try {
  await client.entities.list();
} catch (error) {
  console.log('Network error caught:', error);
}
```

### Mock Error Responses

```typescript
// Using fetch mock library
jest.mock('global-fetch', () => ({
  fetch: jest.fn(() =>
    Promise.resolve({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error')
    })
  )
}));

// Test your error handling
const result = await myFunction();
expect(result).toBeNull(); // Handled gracefully
```

## Common Patterns

### Exponential Backoff

```typescript
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 5,
  baseDelay: number = 1000
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;

      const delay = baseDelay * Math.pow(2, i) + Math.random() * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('Unreachable');
}
```

### Retry with Timeout

```typescript
async function fetchWithTimeout<T>(
  fn: () => Promise<T>,
  timeout: number
): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new rumahlError('Timeout', 408, '', '', true)), timeout)
    )
  ]);
}
```

### Fallback Chain

```typescript
async function getData() {
  try {
    return await client.entities.list();
  } catch (error) {
    console.warn('Primary source failed, trying backup');

    try {
      return await backupClient.entities.list();
    } catch (backupError) {
      console.warn('Backup failed, using cache');
      return getCachedData();
    }
  }
}
```

## Troubleshooting

### Error: "Invalid app ID provided"

```typescript
// Ensure appId is set before making app-specific calls
client.setAppId('my-app-id');
await client.appStorage.listFiles();
```

### Error: "Circuit breaker is open"

Service is experiencing issues. Wait 60 seconds for circuit to reset or check service health.

### Error: "Request timeout"

Increase timeout for long-running operations:

```typescript
await client.entities.list({ timeout: 60000 });
```

### Error: "Network error: Unable to connect"

- Check rumahl is running
- Verify baseUrl is correct
- Check network connectivity

## Migration Guide

### From v1.x to v2.x

```typescript
// Old (v1.x)
const client = new rumahlClient('http://localhost:8126', 'api-key');

// New (v2.x)
const client = new rumahlClient({
  baseUrl: 'http://localhost:8126',
  apiKey: 'api-key'
});

// Old error handling
catch (error) {
  console.error(error.message);
}

// New error handling
catch (error) {
  if (error instanceof rumahlError) {
    console.error({
      message: error.message,
      statusCode: error.statusCode,
      retryable: error.isRetryable()
    });
  }
}
```

## Related Documentation

- [App Development Guide](./app-development.md)
- [API Reference](./api-reference.md)
- [Best Practices](./best-practices.md)
- [Security Guide](../security/app-security.md)
