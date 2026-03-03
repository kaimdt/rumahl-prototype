# Architecture Overview

## System Design

The Home Assistant Dashboard is designed with extensibility and modularity as core principles. The architecture supports multiple backends, custom plugins, and flexible configuration.

```
┌───────────────────────────────────────────────────────────────┐
│                        Frontend (React)                        │
├───────────────────────────────────────────────────────────────┤
│                                                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │   Widgets    │  │   Plugins    │  │    Themes    │        │
│  │  (Built-in)  │  │   (Custom)   │  │   (Custom)   │        │
│  └──────────────┘  └──────────────┘  └──────────────┘        │
│         │                  │                  │                │
│         └──────────────────┴──────────────────┘                │
│                            │                                   │
│                  ┌─────────┴─────────┐                         │
│                  │  Plugin Registry  │                         │
│                  └─────────┬─────────┘                         │
│                            │                                   │
│         ┌──────────────────┴──────────────────┐                │
│         │      Backend Abstraction Layer      │                │
│         │    (Provider Pattern - Swappable)   │                │
│         └──────────────────┬──────────────────┘                │
│                            │                                   │
└────────────────────────────┼───────────────────────────────────┘
                             │
            ┌────────────────┴────────────────┐
            │                                 │
   ┌────────┴────────┐              ┌────────┴────────┐
   │  Direct Mode    │              │   Proxy Mode    │
   │  (Browser API)  │              │  (Rust Server)  │
   └────────┬────────┘              └────────┬────────┘
            │                                 │
            └────────────┬────────────────────┘
                         │
                ┌────────┴────────┐
                │ Home Assistant  │
                │  (REST + WS)    │
                └─────────────────┘
```

## Core Components

### 1. Plugin System

The plugin system allows extending functionality without modifying core code.

**Registry Pattern:**
- Centralized plugin registration
- Type-safe plugin definitions
- Lifecycle management (init, destroy)
- Configuration persistence

**Plugin Types:**
1. **Widget Plugins** - UI components
2. **API Plugins** - Custom endpoints
3. **Service Plugins** - Background tasks
4. **Theme Plugins** - Styling customization

**Example Flow:**
```
Plugin Registration → Validation → Configuration → Activation → Usage
```

### 2. Backend Abstraction Layer

Allows switching between different backend implementations:

**Providers:**
- `DirectHAProvider` - Direct browser-to-HA communication
- `ProxyBackendProvider` - Through Rust/Axum server
- `CustomProvider` - User-defined backends

**Features:**
- Transparent switching
- WebSocket support
- Connection pooling
- Error handling
- Retry logic

### 3. State Management

**React Context API:**
- `ThemeContext` - Theme state
- `PageNavigationContext` - Navigation state
- Plugin contexts - Plugin-specific state

**Data Flow:**
```
Backend Provider → State Update → Context → Components → UI
```

### 4. Widget System

**Built-in Widgets:**
- LightWidget (with color picker, brightness)
- ClimateWidget (temperature control)
- SwitchWidget (toggle)
- SensorWidget (display)
- WeatherWidget (forecast)

**Widget Lifecycle:**
1. Entity data received
2. Widget component renders
3. User interaction
4. Service call through backend
5. State update
6. Re-render

### 5. Rust Backend (Optional)

**Technology Stack:**
- Axum - Web framework
- Tokio - Async runtime
- Reqwest - HTTP client
- Serde - Serialization

**Components:**
- HTTP Router (REST API)
- WebSocket Manager (Real-time)
- HA Client (API wrapper)
- State Broadcaster

**Advantages:**
- High performance
- Low resource usage
- Type safety
- Concurrent connections
- Real-time updates

## Data Flow

### Entity State Updates

**Direct Mode:**
```
1. Frontend polls HA API (every 5s)
2. Parse response
3. Update context
4. Components re-render
```

**Proxy Mode:**
```
1. Backend polls HA API (every 2s)
2. Broadcast via WebSocket
3. Frontend receives update
4. Update context
5. Components re-render
```

### Service Calls

**Direct Mode:**
```
User Action → Widget → Backend Provider → HA API → Response → Widget Update
```

**Proxy Mode:**
```
User Action → Widget → Proxy API → HA API → Response → Widget Update
                                  ↓
                            WebSocket Broadcast → All Clients
```

## Plugin Architecture

### Plugin Registration

```typescript
// 1. Define plugin
const myPlugin: WidgetPlugin = {
  metadata: { id, name, version, ... },
  component: MyComponent,
}

// 2. Register
pluginRegistry.registerWidget(myPlugin)

// 3. Use
const widget = pluginRegistry.getWidget('my-plugin')
```

### Plugin Context

Plugins receive a context object:

```typescript
interface PluginContext {
  callService()   // HA service calls
  getStates()     // Entity states
  storage         // Persistent storage
  notify()        // Toast notifications
  subscribe()     // Entity subscriptions
}
```

### Plugin Communication

**Widget → Backend:**
```
Widget calls onCallService()
  ↓
Registry routes to active backend provider
  ↓
Provider makes API call
  ↓
Response handled
```

**Backend → Widget:**
```
State change detected
  ↓
Context updated
  ↓
Component receives new props
  ↓
Re-renders with new data
```

## Configuration System

### Storage Layers

1. **Environment Variables** - Backend configuration
2. **LocalStorage** - User preferences
3. **GitHub Spark KV** - Persistent app state
4. **Plugin Configs** - Plugin-specific settings

### Configuration Flow

```
User edits settings → Validate → Save to storage → Update context → Apply changes
```

## Security Model

### Authentication

**Direct Mode:**
- HA token stored in browser
- Sent with each request
- HTTPS required in production

**Proxy Mode:**
- Token stored in backend env
- Frontend uses proxy auth
- More secure for public deployments

### Plugin Security

**Permissions System:**
```typescript
permissions: ['storage', 'network', 'notifications', 'homeassistant']
```

**Sandboxing:**
- Plugins isolated from core
- No direct DOM access
- Controlled API surface
- Resource limits

## Performance Optimizations

### Frontend

1. **React Memoization** - Prevent unnecessary re-renders
2. **Code Splitting** - Load plugins on demand
3. **Virtual Scrolling** - Large entity lists
4. **Debounced Updates** - Throttle API calls
5. **Service Workers** - Offline capability

### Backend

1. **Connection Pooling** - Reuse HTTP connections
2. **Response Caching** - Cache static data
3. **Batch Updates** - Group state changes
4. **Async I/O** - Non-blocking operations
5. **Binary Protocol** - Efficient WebSocket messages

## Extensibility Points

### Adding New Entity Types

1. Define TypeScript interface
2. Create widget component
3. Register in plugin system
4. Add icon mapping
5. Update documentation

### Adding Backend Provider

1. Implement `BackendProvider` interface
2. Register with `backendManager`
3. Configure connection
4. Test integration

### Creating Custom Themes

1. Define CSS variables
2. Create theme plugin
3. Register with registry
4. Apply theme

### External Integrations

1. **REST APIs** - Via API plugins
2. **WebSocket Services** - Via service plugins
3. **OAuth Providers** - Via auth plugins
4. **Third-party Libraries** - NPM imports

## Deployment Scenarios

### 1. Static Frontend + Direct HA

```
Browser → Home Assistant (Direct)
```

**Use case:** Simple setup, home network only

### 2. Frontend + Rust Proxy

```
Browser → Rust Backend → Home Assistant
```

**Use case:** Better performance, public access

### 3. Full Stack + Reverse Proxy

```
Browser → Nginx → Frontend + Backend → Home Assistant
```

**Use case:** Production deployment with SSL

### 4. Docker Compose

```
Browser → Docker Network → Frontend + Backend + HA
```

**Use case:** Containerized deployment

## Testing Strategy

### Unit Tests
- Component rendering
- State management
- Plugin registration
- Backend providers

### Integration Tests
- API endpoints
- WebSocket connections
- HA service calls
- Plugin loading

### E2E Tests
- User workflows
- Multi-page navigation
- Entity interactions
- Real-time updates

## Monitoring & Debugging

### Logging

**Frontend:**
- Console logs (dev mode)
- Error tracking
- Performance metrics

**Backend:**
- Structured logging (tracing)
- Request/response logs
- Error stack traces
- Connection statistics

### Health Checks

- `/health` endpoint
- WebSocket connection status
- HA API connectivity
- Plugin health status

## Future Enhancements

1. **Plugin Marketplace** - Discover and install plugins
2. **Mobile App** - Native iOS/Android apps
3. **Voice Control** - Integrate voice assistants
4. **AI Automation** - Smart home suggestions
5. **Multi-HA Support** - Connect multiple instances
6. **Offline Mode** - Full PWA capabilities
7. **Analytics** - Usage insights and optimization
8. **GraphQL API** - More flexible data fetching

## Contributing

See [PLUGIN_GUIDE.md](PLUGIN_GUIDE.md) for plugin development.

For core contributions:
1. Fork repository
2. Create feature branch
3. Write tests
4. Submit pull request
5. Wait for review
