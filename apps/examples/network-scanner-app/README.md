# Network Scanner App

A complete example IORA app that demonstrates network scanning capabilities using the Rust SDK.

## Features

- 🔍 **Network Discovery** - Automatically discover devices on your local network
- 📊 **Device Tracking** - Track device status, hostnames, and MAC addresses
- 🔌 **Port Scanning** - Identify open ports on discovered devices
- 📱 **Dashboard Widget** - Display network status in IORA dashboard
- 🔔 **Notifications** - Alert when new devices join the network
- ⚙️ **Configurable** - Customize scan intervals and network ranges
- 🔒 **Secure** - Runs in isolated Docker container with permission controls

## Architecture

This app demonstrates several key IORA SDK features:

1. **Complete App Structure** - Full manifest, Docker configuration, and settings
2. **IORA API Integration** - Uses SDK to interact with IORA services
3. **Custom Pages** - Provides iframe-based dashboard
4. **Widget Development** - Includes a dashboard widget
5. **Permission Management** - Demonstrates proper permission usage
6. **Background Tasks** - Continuous network monitoring

## Building

```bash
cargo build --release
```

## Running Locally

```bash
# Set environment variables
export IORA_BASE_URL=http://localhost:8080
export IORA_API_KEY=your-api-key
export RUST_LOG=info

# Run the app
cargo run
```

The app will start on port 3000 and begin scanning the network.

## Installation in IORA

1. Package the app:
```bash
zip -r network-scanner.zip manifest.json Cargo.toml src/ icon.png
```

2. Upload to IORA App Store
3. Grant required permissions:
   - NetworkLocalAccess
   - NetworkScan
   - ReadEntities
   - StorageWrite/Read
   - SendNotifications
   - RegisterWidget

4. Configure settings in IORA:
   - Scan interval (default: 300 seconds)
   - Network range (default: 192.168.1.0/24)
   - Notification preferences

## API Endpoints

- `GET /health` - Health check
- `POST /api/scan` - Trigger immediate scan
- `GET /api/devices` - Get all discovered devices
- `GET /api/device/:ip` - Get specific device details
- `GET /widget.js` - Widget component
- `GET /` - Dashboard UI

## Configuration

Edit `manifest.json` to customize:

- **Network Range**: Change `network_range` in settings schema
- **Scan Interval**: Adjust `scan_interval` (in seconds)
- **Timeout**: Modify `scan_timeout` for slower networks
- **Notifications**: Enable/disable `notify_new_devices`

## Code Structure

```
network-scanner-app/
├── Cargo.toml          # Dependencies
├── manifest.json       # IORA app manifest
├── src/
│   ├── main.rs        # HTTP server and app logic
│   └── scanner.rs     # Network scanning implementation
└── README.md          # This file
```

## Key Implementation Details

### Network Scanning

The scanner module uses:
- `pnet` for network interface discovery
- `ipnetwork` for CIDR notation parsing
- TCP connect for port scanning
- ARP table lookup for MAC addresses
- DNS lookup for hostnames

### IORA SDK Usage

```rust
// Create IORA client
let client = iora_sdk::IoraClient::new(&iora_url)
    .with_api_key(api_key);

// Load app settings
let settings = client.settings().get("network-scanner").await?;

// Send notification
client.notifications().send(NotificationPayload {
    title: "New Device".to_string(),
    message: format!("Device {} joined the network", device.ip),
    priority: Some("normal".to_string()),
    icon: Some("network".to_string()),
}).await?;

// Store discovered devices
client.storage().set("devices", json!(devices)).await?;
```

### Background Scanning

The app runs continuous background scans:

```rust
tokio::spawn(async move {
    let mut interval = tokio::time::interval(Duration::from_secs(scan_interval));
    loop {
        interval.tick().await;
        // Perform scan
        let devices = scanner.scan().await?;
        // Update state and notify
    }
});
```

## Security Considerations

1. **Permission Control** - Requires explicit NetworkScan and NetworkLocalAccess permissions
2. **Container Isolation** - Runs in Docker container
3. **Network Restrictions** - Limited to local network access only
4. **Rate Limiting** - Configurable scan intervals prevent network flooding
5. **Secure Iframe** - Dashboard runs in sandboxed iframe

## Performance

- **Scan Time**: ~2-5 seconds for /24 network (254 IPs)
- **Memory**: ~50-100 MB
- **CPU**: Minimal, spikes during active scans
- **Network**: Light traffic, respects configured timeouts

## Troubleshooting

**No devices found:**
- Check network range in settings
- Verify firewall allows ping (ICMP)
- Ensure app has NetworkScan permission

**Slow scans:**
- Increase scan timeout in settings
- Reduce network range
- Check Docker container resources

**Missing MAC addresses:**
- ARP cache may be empty
- Try triggering device communication first
- Some devices may block ARP requests

## Learn More

- [IORA SDK Documentation](../../sdks/rust/README.md)
- [App Development Guide](../../docs/development/app-development.md)
- [Permission System](../../docs/development/permissions.md)

## License

MIT
