# Quick Start Guide

Get rumahl running in under 5 minutes.

## Prerequisites

- Docker Desktop or Docker Engine installed
- Git installed

## 1. Clone and Start

```bash
git clone https://github.com/rumahl/home-assistant-dashb.git
cd home-assistant-dashb/deploy
cp ../.env.example ../.env
docker compose up -d
```

Wait 30–60 seconds for all services to initialize.

## 2. Access the Dashboard

Open your browser:

| Interface | URL |
|-----------|-----|
| **Dashboard** | `http://localhost:8126` |
| **Control Center** | `http://localhost:8091` |
| **API Docs (Swagger)** | `http://localhost:8126/api/docs` |
| **Supervisor** | `http://localhost:8097` |

## 3. Create Your First Admin Account

1. Open the Dashboard at `http://localhost:8126`
2. Click **Create Account**
3. Fill in your details and set a password
4. Log in with your new credentials

## 4. Explore the Dashboard

### The Sidebar

The left sidebar provides navigation to all sections:

- **Dashboard** – Smart home widget grid
- **rumahl Control** – Admin panel (users, system, plugins)
- **rumahl Assist** – AI chat interface
- **App Store** – Install apps and plugins

### Add a Widget

1. Click **Edit Dashboard** (pencil icon)
2. Click **Add Widget**
3. Choose a widget type (e.g., Entity Card, Weather, Clock)
4. Configure the widget settings
5. Click **Save**

### Connect Home Assistant (Optional)

1. Go to **rumahl Control** → **Home Assistant**
2. Enter your Home Assistant URL (e.g., `http://homeassistant.local:8123`)
3. Enter your [Long-Lived Access Token](https://www.home-assistant.io/docs/authentication/#your-account-profile)
4. Click **Connect**

Your Home Assistant entities will now appear in the entity picker when adding widgets.

## 5. Install Your First App

1. Go to **App Store** in the sidebar
2. Browse available apps
3. Click **Install** on an app you like
4. Review and accept the permission requests
5. Wait for installation to complete
6. The app will appear in your sidebar navigation

### Install a Custom App

1. Go to **App Store** → **Install Custom App**
2. Upload your app's ZIP file
3. Review permissions
4. Click **Install**

## 6. Try the AI Assistant

1. Go to **rumahl Assist** in the sidebar
2. Type a question or command
   - "Turn on the living room lights"
   - "What's the temperature in the house?"
   - "Create an automation to turn off lights at 11 PM"

**For local AI (offline):**
- Install [LM Studio](https://lmstudio.ai/)
- rumahl Desktop automatically proxies to it on port 11435
- See [rumahl AI Configuration](../ai/README.md)

## 7. Key Concepts

| Concept | Description |
|---------|-------------|
| **App** | Containerized application (Docker), any language, full API access |
| **Plugin** | Sandboxed script (JS/Python), limited resources, fast execution |
| **Widget** | Dashboard UI component |
| **Entity** | Smart home device or sensor (from Home Assistant) |
| **Page** | Customizable dashboard page |
| **Channel** | Inter-app messaging topic |

## 8. Next Steps

- [Configuration Guide](configuration.md) – Deep-dive into settings
- [App Development Guide](../development/app-development.md) – Build your own app
- [Plugin Development Guide](../development/plugin-development.md) – Build a plugin
- [Architecture Overview](architecture.md) – Understand the system design

## Common Commands

```bash
# View all service logs
docker compose -f deploy/docker-compose.yml logs -f

# Restart a specific service
docker compose -f deploy/docker-compose.yml restart rumahl-home

# Stop everything
docker compose -f deploy/docker-compose.yml down

# Update to latest images
docker compose -f deploy/docker-compose.yml pull
docker compose -f deploy/docker-compose.yml up -d
```
