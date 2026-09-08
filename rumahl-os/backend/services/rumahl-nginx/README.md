# rumahl NGINX Service

The rumahl NGINX service manages the reverse proxy for all web traffic in the rumahl ecosystem.

## Overview

This service:
- Acts as the main entry point for all HTTP/HTTPS traffic
- Dynamically generates NGINX configuration based on installed apps
- Provides reverse proxy routing for rumahl services and user apps
- Includes security headers, rate limiting, and compression
- Automatically reloads configuration when apps are installed/removed

## Features

### Static Routes
- `/` → rumahl-home (port 8080)
- `/api/core/` → rumahl-core (port 8090)
- `/api/control/` → rumahl-control (port 8091)
- `/api/assist/` → rumahl-assist (port 8092)
- `/api/secrets/` → rumahl-secrets (port 8093)
- `/api/watchdog/` → rumahl-watchdog (port 8094)
- `/api/security/` → rumahl-security (port 8095)
- `/api/gateway/` → rumahl-gateway (port 8096)
- `/api/supervisor/` → rumahl-supervisor (port 8097)
- `/api/appstore/` → rumahl-appstore (port 8098)

### Dynamic App Routes
- `/apps/{app-id}/` → Dynamically assigned app port (10000-20000 range)

### Security Features
- X-Frame-Options header
- X-Content-Type-Options header
- X-XSS-Protection header
- Referrer-Policy header
- Rate limiting (API: 10 req/s, General: 50 req/s)
- Gzip compression

## Configuration

### Environment Variables
- `DATABASE_URL`: PostgreSQL connection string (default: `postgres://ora:ora@localhost/ora`)
- `RUST_LOG`: Log level (default: `rumahl_nginx=info,tower_http=info`)

### Template
The NGINX configuration is generated from `nginx-config/nginx.conf.template` using the Tera templating engine.

## Port Allocation

The service reserves:
- Port 80 for HTTP traffic
- Port 443 for HTTPS traffic (optional, commented out in template)

## Auto-reload

The service monitors the database for app changes every 30 seconds and:
1. Fetches enabled apps and their port assignments
2. Generates new NGINX configuration if changes detected
3. Tests the new configuration
4. Reloads NGINX if the test passes
5. Reverts to backup if the test fails

## Running

```bash
# Development
cargo run

# Production
cargo build --release
./target/release/rumahl-nginx
```

## Requirements

- NGINX must be installed on the system
- The service must have permissions to write to `/etc/nginx/nginx.conf`
- The service must have permissions to reload NGINX
- PostgreSQL database must be running with the rumahl-appstore schema

## Health Check

NGINX provides a health check endpoint at `/nginx-health` that returns "healthy" if NGINX is running.
