# IORA Resource Manager

The Resource Manager service monitors Docker container resource usage and intelligently reallocates CPU and memory resources based on actual utilization patterns. It ensures efficient resource distribution across all IORA services and apps.

## Features

- **Real-time Monitoring** - Tracks CPU and memory usage for all containers
- **Intelligent Reallocation** - Dynamically adjusts resource limits based on usage
- **Utilization Analysis** - Calculates actual usage vs allocated resources
- **Threshold-based Actions** - Increases resources for overloaded containers, reduces for underutilized
- **Safety Limits** - Enforces minimum resource allocations to prevent service degradation
- **Allocation History** - Logs all resource changes for auditing and analysis
- **Manual Triggers** - API endpoint for on-demand reallocation

## Port

- **Service Port**: 8101
- **NGINX Route**: `/api/resources/`

## How It Works

### Monitoring Loop

Every 30 seconds, the service:
1. Fetches stats for all running IORA containers
2. Calculates CPU and memory utilization percentages
3. Identifies overutilized (>80%) and underutilized (<30%) containers
4. Adjusts resource limits accordingly
5. Logs all changes to database

### Reallocation Logic

#### Overutilized Containers (>80% usage)

When a container uses more than 80% of its allocated resources:
- **CPU**: Increase by 50% of current allocation
- **Memory**: Increase by 30% of current allocation

Example: Container with 1024 CPU shares at 85% usage → 1536 CPU shares

#### Underutilized Containers (<30% usage)

When a container uses less than 30% of its allocated resources:
- **CPU**: Reduce to 70% of current allocation
- **Memory**: Reduce to 80% of current allocation

Example: Container with 2048 CPU shares at 20% usage → 1434 CPU shares

#### Safety Limits

Enforced minimums to prevent service degradation:
- **Minimum CPU**: 512 shares (0.5 CPU cores equivalent)
- **Minimum Memory**: 256 MB
- **Maximum CPU**: No hard limit (grows with demand)
- **Maximum Memory**: No hard limit (grows with demand)

## Database Schema

### resource_allocations

Logs all resource allocation changes.

```sql
CREATE TABLE resource_allocations (
    id UUID PRIMARY KEY,
    container_id VARCHAR(255) NOT NULL,
    container_name VARCHAR(255) NOT NULL,
    app_id VARCHAR(255),
    old_cpu_shares BIGINT NOT NULL,
    new_cpu_shares BIGINT NOT NULL,
    old_memory_bytes BIGINT NOT NULL,
    new_memory_bytes BIGINT NOT NULL,
    reason TEXT NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL
);
```

## API Endpoints

### GET /api/resources/containers

Get resource usage for all containers.

**Response**:
```json
{
  "containers": [
    {
      "container_id": "abc123",
      "container_name": "iora-core",
      "app_id": null,
      "cpu_shares": 1024,
      "memory_limit_bytes": 536870912,
      "cpu_usage_percent": 45.2,
      "memory_usage_bytes": 402653184,
      "memory_usage_percent": 75.0,
      "cpu_utilization": 0.452,
      "memory_utilization": 0.750,
      "last_updated": "2026-04-20T12:00:00Z"
    }
  ],
  "total_containers": 15,
  "timestamp": "2026-04-20T12:00:00Z"
}
```

### GET /api/resources/system

Get system-wide resource overview.

**Response**:
```json
{
  "total_cpu_shares": 15360,
  "total_memory_bytes": 8589934592,
  "average_cpu_utilization": 0.52,
  "average_memory_utilization": 0.68,
  "overutilized_containers": 3,
  "underutilized_containers": 5,
  "optimal_containers": 7,
  "timestamp": "2026-04-20T12:00:00Z"
}
```

### POST /api/resources/reallocate

Trigger manual resource reallocation (bypasses automatic interval).

**Response**:
```json
{
  "success": true,
  "message": "Resource reallocation completed",
  "changes": [
    {
      "container_name": "iora-core",
      "old_cpu_shares": 1024,
      "new_cpu_shares": 1536,
      "old_memory_bytes": 536870912,
      "new_memory_bytes": 697932390,
      "reason": "High utilization (CPU: 85%, Memory: 82%)"
    }
  ],
  "timestamp": "2026-04-20T12:00:00Z"
}
```

### GET /api/resources/history

Get resource allocation history.

**Query Parameters**:
- `container_id` (optional): Filter by container ID
- `app_id` (optional): Filter by app ID
- `limit` (optional): Number of records (default: 100, max: 1000)
- `since` (optional): ISO 8601 timestamp to filter from

**Response**:
```json
{
  "allocations": [
    {
      "id": "uuid",
      "container_id": "abc123",
      "container_name": "iora-core",
      "app_id": null,
      "old_cpu_shares": 1024,
      "new_cpu_shares": 1536,
      "old_memory_bytes": 536870912,
      "new_memory_bytes": 697932390,
      "reason": "High utilization (CPU: 85%, Memory: 82%)",
      "timestamp": "2026-04-20T12:00:00Z"
    }
  ],
  "total": 245
}
```

## Resource Utilization Categories

### Optimal (30-80% usage)
- No changes made
- Container is efficiently using allocated resources

### Overutilized (>80% usage)
- Resources increased to prevent performance degradation
- Logged as "High utilization"

### Underutilized (<30% usage)
- Resources reduced to free up capacity for other containers
- Logged as "Low utilization"

## Configuration

### Monitoring Interval

Defined in `src/main.rs`:
```rust
const MONITORING_INTERVAL_SECS: u64 = 30; // Check every 30 seconds
```

### Thresholds

```rust
const REALLOCATION_THRESHOLD: f64 = 0.3; // 30% unused triggers reduction
const HIGH_UTILIZATION_THRESHOLD: f64 = 0.8; // 80% usage triggers increase
```

### Default Resources

```rust
const DEFAULT_CPU_SHARES: u64 = 1024; // 1 CPU core equivalent
const DEFAULT_MEMORY_BYTES: i64 = 512 * 1024 * 1024; // 512 MB
```

### Safety Minimums

```rust
const MIN_CPU_SHARES: u64 = 512; // 0.5 CPU core
const MIN_MEMORY_BYTES: i64 = 256 * 1024 * 1024; // 256 MB
```

## Docker Integration

The service uses the `bollard` crate to interact with the Docker Engine API:

1. **List Containers**: Filters for IORA containers (prefix: `iora-`)
2. **Get Stats**: Streams real-time CPU/memory usage
3. **Update Resources**: Modifies CPU shares and memory limits via Docker API
4. **Container Inspection**: Retrieves current resource allocations

## Example Scenarios

### Scenario 1: App Under Heavy Load

**Before**:
- `weather-app`: 1024 CPU shares, 512 MB RAM
- Usage: 90% CPU, 88% memory

**Action**:
- Increase CPU to 1536 shares (+50%)
- Increase memory to 665 MB (+30%)

**Result**: App has headroom for continued operation

### Scenario 2: Idle Service

**Before**:
- `iora-watchdog`: 2048 CPU shares, 1024 MB RAM
- Usage: 15% CPU, 20% memory

**Action**:
- Reduce CPU to 1434 shares (-30%)
- Reduce memory to 819 MB (-20%)

**Result**: Freed resources available for other containers

### Scenario 3: Balanced System

**Before**:
- `iora-core`: 1024 CPU shares, 512 MB RAM
- Usage: 55% CPU, 62% memory

**Action**: No changes (within optimal range)

**Result**: Resources remain stable

## Performance Impact

- **Monitoring Overhead**: Minimal (~1-2% CPU) for stats collection
- **Reallocation Speed**: Instant via Docker API (no container restart)
- **Memory Usage**: ~50 MB for service itself
- **Database Load**: ~4 queries per minute (monitoring + logging)

## Integration with Other Services

- **iora-appstore**: Notified when app containers need more resources during installation
- **iora-supervisor**: Coordinates with supervisor for container lifecycle management
- **iora-watchdog**: Alerted when resource reallocation fails or limits reached
- **iora-nginx**: Not affected by resource changes (proxies remain stable)

## Monitoring and Alerts

### When to Alert

1. **Repeated Increases**: Container continuously needs more resources (possible memory leak)
2. **Reallocation Failures**: Docker API errors when updating container
3. **Resource Exhaustion**: System cannot provide requested increases
4. **Thrashing**: Container oscillates between increase/decrease

### Dashboard Integration

The Resource Manager can feed data to monitoring dashboards:
- Real-time resource utilization graphs
- Historical allocation trends
- Container health scores
- System-wide efficiency metrics

## Troubleshooting

### Container Always Overutilized

**Possible Causes**:
1. Application has memory leak
2. Workload legitimately requires more resources
3. Minimum limits too low for workload

**Solutions**:
1. Investigate app logs for memory leaks
2. Increase default resource allocations
3. Set higher minimum limits for specific containers

### Reallocation Fails

**Possible Causes**:
1. Docker daemon not responding
2. Container in restart loop
3. Insufficient system resources

**Solutions**:
1. Check Docker service status: `systemctl status docker`
2. Review container logs
3. Monitor system resources with `docker stats`

### Resources Not Released

**Possible Causes**:
1. Container usage fluctuating around 30% threshold
2. Reallocation loop not running
3. Database connection lost

**Solutions**:
1. Adjust thresholds in configuration
2. Check service logs for errors
3. Verify PostgreSQL connection

## Environment Variables

- `DATABASE_URL` - PostgreSQL connection string
- `DOCKER_HOST` - Docker socket path (default: `unix:///var/run/docker.sock`)
- `RUST_LOG` - Logging level (default: `info`)
- `BIND_ADDRESS` - Service bind address (default: `127.0.0.1:8101`)
- `MONITORING_INTERVAL` - Override default 30s interval (seconds)

## Security Considerations

1. **Docker Socket Access** - Service requires access to Docker socket (privileged operation)
2. **Resource Limits** - Cannot exceed system-wide resource constraints
3. **Minimum Enforcements** - Prevents DoS by ensuring minimum allocations
4. **Audit Trail** - All changes logged for compliance and troubleshooting

## Further Reading

- [Port Management Documentation](../../docs/PORT_MANAGEMENT_AND_SYSTEM_ENHANCEMENTS.md)
- [Docker Resource Constraints](https://docs.docker.com/config/containers/resource_constraints/)
- [System Enhancements Summary](../../docs/SYSTEM_ENHANCEMENTS_SUMMARY.md)
