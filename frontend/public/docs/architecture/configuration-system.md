# Database-Backed Configuration System

This document describes the new database-backed configuration system that replaces localStorage with a robust, multi-device/multi-user architecture.

## Overview

The configuration system now stores all dashboard settings (pages, widgets, themes, backgrounds) in an SQLite database on the backend. This enables:

- **Multi-user support**: Multiple users can have their own dashboard configurations
- **Multi-device support**: Each device can have its own configuration, or share a user's configuration
- **Real-time synchronization**: Changes made on one device are immediately reflected on all other devices
- **Persistent storage**: All settings are stored reliably in a database
- **Design mode toggle**: Users can choose between per-user or per-device designs

## Architecture

### Backend (Rust)

#### Database Schema

The database consists of the following main tables:

- `users`: User accounts
- `devices`: Registered devices (browsers, tablets, etc.)
- `user_devices`: Many-to-many relationship between users and devices
- `configuration_profiles`: Configuration profiles (per-user or per-device)
- `pages`: Dashboard pages within a profile
- `widgets`: Widgets within pages
- `theme_settings`: Theme configuration per profile
- `background_configs`: Background settings (static, slideshow, video, gradient)
- `background_triggers`: Automation triggers for background changes
- `user_preferences`: User/device specific preferences
- `sync_metadata`: Change tracking for real-time sync

#### API Endpoints

**User Management:**
- `POST /api/config/users` - Create a new user
- `GET /api/config/users/:username` - Get user by username

**Device Management:**
- `POST /api/config/devices` - Register a new device
- `GET /api/config/devices/:device_id` - Get device information
- `POST /api/config/devices/:device_id/heartbeat` - Update device last_seen

**Profile Management:**
- `POST /api/config/profiles` - Create a configuration profile
- `GET /api/config/profiles/:profile_id` - Get profile with all data (pages, theme, background)

**Configuration:**
- `POST /api/config/profiles/:profile_id/pages` - Save pages configuration
- `POST /api/config/profiles/:profile_id/theme` - Save theme settings
- `POST /api/config/profiles/:profile_id/background` - Save background configuration

**Preferences:**
- `POST /api/config/preferences/:user_id` - Save user preference
- `GET /api/config/preferences/:user_id` - Get all user preferences

**Synchronization:**
- `GET /api/config/sync/changes?since=<timestamp>` - Get configuration changes since a timestamp
- WebSocket `/ws` - Real-time configuration updates via `config_changed` messages

#### WebSocket Messages

The WebSocket connection supports the following message types:

```typescript
{
  "type": "state_changed",
  "states": [...]  // Home Assistant entity states
}

{
  "type": "config_changed",
  "changes": [...]  // Configuration sync metadata
}
```

### Frontend (React + TypeScript)

#### ConfigurationContext

The `ConfigurationContext` provides the following functionality:

```typescript
interface ConfigurationContextType {
  // Current state
  user: User | null
  device: Device | null
  profile: ConfigurationProfile | null
  pages: DashboardPage[]
  theme: ThemeSettings | null
  background: BackgroundConfig | null
  designMode: 'user' | 'device'

  // Actions
  setUser: (user: User) => void
  setDevice: (device: Device) => void
  setDesignMode: (mode: 'user' | 'device') => void
  savePages: (pages: DashboardPage[]) => Promise<void>
  saveTheme: (theme: Partial<ThemeSettings>) => Promise<void>
  saveBackground: (background: BackgroundConfig) => Promise<void>
  savePreference: (key: string, value: any) => Promise<void>
  getPreference: (key: string) => Promise<any>

  // Loading state
  isLoading: boolean
  error: string | null
}
```

#### Components

**ConfigurationSettings**: Settings UI for design mode selection and background configuration

**DynamicBackground**: Renders the configured background (static, slideshow, video, or gradient)

## Design Modes

Users can choose between two design modes:

### User Design Mode

- Configuration is associated with the user account
- Changes are synced across all devices the user logs in on
- Useful for users who want a consistent experience across devices

### Device Design Mode

- Configuration is specific to the current device
- Each device can have its own unique layout and settings
- Useful for shared devices or device-specific optimizations

## Background Types

The system supports four types of backgrounds:

### Static Image

```typescript
{
  type: 'static',
  url: 'https://example.com/background.jpg'
}
```

### Slideshow

```typescript
{
  type: 'slideshow',
  urls: ['url1.jpg', 'url2.jpg', ...],
  interval: 5  // seconds
}
```

### Video

```typescript
{
  type: 'video',
  url: 'https://example.com/background.mp4',
  loop: true
}
```

### Gradient

```typescript
{
  type: 'gradient',
  colors: ['#667eea', '#764ba2'],
  angle: 135  // degrees
}
```

## Real-Time Synchronization

The system tracks all configuration changes in the `sync_metadata` table and broadcasts them via WebSocket to all connected clients. When a client receives a `config_changed` message, it can:

1. Check which tables were modified
2. Reload the affected configuration
3. Update the UI accordingly

This ensures that changes made on one device are immediately visible on all other devices.

## Setup

### Backend

1. Set up environment variables in `backend/.env`:

```bash
# Database URL
DATABASE_URL=sqlite:./data/ha-dashboard.db

# Home Assistant credentials
HA_URL=http://homeassistant.local:8123
HA_TOKEN=your_token_here
```

2. Start the backend:

```bash
cd backend
cargo run
```

The database will be automatically created and migrations will run on first startup.

### Frontend

1. Set up environment variables in `.env`:

```bash
VITE_BACKEND_URL=http://rumahl.local:3001
```

2. Start the frontend:

```bash
npm run dev
```

## Migration from localStorage

On first load, the `ConfigurationContext` will:

1. Register the current device
2. Create or get the default user
3. Create a configuration profile
4. Load any existing configuration from the database

If you want to migrate existing localStorage data, you would need to:

1. Export data from localStorage
2. Format it according to the API schema
3. POST it to the appropriate endpoints

Note: Automatic migration is not currently implemented, as the system is designed to start fresh with database-backed storage.

## Future Enhancements

### Background Triggers (Planned)

The `background_triggers` table supports automation-based background changes:

```typescript
{
  trigger_type: 'time',  // 'time', 'entity_state', 'event'
  trigger_config: {
    // Time-based: { hour: 18, minute: 0 }
    // Entity-based: { entity_id: 'sun.sun', state: 'below_horizon' }
    // Event-based: { event_type: 'automation.triggered', data: {...} }
  },
  background_config_id: 'background_id',
  priority: 0,
  is_enabled: true
}
```

This will allow automatic background changes based on:
- Time of day
- Home Assistant entity states
- Custom events

## Troubleshooting

### Device Not Registered

If your device ID is not found, the system will automatically register a new device. Check the browser console for the device ID being used.

### Configuration Not Loading

1. Check that the backend is running and accessible
2. Check the browser console for API errors
3. Verify the `VITE_BACKEND_URL` environment variable
4. Check the backend logs for database errors

### Changes Not Syncing

1. Verify the WebSocket connection is established (check browser DevTools Network tab)
2. Check that `sync_metadata` records are being created after configuration changes
3. Ensure all devices are connected to the same backend instance
