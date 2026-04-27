# IORA SDK for Rust

Official Rust SDK for developing IORA apps and plugins.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Crates.io](https://img.shields.io/crates/v/iora-sdk.svg)](https://crates.io/crates/iora-sdk)
[![Documentation](https://docs.rs/iora-sdk/badge.svg)](https://docs.rs/iora-sdk)

## Features

- 🦀 **Type-safe** - Full Rust type safety for IORA APIs
- 🔌 **Plugin System** - Easy plugin development with traits
- 📦 **App Development** - Build containerized apps
- 🎨 **Widget Support** - Create dashboard widgets
- 🔐 **Permission Management** - Fine-grained permission control
- 🌐 **Network Access** - Managed network access with domain whitelisting
- ⚙️ **Settings Schema** - User-configurable settings
- 📡 **API Client** - Full-featured HTTP client for IORA APIs

## Installation

Add this to your `Cargo.toml`:

```toml
[dependencies]
iora-sdk = "0.1"
tokio = { version = "1.0", features = ["full"] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
```

## Quick Start

### Using the API Client

```rust
use iora_sdk::prelude::*;

#[tokio::main]
async fn main() -> Result<()> {
    // Create a client
    let client = IoraClient::new("http://localhost:8080")
        .with_api_key("your-api-key");

    // List all entities
    let entities = client.entities().list().await?;
    println!("Found {} entities", entities.len());

    // Control a light
    client.entities()
        .call_service("light", "turn_on", "light.living_room", json!({
            "brightness": 255,
            "color_temp": 400
        }))
        .await?;

    // Send a notification
    client.notifications().send(NotificationPayload {
        title: "Hello".to_string(),
        message: "IORA SDK is working!".to_string(),
        priority: Some("high".to_string()),
        icon: None,
    }).await?;

    Ok(())
}
```

### Creating a Plugin

```rust
use iora_sdk::prelude::*;

pub struct MyPlugin {
    id: String,
    name: String,
}

#[async_trait]
impl Plugin for MyPlugin {
    fn id(&self) -> &str {
        &self.id
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn version(&self) -> &str {
        "1.0.0"
    }

    async fn on_load(&mut self, ctx: &PluginContext) -> Result<()> {
        println!("Plugin {} loaded!", self.name);
        Ok(())
    }

    async fn execute(&self, input: Value) -> Result<PluginResult> {
        // Your plugin logic here
        Ok(plugin_result!(success: {
            "message": "Plugin executed successfully",
            "input": input
        }))
    }
}
```

### Building an App Manifest

```rust
use iora_sdk::prelude::*;

let manifest = ManifestBuilder::new("my-app", "My IORA App")
    .version("1.0.0")
    .developer("Your Name")
    .description("An awesome IORA app")
    .permissions(vec![
        Permission::ReadEntities,
        Permission::ControlEntities,
        Permission::NetworkAccess,
        Permission::SendNotifications,
    ])
    .docker(DockerConfig {
        auto_build: true,
        base_image: "node:18-alpine".to_string(),
        working_dir: "/app".to_string(),
        install_cmd: "npm install".to_string(),
        start_cmd: "node server.js".to_string(),
        internal_ports: vec![
            PortConfig {
                port: 3000,
                protocol: "tcp".to_string(),
                assignment_mode: "random".to_string(),
                description: "Web server".to_string(),
            }
        ],
        environment: HashMap::new(),
        volumes: vec![],
        health_check: Some(HealthCheck {
            endpoint: "/health".to_string(),
            interval: 30,
            timeout: 10,
            retries: 3,
        }),
    })
    .custom_page(CustomPage {
        id: "main".to_string(),
        title: "My App".to_string(),
        icon: "home".to_string(),
        url: "/".to_string(),
        show_in_nav: true,
        order: 100,
        parent_page_id: None,
        iframe: true,
        iframe_config: Some(IframeConfig {
            sandbox: vec!["allow-scripts".to_string(), "allow-same-origin".to_string()],
            allow: vec!["camera".to_string(), "microphone".to_string()],
            security_token: true,
        }),
    })
    .network_access(NetworkAccessConfig {
        allowed_domains: vec!["api.example.com".to_string(), "*.cdn.example.com".to_string()],
        allow_user_domains: true,
        allowed_local_ips: vec!["192.168.1.0/24".to_string()],
        allow_user_local_ips: false,
        allow_network_scan: false,
    })
    .build();

// Save manifest to file
let json = serde_json::to_string_pretty(&manifest)?;
std::fs::write("manifest.json", json)?;
```

## API Reference

### IoraClient

The main client for interacting with IORA APIs.

```rust
let client = IoraClient::new("http://localhost:8080")
    .with_api_key("your-api-key");
```

#### Entities API

```rust
// List all entities
let entities = client.entities().list().await?;

// Get specific entity
let entity = client.entities().get("light.living_room").await?;

// Call service
client.entities().call_service(
    "light",
    "turn_on",
    "light.living_room",
    json!({"brightness": 255})
).await?;
```

#### Notifications API

```rust
// Send notification
client.notifications().send(NotificationPayload {
    title: "Alert".to_string(),
    message: "Something happened".to_string(),
    priority: Some("high".to_string()),
    icon: Some("warning".to_string()),
}).await?;

// Get notifications
let notifications = client.notifications().list().await?;
```

#### Storage API

```rust
// Store data
client.storage().set("my-key", json!({"value": 42})).await?;

// Retrieve data
let data = client.storage().get("my-key").await?;

// Delete data
client.storage().delete("my-key").await?;
```

#### Settings API

```rust
// Get app settings
let settings = client.settings().get("my-app-id").await?;

// Update settings
client.settings().update("my-app-id", json!({
    "api_key": "new-key",
    "enabled": true
})).await?;
```

### Permissions

All available permissions with risk levels:

```rust
use iora_sdk::Permission;

// Get permission risk level
let risk = Permission::ControlEntities.risk_level();
// Returns: RiskLevel::Medium

// Get permission description
let desc = Permission::NetworkAccess.description();
// Returns: "Access external networks"
```

### Manifest Builder

Build app manifests programmatically:

```rust
let manifest = ManifestBuilder::new("my-app", "My App")
    .version("1.0.0")
    .developer("Developer Name")
    .description("App description")
    .permission(Permission::ReadEntities)
    .docker(/* docker config */)
    .build();
```

## Examples

See the [examples](examples/) directory for complete examples:

- [Simple API Client](examples/api_client.rs) - Basic API usage
- [Plugin Development](examples/plugin.rs) - Creating a plugin
- [Network Scanner](examples/network_scanner.rs) - Network scanning app
- [Notification Service](examples/notification_service.rs) - Sending notifications
- [Widget Example](examples/widget.rs) - Creating a dashboard widget

## Development

```bash
# Build the SDK
cargo build

# Run tests
cargo test

# Build documentation
cargo doc --open

# Run examples
cargo run --example api_client
```

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Support

- Documentation: https://docs.iora.dev
- Issues: https://github.com/kaimdt/home-assistant-dashb/issues
- Discussions: https://github.com/kaimdt/home-assistant-dashb/discussions
