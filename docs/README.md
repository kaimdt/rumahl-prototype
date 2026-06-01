# IORA Documentation

Welcome to the IORA (Intelligent Open Residential Assistant) documentation.

## Quick Links

- [Getting Started](getting-started/installation.md) – Installation and initial setup
- [Quick Start](getting-started/quick-start.md) – Get IORA running in 5 minutes
- [App Development](development/app-development.md) – Create apps for IORA
- [Plugin Development](development/plugin-development.md) – Create plugins for IORA
- [API Reference](api/README.md) – Complete API documentation
- [Security Guide](security/README.md) – Security features and best practices

## What is IORA?

IORA is a comprehensive home automation platform that provides:

- **Smart Home Control** – Manage devices, sensors, and automations
- **App Store** – Install apps and plugins to extend functionality
- **Security & Privacy** – Built-in security monitoring and encryption
- **Network Monitoring** – Track devices on your local network
- **API Gateway** – Secure API access for integrations
- **Plugin System** – Extend IORA with custom functionality
- **AI Assistant (ORA AI)** – Natural language smart home control with multi-provider support

## Documentation Structure

### Getting Started
- [Installation Guide](getting-started/installation.md) – All installation methods
- [Quick Start](getting-started/quick-start.md) – 5-minute setup
- [Configuration](getting-started/configuration.md) – Environment variables and service config
- [Architecture Overview](getting-started/architecture.md) – High-level system design

### Development
- [App Development Guide](development/app-development.md) – Create containerized apps
- [Plugin Development Guide](development/plugin-development.md) – Create sandboxed plugins
- [Manifest Schema](development/manifest-schema.md) – Complete manifest reference
- [Permissions Reference](development/permissions.md) – Available permissions
- [Network Access Control](development/network-access.md) – Domain and IP whitelisting
- [Testing & Debugging](development/testing.md) – Test your apps and plugins
- [App Storage Guide](development/app-storage.md) – File and KV storage
- [App Database Guide (SQLite)](development/app-database.md) – Per-app databases
- [Scheduled Tasks Guide](development/app-scheduling.md) – Cron jobs and intervals
- [Webhooks Guide](development/app-webhooks.md) – Incoming webhooks
- [Inter-App Messaging Guide](development/app-messaging.md) – Pub/sub messaging
- [App Runtime Capabilities](development/app-runtime-capabilities.md) – Iframe and AI integration
- [Theme System](development/theme-system.md) – Visual customization
- [App Theming Guide](development/app-theming.md) – Theme creation
- [Best Practices](development/best-practices.md) – Production-ready patterns
- [Error Handling Guide](development/error-handling-guide.md) – SDK error handling

### System Reference
- [App & Plugin System (v2.3)](system/app-plugin-system.md) – Complete system API reference
- [Database Architecture](system/database.md) – Database design
- [Port Reference](system/ports.md) – All port assignments

### API Reference
- [API Overview](api/README.md) – Authentication, patterns, and conventions
- [Core API](api/core.md) – Entities, users, pages, plugins, apps
- [Control Center API](api/control.md) – System administration
- [App Store API](api/appstore.md) – App lifecycle and catalog
- [Security API](api/security.md) – Threats, lockdown, audit
- [Network Monitor API](api/network.md) – Gateway and validation
- [Supervisor API](api/ssh.md) – Container management

### Security
- [Security Overview](security/README.md) – Architecture and features
- [Permission System](security/permissions.md) – Complete permission reference
- [Network Security](security/network.md) – Network hardening
- [Encryption](security/encryption.md) – Encryption standards
- [Threat Detection](security/threat-detection.md) – IDS and auto-lockdown
- [Best Practices](security/best-practices.md) – Security checklist

### Guides
- [Port Management](guides/port-management.md) – Port assignment and configuration
- [Creating Custom Pages](guides/custom-pages.md) – App page configuration
- [Settings Schema](guides/settings-schema.md) – User-configurable settings
- [Docker Configuration](guides/docker-config.md) – Container setup and bundles
- [Troubleshooting](guides/troubleshooting.md) – Common issues and solutions

### Architecture (Deep Dive)
- [Architecture Overview](architecture/overview.md) – Complete system architecture
- [Configuration System](architecture/configuration-system.md) – Database-backed configuration
- [Domain Validation & Resources](architecture/domain-validation-and-resource-management.md)
- [Port & Network Enhancements](architecture/port-management-and-system-enhancements.md)
- [Network Access & Docs](architecture/network-access-and-documentation-summary.md)
- [System Enhancements Summary](architecture/system-enhancements-summary.md)

### Deployment & Operations
- [Docker & IORA OS](deployment/docker-and-iora-os.md) – Containerized deployment
- [Installation Validation](deployment/installation-validation.md) – Secure installation
- [Alpine Migration](deployment/alpine-migration.md) – Resource optimization
- [Multi-Format Build](deployment/multi-format-build.md) – IORA OS build system

### AI & Integrations
- [ORA AI Overview](ai/README.md) – AI assistant documentation
- [Home Assistant Integration](integrations/integration-guide.md) – HA setup
- [App Store Guide](apps/store-guide.md) – App publishing
- [Plugin Isolation](apps/plugin-isolation.md) – Sandbox architecture

### SDKs
- [JavaScript SDK](sdks/iora-sdk.md) – IORA SDK documentation
- Additional SDKs: Go, C++, PHP (see `sdks/` directory)

### Additional Resources
- [Database Security](database-security.md) – PostgreSQL and SQLite security
- [Dynamic Overview Guide](frontend/dynamic-overview-guide.md) – Frontend overview system
- [CLI & Admin Tools](cli/iora-cli-and-admin.md) – CLI reference
- [Changelog](changelog/) – Implementation history

## Recent Updates

- **Multi-Container App Bundles (v2.3)** – Define multi-service apps with internal networking
- **Iframe Communication (v2.3)** – Bidirectional postMessage API for app iframes
- **Plugin Sandbox v2.2** – Enhanced isolation with configurable resource limits
- **App Runtime Capabilities** – Declarative AI and GitHub integration surfaces
- **Domain Validator Service** – Enforces network access policies with domain/IP whitelisting
- **Resource Manager Service** – Intelligent Docker container resource monitoring
- **Network Access Control** – Domain whitelist and IP access control for apps
- **SSH Management** – Control SSH access through the Control Center
- **NGINX Reverse Proxy** – Centralized web traffic management
- **Enhanced Port Manager** – 10,000+ ports with random/fixed assignment modes

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines on contributing to IORA.

## License

IORA is open source software. See [LICENSE](../LICENSE) for details.

## Support

- **Documentation Issues**: [Report here](https://github.com/kaimdt/home-assistant-dashb/issues)
- **Community**: [Join discussions](https://github.com/kaimdt/home-assistant-dashb/discussions)
- **Security Issues**: See [Security Policy](security/README.md#reporting-security-issues)
