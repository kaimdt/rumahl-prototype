# rumahl App Manifests

This directory contains app manifests for the rumahl App Store.

## Available Apps

### Home Assistant (`homeassistant.json`)

Open source home automation platform with full rumahl integration.

**Features:**
- Complete Home Assistant installation
- Real-time entity state synchronization via WebSocket
- Dashboard widgets for entities, lights, climate control
- Direct integration with rumahl smart home features
- Auto-discovery of devices on local network

**Requirements:**
- rumahl OS with rumahl-supervisor (recommended)
- 2GB+ RAM
- 8GB+ disk space

**Installation:**
```bash
# Via rumahl App Store (rumahl OS only)
# Navigate to App Store > Smart Home > Home Assistant > Install

# Manual installation (both methods)
curl -X POST http://localhost:8098/api/appstore/install \
  -H "Content-Type: application/json" \
  -d @apps/homeassistant.json
```

### Tailscale (`tailscale.json`)

Zero-config VPN for secure remote access to your rumahl system.

**Features:**
- Secure remote access without port forwarding
- Mesh network across all your devices
- Optional subnet routing
- Optional exit node functionality
- Tailscale SSH support

**Requirements:**
- rumahl OS with rumahl-supervisor (recommended)
- Tailscale account (free tier available)
- Authentication key from Tailscale admin console

**Installation:**
```bash
# Via rumahl App Store (rumahl OS only)
# Navigate to App Store > Network & Security > Tailscale > Install

# Manual installation (both methods)
curl -X POST http://localhost:8098/api/appstore/install \
  -H "Content-Type: application/json" \
  -d @apps/tailscale.json
```

## App Manifest Schema

See `backend/rumahl-shared/src/app_manifest.rs` for the complete manifest schema.

### Key Fields

- `id`: Unique identifier for the app
- `name`: Human-readable name
- `version`: Semantic version (e.g., "1.0.0")
- `developer`: App developer/author
- `description`: Short description
- `type`: "app" or "plugin"
- `permissions`: Required permissions (NetworkAccess, FileSystem, etc.)
- `docker`: Docker configuration (image, ports, volumes, etc.)
- `settings_schema`: Settings fields for user configuration
- `widgets`: Dashboard widgets provided by the app
- `custom_pages`: Custom pages to add to rumahl navigation

## Creating New Apps

### 1. Create App Manifest

Create a JSON file following the schema in `app_manifest.rs`:

```json
{
  "id": "my-app",
  "name": "My App",
  "version": "1.0.0",
  "developer": "Your Name",
  "description": "Description of your app",
  "type": "app",
  "permissions": ["NetworkAccess"],
  "docker": {
    "auto_build": false,
    "image": "your-image:latest",
    "internal_ports": [
      {"port": 3000, "protocol": "tcp"}
    ]
  }
}
```

### 2. Test Installation

```bash
# Install locally
curl -X POST http://localhost:8098/api/appstore/install \
  -H "Content-Type: application/json" \
  -d @apps/my-app.json

# Check status
curl http://localhost:8098/api/appstore/installed

# Uninstall
curl -X DELETE http://localhost:8098/api/appstore/uninstall/my-app
```

### 3. Submit to App Store

Once tested, submit your app manifest to the rumahl App Store:

```bash
# Submit to appstore.rumahl.com
curl -X POST https://appstore.rumahl.com/api/submit \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d @apps/my-app.json
```

## Installation Methods

### rumahl OS (Recommended)

On rumahl OS, apps are managed automatically by `rumahl-supervisor`:

- **Automatic container management** - No manual docker commands needed
- **Health monitoring** - Automatic restart on failure
- **Port management** - Automatic port assignment and conflict resolution
- **App Store integration** - One-click install/update/uninstall
- **Security profiles** - AppArmor profiles for enhanced security

### Docker Compose

On standard Docker Compose installations:

- **Manual management** - Use `docker compose` commands
- **Limited app store** - Can install apps but no automatic management
- **Port conflicts** - Must manually resolve port conflicts
- **No auto-restart** - Must configure restart policies manually

## Security Notes

### Permissions

Apps must declare required permissions in their manifest:

- `NetworkAccess` - Access to internet
- `NetworkLocalAccess` - Access to local network
- `NetworkScan` - Ability to scan local network
- `NetworkAdmin` - Network configuration (routing, firewall)
- `FileSystem` - File system access
- `SystemConfig` - System configuration
- `HomeAutomation` - Smart home device control
- `DeviceControl` - Direct device control

### Trust Levels

- **Trusted** - Apps from official rumahl App Store
- **Verified** - Manually verified by admin
- **Untrusted** - User-uploaded apps (require explicit permission grants)

### Network Access

Apps can specify allowed domains and local IPs:

```json
"network_access": {
  "allowed_domains": ["api.example.com"],
  "allow_user_domains": true,
  "allow_network_scan": false,
  "allowed_local_ips": ["192.168.1.0/24"],
  "allow_user_local_ips": true
}
```

## Documentation

- **Full manifest schema**: `backend/rumahl-shared/src/app_manifest.rs`
- **App store API**: `backend/rumahl-appstore/src/main.rs`
- **Installation guide**: `INSTALLATION_VALIDATION.md`
- **Architecture**: `ARCHITECTURE.md`

## Support

For app development support:
- GitHub Issues: https://github.com/your-org/ora/issues
- Documentation: https://docs.ora.io
- App Store: https://appstore.rumahl.com
