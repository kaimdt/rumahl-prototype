---
title: Quick Start
description: Get rumahl running in under five minutes — clone, start, create your admin account and explore the dashboard.
readTime: 4 min
category: setup
updated: 2026-08-20
featured: true
---

Get rumahl running in under five minutes with Docker. All you need is Docker Desktop or Docker Engine and Git.

## Prerequisites

- Docker Desktop or Docker Engine installed
- Git installed

## 1. Clone and start

```bash
git clone https://github.com/rumahl/rumahl.git
cd rumahl/deploy
cp ../.env.example ../.env
docker compose up -d
```

Wait 30–60 seconds for all services to initialize.

## 2. Access the dashboard

| Interface | URL |
| --- | --- |
| **Dashboard** | `http://localhost:8126` |
| **Control Center** | `http://localhost:8091` |
| **API docs (Swagger)** | `http://localhost:8126/api/docs` |
| **Supervisor** | `http://localhost:8097` |

## 3. Create your first admin account

1. Open the Dashboard at `http://localhost:8126`
2. Click **Create Account**
3. Fill in your details and set a strong password
4. Log in with your new credentials

## 4. Explore the dashboard

The left sidebar provides navigation to all sections:

- **Dashboard** – smart home widget grid
- **rumahl Control** – admin panel (users, system, plugins)
- **rumahl Assist** – AI chat interface
- **App Store** – install apps and plugins

**Add a widget:** click *Edit Dashboard* → *Add Widget* → choose a type (Entity Card, Weather, Clock, …) → configure → save.

## 5. Connect Home Assistant (optional)

1. Go to **rumahl Control** → **Home Assistant**
2. Enter the address of your instance and your credentials
3. Devices and entities appear automatically in the dashboard

> **Tip:** the quickest way to see everything is the Spotlight search — press `Ctrl+Space` and type what you're looking for.
