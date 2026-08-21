# Testing & Debugging

Guide for testing and debugging rumahl apps and plugins.

## Table of Contents

- [Local Testing](#local-testing)
- [Testing in rumahl](#testing-in-ora)
- [Debugging Tools](#debugging-tools)
- [Logging](#logging)
- [Common Testing Scenarios](#common-testing-scenarios)
- [Performance Testing](#performance-testing)

## Local Testing

### App Testing (Docker)

Test your app container locally before installing in rumahl:

```bash
# Build the Docker image
cd my-app
docker build -t my-app:test .

# Run the container
docker run -p 3000:3000 \
  -e NODE_ENV=development \
  -e LOG_LEVEL=debug \
  my-app:test

# Test endpoints
curl http://localhost:3000/health
curl http://localhost:3000/api/hello
```

### Plugin Testing (Node.js)

Test your plugin code locally:

```javascript
// test.js – Run with: node test.js
const plugin = require('./plugin');

async function test() {
  // Test with sample input
  const result = await plugin.execute({ name: 'Test' });
  console.log('Result:', result);

  // Validate output
  console.assert(result.greeting, 'Missing greeting');
  console.assert(result.timestamp, 'Missing timestamp');

  // Test edge cases
  const emptyResult = await plugin.execute({});
  console.log('Empty input result:', emptyResult);
}

test().catch(console.error);
```

### Plugin Testing (Python)

```python
# test.py
import json
from main import execute

def test():
    # Test normal input
    result = execute({'name': 'Test'})
    print('Result:', json.dumps(result, indent=2))
    assert 'greeting' in result

    # Test edge cases
    empty_result = execute({})
    print('Empty input:', json.dumps(empty_result, indent=2))

if __name__ == '__main__':
    test()
```

### Integration Test Script

```bash
#!/bin/bash
# test-endpoints.sh – Test all app endpoints

BASE_URL="http://localhost:3000"

echo "Testing $BASE_URL..."

# Health check
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/health")
if [ "$HEALTH" = "200" ]; then
  echo "✅ Health check: OK"
else
  echo "❌ Health check: $HEALTH"
fi

# API endpoint
API=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/hello")
if [ "$API" = "200" ]; then
  echo "✅ API endpoint: OK"
else
  echo "❌ API endpoint: $API"
fi

# Check response content
curl -s "$BASE_URL/api/hello" | jq .
```

## Testing in rumahl

### Installation Testing

1. Package your app as ZIP
2. Install via Control Center → App Store → Install Custom App
3. Review and accept permissions
4. Monitor the installation job:
   ```http
   GET /api/appstore/jobs/stream
   ```

### Runtime Testing

Once installed, test through the proxy:

```bash
# Get app status
curl http://localhost:8126/api/supervisor/apps/my-app

# Access app through proxy
curl http://localhost:8126/api/apps/my-app/proxy/

# Check app configuration
curl http://localhost:8126/api/apps/my-app/config

# Update settings
curl -X PUT http://localhost:8126/api/apps/my-app/config \
  -H "Content-Type: application/json" \
  -d '{"api_key": "test-key"}'
```

### Permission Testing

Test with reduced permissions:

```bash
# Create a test API key with limited permissions
curl -X POST http://localhost:8091/api/control/api-keys \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Key",
    "permissions": ["ReadEntities"]
  }'

# Use the test key for API calls
curl -H "X-API-Key: test-key-here" \
  http://localhost:8126/api/states
```

## Debugging Tools

### View App Logs

```bash
# Get recent logs
curl http://localhost:8126/api/apps/my-app/logs?tail=50

# Stream live logs (SSE)
curl -N http://localhost:8126/api/apps/my-app/logs/stream
```

### Container Debugging

```bash
# Get container ID
CONTAINER=$(docker ps -q --filter "name=rumahl-app-my-app")

# View container logs
docker logs -f $CONTAINER

# Execute command in container
docker exec -it $CONTAINER sh

# Check environment variables
docker exec $CONTAINER env

# Check network
docker exec $CONTAINER nslookup api.example.com
```

### API Debugging with Swagger

Access interactive API docs:
```
http://localhost:8126/api/docs
```

Use Swagger UI to:
- Browse all endpoints
- Try API calls with authentication
- View request/response schemas
- Test error scenarios

### Plugin Debugging

```bash
# Check plugin status
curl http://localhost:8090/api/core/plugins/my-plugin

# Check sandbox status
curl http://localhost:8090/api/core/sandbox/status

# Execute plugin with verbose logging
curl -X POST http://localhost:8090/api/core/plugins/my-plugin/execute \
  -H "Content-Type: application/json" \
  -d '{"input": {"test": true}, "timeout_ms": 10000}'

# View plugin execution logs
curl http://localhost:8090/api/core/plugins/my-plugin/logs
```

## Logging

### App Logging Best Practices

```javascript
// Use structured logging
console.log(JSON.stringify({
  level: 'info',
  message: 'User action completed',
  timestamp: new Date().toISOString(),
  data: { user_id: '123', action: 'save' }
}));

// Log errors with context
try {
  await riskyOperation();
} catch (error) {
  console.error(JSON.stringify({
    level: 'error',
    message: error.message,
    stack: error.stack,
    context: { operation: 'sync', user_id: '123' }
  }));
}
```

### Log Levels

Use appropriate log levels:

| Level | When to Use |
|-------|-------------|
| `DEBUG` | Detailed diagnostic information |
| `INFO` | Normal operational events |
| `WARNING` | Unexpected but non-critical events |
| `ERROR` | Errors that need attention |
| `CRITICAL` | System-critical failures |

### Viewing Logs in rumahl

```http
# API
GET /api/apps/{app_id}/logs?tail=100&level=error

# SSE stream
GET /api/apps/{app_id}/logs/stream

# Filter by source
GET /api/apps/{app_id}/logs?source=system
```

## Common Testing Scenarios

### Test: App Startup

```bash
# 1. Install app
# 2. Check container is running
docker ps | grep rumahl-app-my-app

# 3. Wait for health check
sleep 20

# 4. Verify health
curl http://localhost:8126/api/apps/my-app/proxy/health
```

### Test: App Settings Update

```bash
# 1. Get current config
curl http://localhost:8126/api/apps/my-app/config

# 2. Update a setting
curl -X PUT http://localhost:8126/api/apps/my-app/config \
  -H "Content-Type: application/json" \
  -d '{"refresh_interval": 120}'

# 3. Verify the update
curl http://localhost:8126/api/apps/my-app/config | jq .refresh_interval

# 4. Reset to default
curl -X DELETE http://localhost:8126/api/apps/my-app/config/refresh_interval
```

### Test: Storage Operations

```bash
# 1. Upload a file
curl -X POST http://localhost:8126/api/apps/my-app/storage/files \
  -H "Content-Type: application/json" \
  -d '{"name": "test.json", "mime_type": "application/json", "content": "eyJrZXkiOiAidmFsdWUifQ=="}'

# 2. List files
curl http://localhost:8126/api/apps/my-app/storage/files

# 3. Download file
curl http://localhost:8126/api/apps/my-app/storage/files/{file_id}
```

### Test: Database Operations

```bash
# 1. Provision database
curl -X POST http://localhost:8126/api/apps/my-app/database/provision \
  -H "Content-Type: application/json" \
  -d '{"init_sql": ["CREATE TABLE IF NOT EXISTS test (id INTEGER PRIMARY KEY, value TEXT)"]}'

# 2. Execute query
curl -X POST http://localhost:8126/api/apps/my-app/database/execute \
  -H "Content-Type: application/json" \
  -d '{"sql": "INSERT INTO test (value) VALUES (?)", "params": ["hello"]}'

# 3. Query data
curl -X POST http://localhost:8126/api/apps/my-app/database/execute \
  -H "Content-Type: application/json" \
  -d '{"sql": "SELECT * FROM test"}'
```

## Performance Testing

### Load Testing with wrk

```bash
# Install wrk
brew install wrk  # macOS
apt install wrk   # Debian/Ubuntu

# Test health endpoint
wrk -t4 -c100 -d30s http://localhost:8126/health

# Test with authentication
wrk -t4 -c100 -d30s -H "Authorization: Bearer $TOKEN" \
  http://localhost:8126/api/states
```

### Memory Usage

```bash
# Monitor container memory
watch -n 2 'docker stats --no-stream --format "table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}"'

# Check app storage usage
curl http://localhost:8126/api/apps/my-app/storage/usage
```

### Response Time

```bash
# Measure API response time
curl -w "\nTotal: %{time_total}s\nConnect: %{time_connect}s\nTTFB: %{time_starttransfer}s\n" \
  -o /dev/null -s http://localhost:8126/api/states
```

## Debugging Checklist

Before reporting a bug:

- [ ] Check app logs: `GET /api/apps/{id}/logs`
- [ ] Check container status: `docker ps | grep rumahl-app-`
- [ ] Check health endpoint: `curl http://localhost:8126/api/apps/{id}/proxy/health`
- [ ] Verify permissions: `GET /api/appstore/apps/{id}/permissions`
- [ ] Check network access: Verify domains are in whitelist
- [ ] Test with minimal configuration
- [ ] Check for JavaScript errors in browser console
- [ ] Review recent changes to manifest or code

## Related Documentation

- [App Development Guide](app-development.md) – Creating apps
- [Plugin Development Guide](plugin-development.md) – Creating plugins
- [Troubleshooting Guide](../guides/troubleshooting.md) – Common issues
- [Error Handling Guide](error-handling-guide.md) – SDK error handling
