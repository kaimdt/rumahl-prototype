#!/usr/bin/env python3
"""IORA Home First-Boot Setup Wizard.

A self-contained web application that runs on first boot (or standalone)
to guide users through initial IORA Home configuration.

Listens on port 8080. After setup completes, it writes configuration
to /mnt/data/iora/ and disables itself.

Can also be run standalone (without IORA OS) as a setup tool.
"""

import http.server
import json
import os
import socket
import subprocess
import sys
import threading
import urllib.parse

SETUP_PORT = 8080
DATA_DIR = "/mnt/data/iora"
CONFIG_FILE = "/mnt/data/iora/setup.json"
SETUP_DONE_FLAG = "/mnt/data/iora/.setup-complete"
IORA_VERSION_FILE = "/etc/iora-version"
UPDATE_SERVER = "https://update.kaimdt.com"
DOWNLOAD_SERVER = "https://dist.kaimdt.com"

# Detect if running on IORA OS or standalone
IS_IORA_OS = os.path.exists(IORA_VERSION_FILE)


def get_system_info():
    """Gather system information for display."""
    info = {}

    # Hostname
    info["hostname"] = socket.gethostname()

    # IP addresses
    info["interfaces"] = []
    try:
        for iface in os.listdir("/sys/class/net"):
            if iface == "lo":
                continue
            addr_path = f"/sys/class/net/{iface}/address"
            state_path = f"/sys/class/net/{iface}/operstate"
            mac = open(addr_path).read().strip() if os.path.exists(addr_path) else ""
            state = open(state_path).read().strip() if os.path.exists(state_path) else "unknown"
            # Get IPv4 via ip command
            ipv4 = ""
            try:
                out = subprocess.check_output(
                    ["ip", "-4", "addr", "show", iface],
                    stderr=subprocess.DEVNULL, text=True
                )
                for line in out.splitlines():
                    line = line.strip()
                    if line.startswith("inet "):
                        ipv4 = line.split()[1].split("/")[0]
                        break
            except Exception:
                pass
            info["interfaces"].append({
                "name": iface, "mac": mac, "state": state, "ipv4": ipv4
            })
    except Exception:
        pass

    # OS version
    if os.path.exists(IORA_VERSION_FILE):
        info["version"] = open(IORA_VERSION_FILE).read().strip()
    else:
        info["version"] = "Standalone"

    info["is_iora_os"] = IS_IORA_OS

    # Docker status
    try:
        subprocess.check_output(["docker", "info"], stderr=subprocess.DEVNULL)
        info["docker"] = True
    except Exception:
        info["docker"] = False

    # Disk usage
    try:
        st = os.statvfs("/mnt/data" if IS_IORA_OS else "/")
        total_gb = (st.f_blocks * st.f_frsize) / (1024 ** 3)
        free_gb = (st.f_bavail * st.f_frsize) / (1024 ** 3)
        info["disk_total_gb"] = round(total_gb, 1)
        info["disk_free_gb"] = round(free_gb, 1)
    except Exception:
        info["disk_total_gb"] = 0
        info["disk_free_gb"] = 0

    # Memory
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                if line.startswith("MemTotal:"):
                    info["memory_mb"] = int(line.split()[1]) // 1024
                    break
    except Exception:
        info["memory_mb"] = 0

    # Update server info
    info["update_server"] = UPDATE_SERVER
    info["download_server"] = DOWNLOAD_SERVER

    return info


def fetch_available_packages():
    """Fetch available IORA packages from the update server."""
    try:
        import urllib.request
        url = f"{UPDATE_SERVER}/v1/iora/packages"
        req = urllib.request.Request(url, headers={"User-Agent": "iora-setup/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode())
    except Exception:
        # Return built-in defaults if server unreachable
        return []


def check_os_update():
    """Check if an OS update is available."""
    try:
        import urllib.request
        version = "unknown"
        if os.path.exists(IORA_VERSION_FILE):
            version = open(IORA_VERSION_FILE).read().strip().split()[-1]
        url = f"{UPDATE_SERVER}/v1/iora/os/check?version={version}&channel=stable&arch=x86_64"
        req = urllib.request.Request(url, headers={"User-Agent": "iora-setup/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode())
    except Exception:
        return {"update_available": False, "current_version": "unknown"}


def save_config(config):
    """Save setup configuration."""
    os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
    with open(CONFIG_FILE, "w") as f:
        json.dump(config, f, indent=2)


def apply_config(config):
    """Apply the setup configuration to the system."""
    errors = []

    # Create data directory structure
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(os.path.join(DATA_DIR, "config"), exist_ok=True)
    os.makedirs(os.path.join(DATA_DIR, "media"), exist_ok=True)
    os.makedirs(os.path.join(DATA_DIR, "backups"), exist_ok=True)
    os.makedirs(os.path.join(DATA_DIR, "addons"), exist_ok=True)

    # Generate docker-compose.yml
    compose = generate_compose(config)
    compose_path = os.path.join(DATA_DIR, "docker-compose.yml")
    try:
        with open(compose_path, "w") as f:
            f.write(compose)
    except Exception as e:
        errors.append(f"Failed to write docker-compose.yml: {e}")

    # Set hostname if on IORA OS
    if IS_IORA_OS and config.get("hostname"):
        try:
            subprocess.run(
                ["hostnamectl", "set-hostname", config["hostname"]],
                check=False, capture_output=True
            )
        except Exception:
            pass

    # Set timezone if on IORA OS
    if IS_IORA_OS and config.get("timezone"):
        try:
            subprocess.run(
                ["timedatectl", "set-timezone", config["timezone"]],
                check=False, capture_output=True
            )
        except Exception:
            pass

    # Write .env file for docker-compose
    env_path = os.path.join(DATA_DIR, ".env")
    try:
        env_lines = [
            f"IORA_HOSTNAME={config.get('hostname', 'iora')}",
            f"IORA_TIMEZONE={config.get('timezone', 'Europe/Berlin')}",
            f"IORA_LANGUAGE={config.get('language', 'de')}",
            f"IORA_COUNTRY={config.get('country', 'DE')}",
            f"IORA_UNIT_SYSTEM={config.get('unit_system', 'metric')}",
            f"IORA_DATA_DIR={DATA_DIR}",
            f"COMPOSE_PROJECT_NAME=iora",
        ]
        with open(env_path, "w") as f:
            f.write("\n".join(env_lines) + "\n")
    except Exception as e:
        errors.append(f"Failed to write .env: {e}")

    # Mark setup as complete
    try:
        with open(SETUP_DONE_FLAG, "w") as f:
            f.write("1\n")
    except Exception as e:
        errors.append(f"Failed to write setup flag: {e}")

    # Disable setup service if on IORA OS
    if IS_IORA_OS:
        try:
            subprocess.run(
                ["systemctl", "disable", "iora-setup.service"],
                check=False, capture_output=True
            )
        except Exception:
            pass

    # Start the IORA stack. Do this *synchronously* via systemctl so we
    # surface pull/start errors in the web UI instead of firing-and-
    # forgetting `docker compose up`, which hid every failure and left
    # the user with no ports open. We call iora-stack.service so the
    # unit's ExecStartPre (retry pull) + ExecStart + reconcile loop
    # apply to the user-chosen compose.yml, not just at first boot.
    if config.get("auto_start", True):
        try:
            if IS_IORA_OS:
                # Block (up to 4 min) so the UI can show pull errors
                # instead of returning immediately and leaving the user
                # staring at a "Setup Complete!" page while nothing is
                # actually listening.
                cp = subprocess.run(
                    ["systemctl", "restart", "iora-stack.service"],
                    capture_output=True, text=True, timeout=240,
                )
                if cp.returncode != 0:
                    errors.append(
                        f"iora-stack.service failed to start: "
                        f"{(cp.stderr or cp.stdout or '').strip()[:400]}"
                    )
            else:
                cp = subprocess.run(
                    ["docker", "compose", "up", "-d", "--remove-orphans"],
                    cwd=DATA_DIR,
                    capture_output=True, text=True, timeout=300,
                )
                if cp.returncode != 0:
                    errors.append(
                        f"docker compose up failed: "
                        f"{(cp.stderr or cp.stdout or '').strip()[:400]}"
                    )
        except Exception as e:
            errors.append(f"Failed to start stack: {e}")

    return errors


def generate_compose(config):
    """Generate a docker-compose.yml for the IORA stack.

    IORA OS self-build model: all IORA system containers are built locally
    from Dockerfiles and pre-compiled binaries bundled in the OS image at
    /opt/iora/build/.  No external registry is contacted at runtime.
    """
    hostname = config.get("hostname", "iora")
    tz = config.get("timezone", "Europe/Berlin")

    compose = f"""# IORA Home — Docker Compose Configuration
# Generated by IORA Setup Wizard
# https://iora.home
#
# IORA OS self-build model: all IORA system containers are built locally
# from Dockerfiles bundled in the OS at /opt/iora/build/.  The
# iora-build-images.service ran on first boot to build the images.
# No images are pulled from external registries.

version: "3.8"

services:
  # ── IORA Core — central orchestrator ──────────────────────────────────────
  # Built locally from /opt/iora/build/iora-core/Dockerfile.
  # Image tag iora/core:latest is assigned at build time by iora-build-images.
  iora-core:
    image: iora/core:latest
    container_name: iora-core
    restart: unless-stopped
    environment:
      - TZ={tz}
      - IORA_HOSTNAME={hostname}
      - IORA_LANGUAGE={config.get('language', 'de')}
      - IORA_COUNTRY={config.get('country', 'DE')}
      - IORA_UNIT_SYSTEM={config.get('unit_system', 'metric')}
      - RUST_LOG=${{RUST_LOG:-info}}
    volumes:
      - ${{IORA_DATA_DIR:-/mnt/data/iora}}/config:/config
      - /run/dbus:/run/dbus:ro
      - /etc/localtime:/etc/localtime:ro
    ports:
      - "8090:8090"
    networks:
      - iora-network
    labels:
      iora.managed: "true"
      iora.service: "core"
      iora.self-built: "true"

  # ── IORA Home — smart-home server ─────────────────────────────────────────
  # Built locally from /opt/iora/build/iora-home/Dockerfile.
  iora-home:
    image: iora/home:latest
    container_name: iora-home
    restart: unless-stopped
    environment:
      - TZ={tz}
      - PORT=8080
      - DATABASE_URL=postgres://iora:${{IORA_DB_PASSWORD:-iora}}@iora-db:5432/iora_home
      - IORA_CORE_URL=http://iora-core:8090
      - JWT_SECRET=${{JWT_SECRET:-changeme}}
      - RUST_LOG=${{RUST_LOG:-info}}
    volumes:
      - ${{IORA_DATA_DIR:-/mnt/data/iora}}/home:/data
      - /etc/localtime:/etc/localtime:ro
    ports:
      - "8080:8080"
    networks:
      - iora-network
    depends_on:
      iora-db:
        condition: service_healthy
      iora-core:
        condition: service_started
    labels:
      iora.managed: "true"
      iora.service: "home"
      iora.self-built: "true"

  # ── IORA Supervisor — container orchestration ──────────────────────────────
  # Built locally from /opt/iora/build/iora-supervisor/Dockerfile.
  iora-supervisor:
    image: iora/supervisor:latest
    container_name: iora-supervisor
    restart: unless-stopped
    environment:
      - TZ={tz}
      - PORT=8097
      - SUPERVISOR_SHARE=${{IORA_DATA_DIR:-/mnt/data/iora}}
      - IORA_OS=true
      - RUST_LOG=${{RUST_LOG:-info}}
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ${{IORA_DATA_DIR:-/mnt/data/iora}}:/data
    ports:
      - "8097:8097"
    networks:
      - iora-network
    privileged: true
    depends_on:
      - iora-core
    labels:
      iora.managed: "true"
      iora.service: "supervisor"
      iora.self-built: "true"

  # ── IORA Watchdog — health monitoring ─────────────────────────────────────
  iora-watchdog:
    image: iora/watchdog:latest
    container_name: iora-watchdog
    restart: unless-stopped
    environment:
      - PORT=8094
      - IORA_CORE_URL=http://iora-core:8090
      - RUST_LOG=${{RUST_LOG:-info}}
    ports:
      - "8094:8094"
    networks:
      - iora-network
    depends_on:
      - iora-core
    labels:
      iora.managed: "true"
      iora.service: "watchdog"
      iora.self-built: "true"

  # ── IORA Secrets — encrypted secrets storage ──────────────────────────────
  iora-secrets:
    image: iora/secrets:latest
    container_name: iora-secrets
    restart: unless-stopped
    environment:
      - PORT=8093
      - DATABASE_URL=postgres://iora:${{IORA_DB_PASSWORD:-iora}}@iora-db:5432/iora_secrets
      - SECRETS_MASTER_KEY=${{SECRETS_MASTER_KEY:-}}
      - RUST_LOG=${{RUST_LOG:-info}}
    volumes:
      - ${{IORA_DATA_DIR:-/mnt/data/iora}}/secrets:/var/lib/iora
    networks:
      - iora-network
    depends_on:
      iora-db:
        condition: service_healthy
    labels:
      iora.managed: "true"
      iora.service: "secrets"
      iora.self-built: "true"

  # ── PostgreSQL — infrastructure database (official image) ─────────────────
  # This is not an IORA system container; it uses the official postgres image.
  iora-db:
    image: postgres:16-alpine
    container_name: iora-db
    restart: unless-stopped
    environment:
      - POSTGRES_USER=iora
      - POSTGRES_PASSWORD=${{IORA_DB_PASSWORD:-iora}}
      - POSTGRES_DB=iora_home
      - TZ={tz}
    volumes:
      - ${{IORA_DATA_DIR:-/mnt/data/iora}}/db:/var/lib/postgresql/data
    networks:
      - iora-network
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U iora"]
      interval: 10s
      timeout: 5s
      retries: 5
    labels:
      iora.managed: "true"
      iora.service: "postgres"

  # ── Mosquitto MQTT broker (official image) ────────────────────────────────
  iora-mqtt:
    image: eclipse-mosquitto:2
    container_name: iora-mqtt
    restart: unless-stopped
    volumes:
      - ${{IORA_DATA_DIR:-/mnt/data/iora}}/mqtt/config:/mosquitto/config
      - ${{IORA_DATA_DIR:-/mnt/data/iora}}/mqtt/data:/mosquitto/data
    networks:
      - iora-network
    ports:
      - "1883:1883"
    labels:
      iora.managed: "true"
      iora.service: "mqtt"

networks:
  iora-network:
    driver: bridge
"""

    if config.get("enable_zigbee"):
        compose += """
  zigbee2mqtt:
    image: koenkk/zigbee2mqtt:latest
    container_name: iora-zigbee
    restart: unless-stopped
    environment:
      - TZ=${TZ}
    volumes:
      - ${IORA_DATA_DIR:-/mnt/data/iora}/zigbee:/app/data
    devices:
      - ${IORA_ZIGBEE_DEVICE:-/dev/ttyUSB0}:/dev/ttyACM0
    networks:
      - iora-network
    ports:
      - "8082:8080"
    labels:
      iora.managed: "true"
      iora.service: "zigbee2mqtt"
"""

    if config.get("enable_zwave"):
        compose += """
  zwave:
    image: zwave-js/zwave-js-ui:latest
    container_name: iora-zwave
    restart: unless-stopped
    environment:
      - TZ=${TZ}
    volumes:
      - ${IORA_DATA_DIR:-/mnt/data/iora}/zwave:/usr/src/app/store
    devices:
      - ${IORA_ZWAVE_DEVICE:-/dev/ttyUSB1}:/dev/zwave
    networks:
      - iora-network
    ports:
      - "8091:8091"
      - "3000:3000"
    labels:
      iora.managed: "true"
      iora.service: "zwave"
"""

    return compose


# ── HTML Templates ─────────────────────────────────────────────────

SETUP_HTML = r"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>IORA Home Setup</title>
<style>
:root {
  --bg: #0f172a;
  --surface: #1e293b;
  --surface2: #334155;
  --border: #475569;
  --primary: #3b82f6;
  --primary-hover: #2563eb;
  --primary-light: #1d4ed8;
  --success: #22c55e;
  --warn: #f59e0b;
  --danger: #ef4444;
  --text: #f1f5f9;
  --text2: #94a3b8;
  --text3: #64748b;
  --radius: 12px;
}
* { margin:0; padding:0; box-sizing:border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
}
.container {
  max-width: 680px;
  margin: 0 auto;
  padding: 24px 20px;
}
.logo {
  text-align: center;
  padding: 40px 0 20px;
}
.logo h1 {
  font-size: 2.2rem;
  font-weight: 700;
  letter-spacing: -0.5px;
}
.logo h1 span { color: var(--primary); }
.logo p {
  color: var(--text2);
  margin-top: 6px;
  font-size: 0.95rem;
}

/* Progress bar */
.progress-bar {
  display: flex;
  gap: 4px;
  margin: 24px 0 32px;
}
.progress-bar .step {
  flex: 1;
  height: 4px;
  background: var(--surface2);
  border-radius: 2px;
  transition: background 0.3s;
}
.progress-bar .step.done { background: var(--primary); }
.progress-bar .step.active { background: var(--primary); animation: pulse 1.5s infinite; }
@keyframes pulse {
  0%,100% { opacity:1; } 50% { opacity:0.5; }
}

/* Cards */
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 28px;
  margin-bottom: 20px;
}
.card h2 {
  font-size: 1.3rem;
  margin-bottom: 4px;
}
.card .subtitle {
  color: var(--text2);
  font-size: 0.9rem;
  margin-bottom: 20px;
}

/* Form elements */
.form-group {
  margin-bottom: 18px;
}
.form-group label {
  display: block;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text2);
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.form-group input, .form-group select {
  width: 100%;
  padding: 10px 14px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  font-size: 0.95rem;
  outline: none;
  transition: border 0.2s;
}
.form-group input:focus, .form-group select:focus {
  border-color: var(--primary);
}
.form-group select option { background: var(--bg); }

/* Toggles */
.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 0;
  border-bottom: 1px solid var(--surface2);
}
.toggle-row:last-child { border-bottom: none; }
.toggle-row .info h3 {
  font-size: 0.95rem;
  font-weight: 500;
}
.toggle-row .info p {
  font-size: 0.8rem;
  color: var(--text3);
  margin-top: 2px;
}
.toggle {
  position: relative;
  width: 48px;
  height: 26px;
  flex-shrink: 0;
}
.toggle input {
  opacity: 0;
  width: 0;
  height: 0;
}
.toggle .slider {
  position: absolute;
  inset: 0;
  background: var(--surface2);
  border-radius: 13px;
  cursor: pointer;
  transition: background 0.2s;
}
.toggle .slider:before {
  content: "";
  position: absolute;
  width: 20px;
  height: 20px;
  left: 3px;
  bottom: 3px;
  background: var(--text);
  border-radius: 50%;
  transition: transform 0.2s;
}
.toggle input:checked + .slider { background: var(--primary); }
.toggle input:checked + .slider:before { transform: translateX(22px); }

/* Buttons */
.btn-row {
  display: flex;
  gap: 12px;
  margin-top: 24px;
}
.btn {
  flex: 1;
  padding: 12px 20px;
  border: none;
  border-radius: 8px;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s, transform 0.1s;
}
.btn:active { transform: scale(0.98); }
.btn-primary {
  background: var(--primary);
  color: #fff;
}
.btn-primary:hover { background: var(--primary-hover); }
.btn-secondary {
  background: var(--surface2);
  color: var(--text);
}
.btn-secondary:hover { background: var(--border); }

/* System info grid */
.info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.info-item {
  background: var(--bg);
  padding: 14px;
  border-radius: 8px;
  border: 1px solid var(--surface2);
}
.info-item .label {
  font-size: 0.75rem;
  color: var(--text3);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.info-item .value {
  font-size: 1.1rem;
  font-weight: 600;
  margin-top: 4px;
}
.info-item .value.ok { color: var(--success); }
.info-item .value.warn { color: var(--warn); }

/* Status indicator */
.status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 6px;
}
.status-dot.green { background: var(--success); }
.status-dot.red { background: var(--danger); }
.status-dot.yellow { background: var(--warn); }

/* Finish screen */
.finish-box {
  text-align: center;
  padding: 20px 0;
}
.finish-box .icon {
  font-size: 4rem;
  margin-bottom: 16px;
}
.finish-box h2 {
  font-size: 1.5rem;
  margin-bottom: 8px;
}
.finish-box .url {
  display: inline-block;
  background: var(--bg);
  border: 1px solid var(--primary);
  border-radius: 8px;
  padding: 12px 24px;
  margin: 16px 0;
  font-size: 1.1rem;
  font-family: monospace;
  color: var(--primary);
}

/* Loading spinner */
.spinner {
  border: 3px solid var(--surface2);
  border-top: 3px solid var(--primary);
  border-radius: 50%;
  width: 40px;
  height: 40px;
  animation: spin 1s linear infinite;
  margin: 20px auto;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* Hide steps */
.step-page { display: none; }
.step-page.active { display: block; }

/* Responsive */
@media (max-width: 600px) {
  .info-grid { grid-template-columns: 1fr; }
  .logo h1 { font-size: 1.6rem; }
}
</style>
</head>
<body>
<div class="container">

<div class="logo">
  <h1><span>IORA</span> Home</h1>
  <p>Initial Setup Wizard</p>
</div>

<div class="progress-bar" id="progressBar">
  <div class="step active" id="prog-0"></div>
  <div class="step" id="prog-1"></div>
  <div class="step" id="prog-2"></div>
  <div class="step" id="prog-3"></div>
  <div class="step" id="prog-4"></div>
</div>

<!-- Step 0: System Info -->
<div class="step-page active" id="step-0">
<div class="card">
  <h2>System Overview</h2>
  <p class="subtitle">Your system at a glance</p>
  <div class="info-grid" id="sysInfoGrid">
    <div class="info-item">
      <div class="label">Hostname</div>
      <div class="value" id="si-hostname">--</div>
    </div>
    <div class="info-item">
      <div class="label">Version</div>
      <div class="value" id="si-version">--</div>
    </div>
    <div class="info-item">
      <div class="label">Memory</div>
      <div class="value" id="si-memory">--</div>
    </div>
    <div class="info-item">
      <div class="label">Disk Free</div>
      <div class="value" id="si-disk">--</div>
    </div>
    <div class="info-item">
      <div class="label">Docker</div>
      <div class="value" id="si-docker">--</div>
    </div>
    <div class="info-item">
      <div class="label">Network</div>
      <div class="value" id="si-network">--</div>
    </div>
  </div>
  <div class="btn-row">
    <button class="btn btn-primary" onclick="goStep(1)">Start Setup</button>
  </div>
</div>
</div>

<!-- Step 1: General -->
<div class="step-page" id="step-1">
<div class="card">
  <h2>General Settings</h2>
  <p class="subtitle">Configure your IORA Home instance</p>
  <div class="form-group">
    <label>Instance Name</label>
    <input type="text" id="cfg-hostname" value="iora" placeholder="iora">
  </div>
  <div class="form-group">
    <label>Language</label>
    <select id="cfg-language">
      <option value="de" selected>Deutsch</option>
      <option value="en">English</option>
      <option value="fr">Francais</option>
      <option value="es">Espanol</option>
      <option value="it">Italiano</option>
      <option value="nl">Nederlands</option>
    </select>
  </div>
  <div class="form-group">
    <label>Country</label>
    <select id="cfg-country">
      <option value="DE" selected>Deutschland</option>
      <option value="AT">Oesterreich</option>
      <option value="CH">Schweiz</option>
      <option value="GB">United Kingdom</option>
      <option value="FR">France</option>
      <option value="US">United States</option>
      <option value="NL">Nederland</option>
      <option value="IT">Italia</option>
      <option value="ES">Espana</option>
    </select>
  </div>
  <div class="form-group">
    <label>Timezone</label>
    <select id="cfg-timezone">
      <option value="Europe/Berlin" selected>Europe/Berlin</option>
      <option value="Europe/Vienna">Europe/Vienna</option>
      <option value="Europe/Zurich">Europe/Zurich</option>
      <option value="Europe/London">Europe/London</option>
      <option value="Europe/Paris">Europe/Paris</option>
      <option value="Europe/Amsterdam">Europe/Amsterdam</option>
      <option value="Europe/Rome">Europe/Rome</option>
      <option value="Europe/Madrid">Europe/Madrid</option>
      <option value="US/Eastern">US/Eastern</option>
      <option value="US/Pacific">US/Pacific</option>
      <option value="UTC">UTC</option>
    </select>
  </div>
  <div class="form-group">
    <label>Unit System</label>
    <select id="cfg-unit">
      <option value="metric" selected>Metric (C, km, kg)</option>
      <option value="imperial">Imperial (F, mi, lb)</option>
    </select>
  </div>
  <div class="btn-row">
    <button class="btn btn-secondary" onclick="goStep(0)">Back</button>
    <button class="btn btn-primary" onclick="goStep(2)">Next</button>
  </div>
</div>
</div>

<!-- Step 2: Integrations -->
<div class="step-page" id="step-2">
<div class="card">
  <h2>Integrations</h2>
  <p class="subtitle">Enable smart home protocols</p>
  <div class="toggle-row">
    <div class="info">
      <h3>MQTT Broker</h3>
      <p>Message bus for IoT devices (Mosquitto)</p>
    </div>
    <label class="toggle">
      <input type="checkbox" id="cfg-mqtt" checked>
      <span class="slider"></span>
    </label>
  </div>
  <div class="toggle-row">
    <div class="info">
      <h3>Zigbee (Zigbee2MQTT)</h3>
      <p>Control Zigbee devices via USB adapter</p>
    </div>
    <label class="toggle">
      <input type="checkbox" id="cfg-zigbee">
      <span class="slider"></span>
    </label>
  </div>
  <div class="toggle-row">
    <div class="info">
      <h3>Z-Wave</h3>
      <p>Control Z-Wave devices via USB adapter</p>
    </div>
    <label class="toggle">
      <input type="checkbox" id="cfg-zwave">
      <span class="slider"></span>
    </label>
  </div>
  <div class="toggle-row">
    <div class="info">
      <h3>Database (PostgreSQL)</h3>
      <p>Persistent storage for history and events</p>
    </div>
    <label class="toggle">
      <input type="checkbox" id="cfg-db" checked>
      <span class="slider"></span>
    </label>
  </div>
  <div class="btn-row">
    <button class="btn btn-secondary" onclick="goStep(1)">Back</button>
    <button class="btn btn-primary" onclick="goStep(3)">Next</button>
  </div>
</div>
</div>

<!-- Step 3: Network / Advanced -->
<div class="step-page" id="step-3">
<div class="card">
  <h2>Advanced Settings</h2>
  <p class="subtitle">Optional configuration</p>
  <div class="toggle-row">
    <div class="info">
      <h3>Auto-start services</h3>
      <p>Start IORA containers on boot</p>
    </div>
    <label class="toggle">
      <input type="checkbox" id="cfg-autostart" checked>
      <span class="slider"></span>
    </label>
  </div>
  <div class="toggle-row">
    <div class="info">
      <h3>Automatic updates</h3>
      <p>Keep containers up to date (via Watchtower)</p>
    </div>
    <label class="toggle">
      <input type="checkbox" id="cfg-autoupdate" checked>
      <span class="slider"></span>
    </label>
  </div>
  <div class="toggle-row">
    <div class="info">
      <h3>SSH Access</h3>
      <p>Remote terminal access (already enabled)</p>
    </div>
    <label class="toggle">
      <input type="checkbox" id="cfg-ssh" checked>
      <span class="slider"></span>
    </label>
  </div>
  <div class="btn-row">
    <button class="btn btn-secondary" onclick="goStep(2)">Back</button>
    <button class="btn btn-primary" onclick="doInstall()">Finish Setup</button>
  </div>
</div>
</div>

<!-- Step 4: Applying -->
<div class="step-page" id="step-4">
<div class="card">
  <div class="finish-box" id="applyingBox">
    <div class="spinner"></div>
    <h2>Applying Configuration...</h2>
    <p class="subtitle">Setting up your IORA Home instance</p>
  </div>
  <div class="finish-box" id="doneBox" style="display:none">
    <div class="icon">&#10003;</div>
    <h2>Setup Complete!</h2>
    <p class="subtitle">Your IORA Home instance is ready.</p>
    <div class="url" id="finalUrl">http://iora:8126</div>
    <p class="subtitle" style="margin-top:16px">
      The IORA Home dashboard will be available<br>
      at the address above in a few moments.
    </p>
    <div class="btn-row" style="justify-content:center">
      <button class="btn btn-primary" onclick="openDashboard()" style="flex:none;padding:12px 40px">
        Open Dashboard
      </button>
    </div>
  </div>
</div>
</div>

</div>

<script>
let currentStep = 0;
let sysInfo = {};

async function loadSysInfo() {
  try {
    const r = await fetch('/api/sysinfo');
    sysInfo = await r.json();
    document.getElementById('si-hostname').textContent = sysInfo.hostname || '--';
    document.getElementById('si-version').textContent = sysInfo.version || '--';
    document.getElementById('si-memory').textContent = sysInfo.memory_mb ? sysInfo.memory_mb + ' MB' : '--';
    document.getElementById('si-disk').textContent = sysInfo.disk_free_gb
      ? sysInfo.disk_free_gb + ' / ' + sysInfo.disk_total_gb + ' GB'
      : '--';

    const dockerEl = document.getElementById('si-docker');
    if (sysInfo.docker) {
      dockerEl.innerHTML = '<span class="status-dot green"></span>Running';
      dockerEl.className = 'value ok';
    } else {
      dockerEl.innerHTML = '<span class="status-dot red"></span>Not found';
      dockerEl.className = 'value warn';
    }

    const netEl = document.getElementById('si-network');
    if (sysInfo.interfaces && sysInfo.interfaces.length > 0) {
      const active = sysInfo.interfaces.find(i => i.ipv4);
      if (active) {
        netEl.innerHTML = '<span class="status-dot green"></span>' + active.ipv4;
        netEl.className = 'value ok';
      } else {
        netEl.innerHTML = '<span class="status-dot yellow"></span>No IP';
        netEl.className = 'value warn';
      }
    } else {
      netEl.textContent = 'N/A';
    }

    // Pre-fill hostname
    if (sysInfo.hostname) {
      document.getElementById('cfg-hostname').value = sysInfo.hostname;
    }
  } catch(e) {
    console.error('Failed to load system info:', e);
  }
}

function goStep(n) {
  document.getElementById('step-' + currentStep).classList.remove('active');
  document.getElementById('step-' + n).classList.add('active');
  for (let i = 0; i < 5; i++) {
    const el = document.getElementById('prog-' + i);
    el.classList.remove('done', 'active');
    if (i < n) el.classList.add('done');
    else if (i === n) el.classList.add('active');
  }
  currentStep = n;
  window.scrollTo(0, 0);
}

function gatherConfig() {
  return {
    hostname:       document.getElementById('cfg-hostname').value || 'iora',
    language:       document.getElementById('cfg-language').value,
    country:        document.getElementById('cfg-country').value,
    timezone:       document.getElementById('cfg-timezone').value,
    unit_system:    document.getElementById('cfg-unit').value,
    enable_mqtt:    document.getElementById('cfg-mqtt').checked,
    enable_zigbee:  document.getElementById('cfg-zigbee').checked,
    enable_zwave:   document.getElementById('cfg-zwave').checked,
    enable_db:      document.getElementById('cfg-db').checked,
    auto_start:     document.getElementById('cfg-autostart').checked,
    auto_update:    document.getElementById('cfg-autoupdate').checked,
    enable_ssh:     document.getElementById('cfg-ssh').checked,
  };
}

async function doInstall() {
  goStep(4);
  const config = gatherConfig();
  try {
    const r = await fetch('/api/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    const result = await r.json();
    setTimeout(() => {
      document.getElementById('applyingBox').style.display = 'none';
      document.getElementById('doneBox').style.display = 'block';
      const ip = location.hostname;
      document.getElementById('finalUrl').textContent = 'http://' + ip + ':8126';
      // Surface any backend errors (pull failures, compose errors, ...)
      // instead of pretending setup finished cleanly. The user complained
      // "nothing happens after setup" precisely because these were hidden.
      if (result && result.errors && result.errors.length) {
        const box = document.getElementById('doneBox');
        const warn = document.createElement('div');
        warn.className = 'subtitle';
        warn.style.cssText = 'margin-top:16px;color:#c94f4f;white-space:pre-wrap;text-align:left;font-family:monospace;font-size:12px;background:#2a1a1a;padding:12px;border-radius:6px;max-height:180px;overflow:auto';
        warn.textContent = 'Warnings:\n' + result.errors.join('\n');
        box.appendChild(warn);
      }
    }, 3000);
  } catch(e) {
    alert('Setup failed: ' + e);
  }
}

function openDashboard() {
  const url = document.getElementById('finalUrl').textContent;
  window.location.href = url;
}

// Init
loadSysInfo();
</script>
</body>
</html>"""


class SetupHandler(http.server.BaseHTTPRequestHandler):
    """HTTP request handler for the setup wizard."""

    def log_message(self, format, *args):
        """Suppress default logging."""
        pass

    def _send_json(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def _send_html(self, html, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(html.encode())

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path

        if path == "/" or path == "/setup":
            self._send_html(SETUP_HTML)
        elif path == "/api/sysinfo":
            self._send_json(get_system_info())
        elif path == "/api/status":
            done = os.path.exists(SETUP_DONE_FLAG)
            self._send_json({"setup_complete": done})
        elif path == "/api/packages":
            self._send_json(fetch_available_packages())
        elif path == "/api/os-update":
            self._send_json(check_os_update())
        elif path == "/api/network":
            # Read current network config via iora-netctl.
            self._send_json(self._call_netctl(["status"]))
        else:
            self.send_error(404)

    def _call_netctl(self, args, body=None):
        """Shell out to /usr/bin/iora-netctl — the canonical network
        configurator. Returns the parsed JSON dict on success, or a dict
        with {ok: False, error: …} on failure. Keeping this as a CLI hop
        means the Control Center (which runs in a container) can use the
        exact same interface via `docker exec`, SSH, or an HTTP proxy.
        """
        try:
            cmd = ["/usr/bin/iora-netctl"] + list(args)
            input_bytes = body.encode("utf-8") if body else None
            r = subprocess.run(cmd, input=input_bytes, capture_output=True,
                               timeout=60)
            try:
                return json.loads(r.stdout or r.stderr or b"{}")
            except Exception:
                return {"ok": r.returncode == 0,
                        "stdout": r.stdout.decode("utf-8", "replace"),
                        "stderr": r.stderr.decode("utf-8", "replace")}
        except FileNotFoundError:
            return {"ok": False, "error": "iora-netctl not installed"}
        except subprocess.TimeoutExpired:
            return {"ok": False, "error": "iora-netctl timed out"}

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path

        if path == "/api/network":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length).decode("utf-8", "replace")
            result = self._call_netctl(["set", "-"], body=body)
            status = 200 if result.get("ok") else 400
            self._send_json(result, status)
            return

        if path == "/api/network/rollback":
            self._send_json(self._call_netctl(["rollback"]))
            return

        if path == "/api/apply":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)
            try:
                config = json.loads(body)
            except json.JSONDecodeError:
                self._send_json({"ok": False, "error": "Invalid JSON"}, 400)
                return

            save_config(config)
            errors = apply_config(config)

            if errors:
                self._send_json({"ok": False, "errors": errors})
            else:
                self._send_json({"ok": True})

                # Schedule shutdown of setup server after response
                def shutdown_later():
                    import time
                    time.sleep(10)
                    print("Setup complete. Shutting down setup server.")
                    os._exit(0)

                threading.Thread(target=shutdown_later, daemon=True).start()
        else:
            self.send_error(404)


def main():
    # Check if setup is already complete
    if os.path.exists(SETUP_DONE_FLAG):
        print(f"Setup already completed. Remove {SETUP_DONE_FLAG} to re-run.")
        sys.exit(0)

    server = http.server.HTTPServer(("0.0.0.0", SETUP_PORT), SetupHandler)
    hostname = socket.gethostname()

    # Get first IP
    ip = "0.0.0.0"
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
    except Exception:
        pass

    print(f"IORA Home Setup Wizard")
    print(f"  http://{ip}:{SETUP_PORT}")
    print(f"  http://{hostname}:{SETUP_PORT}")
    print()
    print("Waiting for setup to be completed via web browser...")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nSetup server stopped.")
        server.server_close()


if __name__ == "__main__":
    main()
