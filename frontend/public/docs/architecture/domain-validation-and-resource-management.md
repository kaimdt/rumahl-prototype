# IORA Domain Validation and Resource Management

This document describes two new system services added to IORA: Domain Validator and Resource Manager.

## Overview

Two major services have been implemented to enhance IORA's security and efficiency:

1. **IORA Domain Validator** - Enforces network access policies for apps with domain/IP whitelisting
2. **IORA Resource Manager** - Intelligently monitors and reallocates Docker container resources

---

## 1. IORA Domain Validator

### Purpose

The Domain Validator service acts as a network access control layer for IORA apps. It validates all external domain and IP access requests against app-specific whitelists, preventing unauthorized network access.

### Key Features

- **Domain Whitelisting** - Apps declare allowed domains in manifests
- **Wildcard Patterns** - Support for `*.example.com`, `api.*.example.com` patterns
- **IP/CIDR Validation** - Individual IPs and subnet ranges (e.g., `192.168.1.0/24`)
- **DNS Resolution** - Automatic hostname to IP resolution
- **User Extensions** - Optional user-defined domain/IP additions
- **Access Logging** - Complete audit trail of all validation attempts
- **Real-time Policy Updates** - Changes apply immediately without restart

### Service Details

- **Port**: 8100
- **NGINX Route**: `/api/domain-validator/`
- **Database**: PostgreSQL (2 tables: `app_network_policies`, `domain_access_logs`)
- **Dependencies**: `trust-dns-resolver`, `ipnetwork`, `regex`

### Wildcard Pattern Examples

```
*.example.com       → Matches: api.example.com, cdn.example.com
                     → Does NOT match: example.com

example.*           → Matches: example.com, example.net, example.org

api.*.example.com   → Matches: api.v1.example.com, api.v2.example.com
```

### CIDR Notation Examples

```
192.168.1.0/24      → Matches: 192.168.1.0 - 192.168.1.255
10.0.0.0/8          → Matches: 10.0.0.0 - 10.255.255.255
172.16.0.0/12       → Matches: 172.16.0.0 - 172.31.255.255
```

### App Manifest Configuration

```json
{
  "id": "weather-app",
  "network_access": {
    "allowed_domains": [
      "*.weather.com",
      "api.openweathermap.org"
    ],
    "allow_user_domains": true,
    "allowed_local_ips": [
      "192.168.1.0/24"
    ],
    "allow_user_local_ips": false,
    "allow_network_scan": false
  }
}
```

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/domain-validator/validate` | Validate domain/IP access |
| GET | `/api/domain-validator/policy/:app_id` | Get app network policy |
| POST | `/api/domain-validator/policy/:app_id/domains` | Add user domain |
| POST | `/api/domain-validator/policy/:app_id/ips` | Add user IP |
| GET | `/api/domain-validator/logs/:app_id` | Get access logs |

### Validation Flow

```
App Request
    ↓
POST /api/domain-validator/validate
    ↓
Load App Policy from Database
    ↓
Check Domain Against Patterns
    ↓ (if domain match fails)
Resolve Domain to IPs via DNS
    ↓
Check IPs Against Allowed Ranges
    ↓
Log Access Attempt
    ↓
Return Allow/Deny + Reason
```

### Security Features

1. **Default Deny** - All requests denied unless explicitly allowed
2. **Immutable Base Policy** - App-defined rules cannot be removed by users
3. **Optional User Extensions** - Apps must opt-in to user additions
4. **Complete Audit Trail** - All validation attempts logged with timestamps
5. **DNS Cache** - 5-minute TTL to prevent DNS abuse
6. **Pattern Validation** - User-added domains validated for proper format

---

## 2. IORA Resource Manager

### Purpose

The Resource Manager monitors all Docker container resource usage in real-time and dynamically adjusts CPU and memory allocations based on actual utilization patterns. This ensures optimal resource distribution across all IORA services and apps.

### Key Features

- **Real-time Monitoring** - Tracks CPU/memory usage every 30 seconds
- **Intelligent Reallocation** - Increases resources for overloaded containers
- **Resource Reclamation** - Reduces allocations for underutilized containers
- **Safety Limits** - Enforces minimum allocations to prevent service degradation
- **Allocation History** - Complete audit trail of all resource changes
- **Manual Triggers** - API endpoint for on-demand reallocation
- **System Overview** - Dashboard metrics for cluster-wide efficiency

### Service Details

- **Port**: 8101
- **NGINX Route**: `/api/resources/`
- **Database**: PostgreSQL (1 table: `resource_allocations`)
- **Dependencies**: `bollard` (Docker API), `sysinfo` (system monitoring)
- **Monitoring Interval**: 30 seconds

### Resource Reallocation Logic

#### Overutilized Containers (>80% usage)

When a container uses more than 80% of allocated resources:

- **CPU**: Increase by 50% → `new_cpu = current_cpu * 1.5`
- **Memory**: Increase by 30% → `new_memory = current_memory * 1.3`

**Example**:
```
Before: 1024 CPU shares, 512 MB RAM, 85% CPU usage
After:  1536 CPU shares, 665 MB RAM
Reason: High utilization (CPU: 85%, Memory: 82%)
```

#### Underutilized Containers (<30% usage)

When a container uses less than 30% of allocated resources:

- **CPU**: Reduce by 30% → `new_cpu = current_cpu * 0.7`
- **Memory**: Reduce by 20% → `new_memory = current_memory * 0.8`

**Example**:
```
Before: 2048 CPU shares, 1024 MB RAM, 20% CPU usage
After:  1434 CPU shares, 819 MB RAM
Reason: Low utilization (CPU: 20%, Memory: 18%)
```

#### Safety Minimums

- **Minimum CPU**: 512 shares (0.5 CPU core equivalent)
- **Minimum Memory**: 256 MB

No container will be reduced below these thresholds, ensuring stable operation.

### Utilization Categories

| Category | CPU/Memory Usage | Action |
|----------|-----------------|--------|
| **Optimal** | 30-80% | No changes |
| **Overutilized** | >80% | Increase resources |
| **Underutilized** | <30% | Reduce resources |

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/resources/containers` | Get all container resource stats |
| GET | `/api/resources/system` | Get system-wide overview |
| POST | `/api/resources/reallocate` | Trigger manual reallocation |
| GET | `/api/resources/history` | Get allocation history |

### Monitoring Loop

```
Every 30 seconds:
    ↓
List All IORA Containers
    ↓
Fetch Docker Stats (CPU, Memory)
    ↓
Calculate Utilization %
    ↓
Identify Overutilized (>80%)
    ↓
Identify Underutilized (<30%)
    ↓
Calculate New Resource Limits
    ↓
Apply Via Docker API
    ↓
Log Changes to Database
```

### Example Scenarios

#### Scenario 1: Weather App Under Load

**Initial State**:
- CPU: 1024 shares, Usage: 90%
- Memory: 512 MB, Usage: 88%

**Action**: Both CPU and memory overutilized
- New CPU: 1536 shares (+50%)
- New Memory: 665 MB (+30%)

**Result**: App has headroom to handle increased traffic

#### Scenario 2: Idle Watchdog Service

**Initial State**:
- CPU: 2048 shares, Usage: 15%
- Memory: 1024 MB, Usage: 20%

**Action**: Both CPU and memory underutilized
- New CPU: 1434 shares (-30%)
- New Memory: 819 MB (-20%)

**Result**: Freed resources available for other containers

#### Scenario 3: Optimal Core Service

**Initial State**:
- CPU: 1024 shares, Usage: 55%
- Memory: 512 MB, Usage: 62%

**Action**: No changes (within 30-80% optimal range)

**Result**: Resources remain stable

---

## Integration Architecture

### System Integration

```
┌─────────────────────────────────────────────────┐
│              IORA NGINX (Port 80)               │
│  Routes: /api/domain-validator/, /api/resources/│
└─────────┬─────────────────────────┬─────────────┘
          │                         │
          ↓                         ↓
┌──────────────────────┐  ┌──────────────────────┐
│  Domain Validator    │  │  Resource Manager    │
│     Port 8100        │  │     Port 8101        │
│                      │  │                      │
│ • Policy Validation  │  │ • Docker Monitoring  │
│ • DNS Resolution     │  │ • Resource Realloc   │
│ • Access Logging     │  │ • History Tracking   │
└──────────┬───────────┘  └──────────┬───────────┘
           │                         │
           ↓                         ↓
      PostgreSQL                 PostgreSQL
   (Network Policies)         (Allocations Log)
```

### Service Dependencies

**Domain Validator**:
- PostgreSQL (policy storage, access logs)
- DNS resolver (hostname lookups)
- App Store (loads manifest policies)

**Resource Manager**:
- Docker Engine API (container stats, resource updates)
- PostgreSQL (allocation history)
- System monitoring (overall resource availability)

---

## Database Schemas

### Domain Validator Tables

#### app_network_policies
```sql
CREATE TABLE app_network_policies (
    id UUID PRIMARY KEY,
    app_id VARCHAR(255) UNIQUE NOT NULL,
    allowed_domains TEXT[] NOT NULL DEFAULT '{}',
    allow_user_domains BOOLEAN NOT NULL DEFAULT false,
    allowed_local_ips TEXT[] NOT NULL DEFAULT '{}',
    allow_user_local_ips BOOLEAN NOT NULL DEFAULT false,
    allow_network_scan BOOLEAN NOT NULL DEFAULT false,
    user_added_domains TEXT[] NOT NULL DEFAULT '{}',
    user_added_ips TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL
);
```

#### domain_access_logs
```sql
CREATE TABLE domain_access_logs (
    id UUID PRIMARY KEY,
    app_id VARCHAR(255) NOT NULL,
    domain VARCHAR(255) NOT NULL,
    ip_address VARCHAR(45),
    allowed BOOLEAN NOT NULL,
    reason TEXT NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL
);
```

### Resource Manager Table

#### resource_allocations
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

---

## Configuration

### Domain Validator

**Environment Variables**:
```bash
DATABASE_URL=postgresql://user:pass@localhost/iora
RUST_LOG=info
BIND_ADDRESS=127.0.0.1:8100
DNS_CACHE_TTL=300  # seconds
```

### Resource Manager

**Environment Variables**:
```bash
DATABASE_URL=postgresql://user:pass@localhost/iora
DOCKER_HOST=unix:///var/run/docker.sock
RUST_LOG=info
BIND_ADDRESS=127.0.0.1:8101
MONITORING_INTERVAL=30  # seconds
```

**Tunable Constants** (in `src/main.rs`):
```rust
const MONITORING_INTERVAL_SECS: u64 = 30;
const REALLOCATION_THRESHOLD: f64 = 0.3;  // 30% unused
const HIGH_UTILIZATION_THRESHOLD: f64 = 0.8;  // 80% used
const DEFAULT_CPU_SHARES: u64 = 1024;
const DEFAULT_MEMORY_BYTES: i64 = 512 * 1024 * 1024;
const MIN_CPU_SHARES: u64 = 512;
const MIN_MEMORY_BYTES: i64 = 256 * 1024 * 1024;
```

---

## Performance Considerations

### Domain Validator

- **In-memory Policy Cache**: Policies loaded at startup for fast lookups
- **DNS Caching**: 5-minute TTL reduces external DNS queries
- **Async Operations**: Non-blocking validation for high throughput
- **Database Indexing**: Indexed queries for log retrieval
- **Expected Load**: 100-1000 validations/second per app

### Resource Manager

- **Monitoring Overhead**: ~1-2% CPU for stats collection
- **Reallocation Speed**: Instant (no container restart required)
- **Memory Footprint**: ~50 MB for service itself
- **Database Load**: ~4 queries/minute (monitoring + logging)
- **Docker API**: Minimal load (stats streaming, batch updates)

---

## Security Considerations

### Domain Validator

1. **Default Deny Policy** - All access denied unless explicitly allowed
2. **Immutable App Rules** - Base policies cannot be modified by users
3. **Audit Logging** - Complete trail of all validation attempts
4. **DNS Security** - Protects against DNS rebinding attacks
5. **Pattern Validation** - Prevents malicious wildcard patterns

### Resource Manager

1. **Docker Socket Access** - Requires privileged access to Docker daemon
2. **Resource Limits** - Cannot exceed host system constraints
3. **Minimum Enforcements** - Prevents resource starvation attacks
4. **Audit Trail** - All changes logged for compliance
5. **Rollback Capability** - Can revert problematic allocations

---

## Troubleshooting

### Domain Validator Issues

**Problem**: Domain always denied
- Check policy: `GET /api/domain-validator/policy/:app_id`
- Verify wildcard pattern is correct: `*.example.com`
- Check DNS resolution for domain

**Problem**: User cannot add domain
- Verify `allow_user_domains: true` in policy
- Check domain format (no spaces, valid TLD)
- Review validation error message

### Resource Manager Issues

**Problem**: Container always overutilized
- Possible memory leak in app
- Increase default allocations in constants
- Check app logs for resource usage patterns

**Problem**: Reallocation fails
- Check Docker daemon: `systemctl status docker`
- Verify container is running: `docker ps`
- Review service logs for Docker API errors

**Problem**: Resources not released
- Check if usage is fluctuating around 30% threshold
- Verify monitoring loop is running
- Ensure database connection is active

---

## Monitoring and Alerts

### Recommended Alerts

**Domain Validator**:
- High rate of denied requests (possible attack)
- DNS resolution failures
- Database connection issues
- Policy loading errors

**Resource Manager**:
- Repeated resource increases for same container (memory leak)
- Reallocation failures (Docker API errors)
- System resource exhaustion
- Container thrashing (oscillating between increase/decrease)

### Metrics to Track

**Domain Validator**:
- Validation requests per second
- Allow/deny ratio per app
- DNS resolution latency
- Policy cache hit rate

**Resource Manager**:
- Average CPU/memory utilization across all containers
- Number of reallocation events per hour
- Containers in overutilized/optimal/underutilized states
- System-wide resource availability

---

## Migration Guide

### Existing Deployments

1. **Add Services to Workspace**: Both services already added to `backend/Cargo.toml`
2. **NGINX Configuration**: Routes already added to template
3. **Database Schemas**: Run migrations to create tables
4. **App Manifests**: Update with `network_access` configuration
5. **Docker Socket**: Ensure resource manager has socket access

### New Deployments

- All features available out of the box
- Use manifest format with network_access section
- Resource manager starts monitoring immediately

---

## Future Enhancements

### Domain Validator

- [ ] Geographical IP blocking
- [ ] Time-based access windows
- [ ] Bandwidth throttling per domain
- [ ] Machine learning for anomaly detection
- [ ] Certificate pinning for HTTPS domains

### Resource Manager

- [ ] Predictive scaling based on historical patterns
- [ ] Multi-host resource pooling
- [ ] GPU resource management
- [ ] Custom allocation strategies per app
- [ ] Integration with Kubernetes resource quotas

---

## Related Documentation

- [Network Access Control](NETWORK_ACCESS_AND_DOCUMENTATION_SUMMARY.md)
- [Port Management](PORT_MANAGEMENT_AND_SYSTEM_ENHANCEMENTS.md)
- [App Manifest Schema](../backend/iora-shared/src/app_manifest.rs)
- [Domain Validator README](../backend/iora-domain-validator/README.md)
- [Resource Manager README](../backend/iora-resource-manager/README.md)
- [Security Best Practices](security/best-practices.md)

---

## Support

For issues or questions:
1. Check service logs: `journalctl -u iora-domain-validator` or `iora-resource-manager`
2. Review API responses for error details
3. Check database connectivity and schema
4. Consult README files for each service
5. Submit issues on IORA repository

---

**Implementation Date**: 2026-04-20
**Services Status**: ✅ Implemented and integrated
**Branch**: `claude/add-encryption-and-monitoring-programs`
