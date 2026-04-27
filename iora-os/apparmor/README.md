# AppArmor Security Profiles for IORA

This directory contains AppArmor profiles for all IORA services running in Docker containers.

## Overview

AppArmor is a Mandatory Access Control (MAC) system that restricts program capabilities. Each IORA service runs with a custom AppArmor profile that limits its access to system resources.

## Profiles

- `iora-supervisor` - Docker orchestration service (requires Docker socket access)
- `iora-security` - Security monitoring (requires database encryption key access)
- `iora-secrets` - Encrypted secrets storage (requires PostgreSQL access)
- `iora-gateway` - Sandboxed external integrations (network restricted)
- `iora-home` - Smart Home service (Home Assistant integration)
- `iora-core` - Central orchestrator (service registry)
- `iora-control` - Admin panel backend
- `iora-assist` - AI assistant
- `iora-watchdog` - Health monitoring

## Loading Profiles

Profiles are automatically loaded during IORA OS boot:

```bash
# Manual load
apparmor_parser -r /etc/apparmor.d/iora-*

# Check status
aa-status

# Verify profile is enforcing
aa-status | grep iora
```

## Applying to Containers

In docker-compose.yml, profiles are applied with:

```yaml
security_opt:
  - apparmor=iora-service-name
```

## Profile Structure

Each profile includes:

1. **Base abstractions** - Common Linux operations
2. **Binary execution** - Allow running the service binary
3. **Network access** - Controlled network capabilities
4. **File access** - Specific file/directory permissions
5. **Capability restrictions** - Deny dangerous capabilities

## Testing Profiles

```bash
# Test in complain mode (logs violations but doesn't block)
aa-complain /etc/apparmor.d/iora-security

# Switch to enforce mode
aa-enforce /etc/apparmor.d/iora-security

# View violations
journalctl -k | grep -i apparmor | grep DENIED
```

## Security Best Practices

1. **Least Privilege** - Each service has minimum required permissions
2. **Network Isolation** - Services can't access arbitrary network resources
3. **File System Restrictions** - Services can only access their data directories
4. **Capability Limits** - Dangerous capabilities (sys_admin, sys_module) are denied
5. **No Privilege Escalation** - Services can't gain additional privileges

## Troubleshooting

If a service fails due to AppArmor:

1. Check logs: `journalctl -u docker | grep apparmor`
2. Review denials: `dmesg | grep -i apparmor`
3. Temporarily disable: `docker run --security-opt apparmor=unconfined`
4. Update profile if legitimate access is needed
5. Reload profile: `apparmor_parser -r /etc/apparmor.d/iora-service`

## Custom Profiles

To create a custom profile for a new IORA service:

1. Copy an existing profile as template
2. Update binary path and service name
3. Add required file/network access
4. Test in complain mode
5. Review audit logs
6. Add legitimate access rules
7. Switch to enforce mode
