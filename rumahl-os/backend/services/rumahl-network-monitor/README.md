# rumahl Network Monitor Service

The rumahl Network Monitor service provides network discovery and IP activity tracking for the rumahl ecosystem.

## Overview

This service:
- Monitors the local network to discover devices
- Tracks IP addresses with MAC addresses and hostnames
- Listens to ARP table changes for device discovery
- Maintains a database of all known network devices
- Tracks last activity timestamps for each device
- Can be enabled/disabled through the API (enabled by default)

## Features

### Network Discovery
- **ARP Table Scanning**: Reads system ARP table to discover active devices
- **Hostname Resolution**: Attempts to resolve hostnames for discovered IPs
- **MAC Address Tracking**: Stores MAC addresses for device identification
- **Activity Tracking**: Records first seen and last seen timestamps

### Device Management
- **Active/Inactive Status**: Marks devices as active or inactive based on recent activity
- **Automatic Updates**: Scans network every 60 seconds (configurable)
- **Database Persistence**: Stores all device information in PostgreSQL

### Privacy & Control
- **Configurable Monitoring**: Can be disabled in settings (default: enabled)
- **Manual Scans**: Trigger on-demand network scans via API
- **Statistics**: Get network statistics (total, active, inactive devices)

## API Endpoints

### Device Management

```bash
# Get all network devices
GET /api/network/devices

# Get only active devices
GET /api/network/devices/active

# Get network statistics
GET /api/network/stats
```

### Monitoring Control

```bash
# Get monitoring status
GET /api/network/monitoring

# Enable/disable monitoring
POST /api/network/monitoring
Content-Type: application/json

{
  "enabled": true
}

# Trigger manual network scan
POST /api/network/scan
```

### Health Check

```bash
GET /health
```

## Response Examples

### List Devices

```json
{
  "devices": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "ip_address": "192.168.1.100",
      "mac_address": "aa:bb:cc:dd:ee:ff",
      "hostname": "device.local",
      "vendor": null,
      "device_type": null,
      "first_seen": "2026-04-20T10:00:00Z",
      "last_seen": "2026-04-20T12:30:00Z",
      "is_active": true
    }
  ],
  "total": 15,
  "timestamp": "2026-04-20T12:30:00Z"
}
```

### Network Statistics

```json
{
  "total_devices": 25,
  "active_devices": 15,
  "inactive_devices": 10,
  "last_scan": "2026-04-20T12:30:00Z"
}
```

## Configuration

### Environment Variables

- `DATABASE_URL`: PostgreSQL connection string (default: `postgres://ora:ora@localhost/ora`)
- `RUST_LOG`: Log level (default: `rumahl_network_monitor=info`)

### Scan Interval

The service scans the network every 60 seconds. To change this, modify `SCAN_INTERVAL_SECS` in the source code.

## Database Schema

```sql
CREATE TABLE network_devices (
    id UUID PRIMARY KEY,
    ip_address VARCHAR(45) UNIQUE NOT NULL,
    mac_address VARCHAR(17),
    hostname VARCHAR(255),
    vendor VARCHAR(255),
    device_type VARCHAR(50),
    first_seen TIMESTAMP WITH TIME ZONE NOT NULL,
    last_seen TIMESTAMP WITH TIME ZONE NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true
);
```

### Indexes

- `idx_network_devices_ip` - Fast IP address lookups
- `idx_network_devices_active` - Filter by active status
- `idx_network_devices_last_seen` - Sort by last activity

## Port Allocation

The service runs on port **8099** and is accessible through NGINX at:

```
http://your-rumahl-instance/api/network/
```

## How It Works

### ARP Table Monitoring

On Linux systems, the service reads `/proc/net/arp` to discover devices:

1. Parses ARP table entries
2. Extracts IP and MAC addresses
3. Filters out incomplete entries
4. Attempts hostname resolution
5. Updates database with device information

### Active Device Tracking

- Devices found in the latest scan are marked as **active**
- Devices not found are marked as **inactive**
- Last seen timestamp is updated on each detection

### Scan Loop

```
Every 60 seconds:
├── Check if monitoring is enabled
├── Read ARP table
├── Resolve hostnames
├── Update database
│   ├── Insert new devices
│   ├── Update existing devices
│   └── Mark missing devices as inactive
└── Update last scan timestamp
```

## Privacy Considerations

- **Default Enabled**: Monitoring is enabled by default but can be disabled
- **Local Network Only**: Only monitors the local network segment
- **No Packet Inspection**: Only reads ARP table, doesn't capture packets
- **User Control**: Users can disable monitoring in settings

## Security

- **Read-only Access**: Only reads system ARP table
- **No Active Scanning**: Passive discovery only (no ping sweeps or port scans)
- **Rate Limited**: API endpoints are rate-limited through NGINX

## Requirements

- **Linux System**: Requires `/proc/net/arp` for ARP table reading
- **Network Access**: Must have access to local network interface
- **PostgreSQL**: Database for storing device information
- **Host Command**: Optional, for hostname resolution

## Running

```bash
# Development
cargo run

# Production
cargo build --release
./target/release/rumahl-network-monitor
```

## Troubleshooting

### No Devices Detected

- Check if monitoring is enabled: `GET /api/network/monitoring`
- Verify ARP table has entries: `cat /proc/net/arp`
- Check service logs for errors

### Permission Issues

- Ensure service has permission to read `/proc/net/arp`
- Check database connection permissions

### Performance

- Default scan interval is 60 seconds
- Database uses indexes for fast queries
- In-memory cache for recent devices

## Future Enhancements

- **DHCP Packet Capture**: Listen to DHCP requests in real-time
- **Vendor Detection**: MAC address vendor lookup
- **Device Type Detection**: Identify device types (phone, computer, IoT)
- **Network Mapping**: Visualize network topology
- **Alerts**: Notify on new device detection
- **Integration**: Connect with security monitoring

## Related Services

- **rumahl-security**: Can use network data for threat detection
- **rumahl-control**: Provides UI for network device management
- **rumahl-nginx**: Routes API requests to this service
