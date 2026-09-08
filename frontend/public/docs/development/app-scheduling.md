# Scheduled Tasks Guide

Apps in rumahl can register recurring or one-shot scheduled tasks. The scheduler runs within the rumahl core and triggers a webhook or internal event when a task fires.

## Overview

Three schedule types are supported:

- **Cron** – Flexible scheduling using cron expressions (e.g., `"0 */2 * * *"` for every 2 hours)
- **Interval** – Fixed-interval scheduling (e.g., every 3600 seconds)
- **One-Shot** – Run once at a specific date/time

When a scheduled task fires, rumahl sends a POST request with the task payload to a configurable target.

## Declaring Default Schedules in the Manifest

```json
{
  "id": "my-app",
  "name": "My App",
  "version": "1.0.0",
  "type": "app",
  "schedules": {
    "default_schedules": [
      {
        "id": "hourly-sync",
        "name": "Hourly Data Sync",
        "schedule_type": "cron",
        "cron_expression": "0 * * * *",
        "payload": { "action": "sync_data" },
        "enabled": true,
        "max_retries": 3,
        "retry_delay_seconds": 60,
        "tags": ["sync", "data"]
      },
      {
        "id": "daily-cleanup",
        "name": "Daily Cleanup",
        "schedule_type": "interval",
        "interval_seconds": 86400,
        "payload": { "action": "cleanup" },
        "enabled": true,
        "max_retries": 2,
        "retry_delay_seconds": 300
      }
    ]
  }
}
```

## Required Permissions

| Permission | Description |
|------------|-------------|
| `AppScheduleCreate` | Create scheduled tasks |
| `AppScheduleRead` | View scheduled tasks and logs |
| `AppScheduleUpdate` | Update scheduled tasks |
| `AppScheduleDelete` | Delete scheduled tasks |

## API Reference

### Task Management

```typescript
// List all scheduled tasks
GET /api/apps/:app_id/schedules

// Create a new scheduled task
POST /api/apps/:app_id/schedules
{
  "name": "My Cron Task",
  "schedule_type": "cron",
  "cron_expression": "*/5 * * * *",
  "payload": { "action": "heartbeat" },
  "enabled": true,
  "max_retries": 3,
  "tags": ["monitoring"]
}

// Get a specific task
GET /api/apps/:app_id/schedules/:task_id

// Update a task
PUT /api/apps/:app_id/schedules/:task_id
{
  "enabled": false,
  "interval_seconds": 7200
}

// Delete a task
DELETE /api/apps/:app_id/schedules/:task_id
```

### Execution & Logs

```typescript
// Manually trigger a task
POST /api/apps/:app_id/schedules/:task_id/trigger

// Get execution logs
GET /api/apps/:app_id/schedules/:task_id/logs
```

## SDK Usage

```typescript
import rumahlClient from '@rumahl/sdk';

const client = new rumahlClient('http://rumahl.local:8126', 'your-api-key');
client.setAppId('my-app');

// Create a cron task
const task = await client.appScheduler.create({
  name: 'Fetch Weather',
  schedule_type: 'cron',
  cron_expression: '0 */2 * * *',
  payload: { city: 'Berlin' },
  tags: ['weather', 'external-api']
});

// Create an interval task
await client.appScheduler.create({
  name: 'Heartbeat',
  schedule_type: 'interval',
  interval_seconds: 300,
  payload: { status: 'alive' }
});

// Manually trigger
await client.appScheduler.trigger(task.id);

// View logs
const logs = await client.appScheduler.getLogs(task.id);
```

## Cron Expression Reference

```
┌───────────── minute (0 - 59)
│ ┌───────────── hour (0 - 23)
│ │ ┌───────────── day of month (1 - 31)
│ │ │ ┌───────────── month (1 - 12)
│ │ │ │ ┌───────────── day of week (0 - 6) (Sunday=0)
│ │ │ │ │
* * * * *
```

| Expression | Description |
|------------|-------------|
| `* * * * *` | Every minute |
| `*/5 * * * *` | Every 5 minutes |
| `0 * * * *` | Every hour |
| `0 */2 * * *` | Every 2 hours |
| `0 0 * * *` | Daily at midnight |
| `0 0 * * 0` | Weekly on Sunday midnight |
| `0 0 1 * *` | Monthly on the 1st |

## Best Practices

1. **Use descriptive names** – helps when viewing tasks in the admin panel
2. **Set appropriate retries** – brief failures shouldn't cascade
3. **Use tags** – group related tasks for easier management
4. **Keep payloads small** – payload is stored in the task metadata
5. **Monitor execution logs** – check for failed executions periodically
6. **Clean up one-shot tasks** – delete one-shot tasks after they fire
