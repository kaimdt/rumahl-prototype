# AppArmor Security Profiles for rumahl

This directory contains AppArmor profiles for all rumahl services running in Docker containers.

## Overview

AppArmor is a Mandatory Access Control (MAC) system that restricts program capabilities. Each rumahl service runs with a custom AppArmor profile that limits its access to system resources.

## Profiles

- `rumahl-supervisor` - Docker orchestration service (requires Docker socket access)
- `rumahl-security` - Security monitoring (requires database encryption key access)
- `rumahl-secrets` - Encrypted secrets storage (requires PostgreSQL access)
- `rumahl-gateway` - Sandboxed external integrations (network restricted)
- `rumahl-home` - Smart Home service (Home Assistant integration)
- `rumahl-core` - Central orchestrator (service registry)
- `rumahl-control` - Admin panel backend
- `rumahl-assist` - AI assistant
- `rumahl-watchdog` - Health monitoring

## Loading Profiles

Profiles are automatically loaded during rumahl OS boot:

```bash
# Manual load
apparmor_parser -r /etc/apparmor.d/rumahl-*

# Check status
aa-status

# Verify profile is enforcing
aa-status | grep ora
```

## Applying to Containers

In docker-compose.yml, profiles are applied with:

```yaml
security_opt:
  - apparmor=rumahl-service-name
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
aa-complain /etc/apparmor.d/rumahl-security

# Switch to enforce mode
aa-enforce /etc/apparmor.d/rumahl-security

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
5. Reload profile: `apparmor_parser -r /etc/apparmor.d/rumahl-service`

## Custom Profiles

To create a custom profile for a new rumahl service:

1. Copy an existing profile as template
2. Update binary path and service name
3. Add required file/network access
4. Test in complain mode
5. Review audit logs
6. Add legitimate access rules
7. Switch to enforce mode
