# rumahl Documentation

Welcome to the rumahl (Intelligent Open Residential Assistant) documentation.

## Quick Links

- [Getting Started](getting-started/README.md) - Installation and initial setup
- [App Development](development/app-development.md) - Create apps for rumahl
- [Plugin Development](development/plugin-development.md) - Create plugins for rumahl
- [API Reference](api/README.md) - Complete API documentation
- [Security Guide](security/README.md) - Security features and best practices

## What is rumahl?

rumahl is a comprehensive home automation platform that provides:

- **Smart Home Control** - Manage devices, sensors, and automations
- **App Store** - Install apps and plugins to extend functionality
- **Security & Privacy** - Built-in security monitoring and encryption
- **Network Monitoring** - Track devices on your local network
- **API Gateway** - Secure API access for integrations
- **Plugin System** - Extend rumahl with custom functionality

## Documentation Structure

### Getting Started
- [Installation Guide](getting-started/installation.md)
- [Quick Start](getting-started/quick-start.md)
- [Configuration](getting-started/configuration.md)
- [Architecture Overview](getting-started/architecture.md)

### Development
- [App Development Guide](development/app-development.md)
- [Plugin Development Guide](development/plugin-development.md)
- [App Manifest Schema](development/manifest-schema.md)
- [Permissions System](development/permissions.md)
- [Network Access Control](development/network-access.md)
- [Testing & Debugging](development/testing.md)
- [App Storage Guide](development/app-storage.md)
- [App Database Guide (SQLite)](development/app-database.md)
- [Scheduled Tasks Guide](development/app-scheduling.md)
- [Webhooks Guide](development/app-webhooks.md)
- [Inter-App Messaging Guide](development/app-messaging.md)

### API Reference
- [REST API Overview](api/README.md)
- [Core API](api/core.md)
- [Control Center API](api/control.md)
- [App Store API](api/appstore.md)
- [Security API](api/security.md)
- [Network Monitor API](api/network.md)
- [SSH Management API](api/ssh.md)

### Security
- [Security Overview](security/README.md)
- [Permission System](security/permissions.md)
- [Network Security](security/network.md)
- [Encryption](security/encryption.md)
- [Threat Detection](security/threat-detection.md)
- [Best Practices](security/best-practices.md)

### Guides
- [Port Management](guides/port-management.md)
- [Creating Custom Pages](guides/custom-pages.md)
- [Settings Schema](guides/settings-schema.md)
- [Docker Configuration](guides/docker-config.md)
- [Domain Validation & Resource Management](DOMAIN_VALIDATION_AND_RESOURCE_MANAGEMENT.md)
- [Troubleshooting](guides/troubleshooting.md)

## Recent Updates

- **Domain Validator Service** - Enforces network access policies with domain/IP whitelisting
- **Resource Manager Service** - Intelligent Docker container resource monitoring and reallocation
- **Network Access Control** - New domain whitelist and IP access control for apps
- **Network Monitor Service** - Discover and track devices on your local network
- **SSH Management** - Control SSH access through the Control Center
- **NGINX Reverse Proxy** - Centralized web traffic management
- **Enhanced Port Manager** - 10,000+ ports with random/fixed assignment modes

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines on contributing to rumahl.

## License

rumahl is open source software. See [LICENSE](../LICENSE) for details.

## Support

- **Documentation Issues**: [Report here](https://github.com/rumahl/home-assistant-dashb/issues)
- **Community**: [Join discussions](https://github.com/rumahl/home-assistant-dashb/discussions)
- **Security Issues**: See [Security Policy](security/README.md#reporting-security-issues)
