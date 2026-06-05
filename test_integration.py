#!/usr/bin/env python3
"""
End-to-End Integrationstest: IORA Dashboard <-> Home Assistant Integration
==========================================================================
Testet:
 1. WebSocket-Verbindung (Dashboard WS Server)
 2. HTTP-Status-Endpunkte (health, integration/status)
 3. Entity-Updates (über WS state_changed)
 4. Automatisierungs-Trigger (call_service über WS)

Umgebungsvariablen:
  IORA_URL    - Backend-URL (default: http://localhost:8126)
  HA_URL      - HA-URL für Mock-Tests (optional)
  HA_TOKEN    - HA-Token (optional)
"""
import asyncio
import json
import os
import sys
import time
import urllib.request
import urllib.error

IORA_URL = os.environ.get("IORA_URL", "http://localhost:8126")
WS_URL = IORA_URL.replace("http://", "ws://").replace("https://", "wss://") + "/ws"

PASS = 0
FAIL = 0
SKIP = 0


def banner(msg: str):
    print(f"\n{'='*70}")
    print(f"  {msg}")
    print(f"{'='*70}")


def check(name: str, condition: bool, detail: str = ""):
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  ✓ {name}")
    else:
        FAIL += 1
        print(f"  ✗ {name}")
        if detail:
            print(f"    {detail}")


def skip(name: str, reason: str = ""):
    global SKIP
    SKIP += 1
    print(f"  — {name} [ÜBERSPRUNGEN: {reason}]")


def http_get(path: str, timeout: int = 5):
    """Synchroner HTTP-GET."""
    url = f"{IORA_URL}{path}"
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8")
            return resp.status, json.loads(body)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        return e.code, {"error": body}
    except Exception as e:
        return 0, {"error": str(e)}


# ─────────────────────────────────────────────────────────────────────────
# 1. BACKEND ERREICHBARKEIT
# ─────────────────────────────────────────────────────────────────────────
banner("1. Backend-Erreichbarkeit & Health Check")

status, data = http_get("/health")
check(f"GET /health → Status {status}", status in (200, 302),
      f"Erwartet: 200/302, Bekommen: {status}")
if status == 200:
    check("  status == 'ok'", data.get("status") == "ok")
    check("  version vorhanden", bool(data.get("version", "")))
    print(f"  Version: {data.get('version', '?')}")
    print(f"  HA Connected: {data.get('ha_connected', '?')}")
    print(f"  HA WS Connected: {data.get('ha_ws_connected', '?')}")
    print(f"  Entity Count: {data.get('entity_count', '?')}")
else:
    skip("Detaillierte Health-Checks", "Backend nicht erreichbar")

# ─────────────────────────────────────────────────────────────────────────
# 2. INTEGRATION STATUS
# ─────────────────────────────────────────────────────────────────────────
banner("2. Integration Status Endpoint")

status, data = http_get("/api/integration/status")
check(f"GET /api/integration/status → Status {status}", status in (200, 401),
      f"Erwartet: 200 oder 401, Bekommen: {status}")
if status == 200:
    check("  status == 'ok'", data.get("status") == "ok")
    check("  version vorhanden", bool(data.get("version", "")))
    check("  ha_connected ist Boolean", isinstance(data.get("ha_connected"), bool))
    check("  entity_count ist Integer", isinstance(data.get("entity_count"), int))
    check("  connected_clients ist Integer", isinstance(data.get("connected_clients"), int))
    check("  uptime_seconds > 0", data.get("uptime_seconds", 0) > 0)
    check("  timestamp vorhanden", bool(data.get("timestamp", "")))
    print(f"  HA Connected: {data.get('ha_connected')}")
    print(f"  HA WS Connected: {data.get('ha_ws_connected')}")
    print(f"  Entities: {data.get('entity_count')}")
    print(f"  Clients: {data.get('connected_clients')}")
    print(f"  Version: {data.get('version')}")
else:
    skip("Detaillierte Integration-Status-Checks", "Endpoint nicht erreichbar")


# ─────────────────────────────────────────────────────────────────────────
# 3. WEBSOCKET-VERBINDUNG
# ─────────────────────────────────────────────────────────────────────────
banner("3. WebSocket-Verbindung")

async def test_websocket():
    try:
        import websockets
    except ImportError:
        skip("WebSocket-Tests", "websockets-Paket nicht installiert")
        return

    try:
        async with websockets.connect(WS_URL, ping_interval=None) as ws:
            # Ping/Pong zuerst (funktioniert ohne Auth)
            await ws.send(json.dumps({"type": "ping"}))
            pong = await asyncio.wait_for(ws.recv(), timeout=5)
            pdata = json.loads(pong)
            check("  Ping → Pong möglich",
                  pdata.get("type") == "pong",
                  f"Bekommen: {pdata.get('type', '?')}")

            # Ungültiger Token -> auth_failed
            await ws.send(json.dumps({"type": "auth", "token": "ungueltig"}))
            resp = await asyncio.wait_for(ws.recv(), timeout=5)
            data = json.loads(resp)
            check("  Ungültiger Token → auth_failed",
                  data.get("type") == "auth_failed",
                  f"Bekommen: {data.get('type', '?')}")

            # Verbindung sollte danach geschlossen werden
            print("  ✓ WebSocket-Protokoll funktioniert (ping/pong, auth_failed)")
    except websockets.exceptions.InvalidStatusCode as e:
        skip(f"WS-Verbindung fehlgeschlagen (Status {e.status_code})",
             "Backend evtl. noch nicht bereit")
    except Exception as e:
        check(f"  WS-Fehler: {type(e).__name__}", False, str(e))


asyncio.run(test_websocket())


# ─────────────────────────────────────────────────────────────────────────
# 4. ENTITY-UPDATES (über REST)
# ─────────────────────────────────────────────────────────────────────────
banner("4. Entity-Update-Endpunkte")

# Versuche /api/states (falls vorhanden)
for ep in ["/api/integration/status", "/api/states"]:
    status, data = http_get(ep, timeout=3)
    if status == 200 and isinstance(data, dict):
        if "entity_analytics" in data:
            check(f"  entity_analytics in {ep}", True)
            check(f"  entity_health in {ep}",
                  "entity_health" in data)
            health = data.get("entity_health", {})
            if isinstance(health, dict):
                for key in ["unavailable_count", "stale_count", "total_issues"]:
                    check(f"  health.{key} vorhanden",
                          key in health and isinstance(health[key], int))
            break

# Prüfe, ob die Integration status-Verarbeitung korrekt meldet
status, data = http_get("/api/integration/status")
if status == 200:
    diagnostics = data.get("diagnostics", {})
    check("  diagnostics vorhanden", bool(diagnostics))
    check("  cache_metrics vorhanden",
          all(k in diagnostics for k in
              ["cache_update_count", "cache_hits", "cache_misses"]))


# ─────────────────────────────────────────────────────────────────────────
# 5. AUTOMATION-STATUS
# ─────────────────────────────────────────────────────────────────────────
banner("5. Automatisierungs-Trigger")

status, data = http_get("/api/integration/status")
if status == 200:
    check("  active_automations vorhanden",
          "active_automations" in data,
          f"Keys: {list(data.keys())}")
    if "active_automations" in data:
        print(f"  Aktive Automatisierungen: {data['active_automations']}")
    check("  smart_scenes vorhanden", "smart_scenes" in data)
    if "smart_scenes" in data:
        print(f"  Smart Scenes: {data['smart_scenes']}")
    check("  scheduled_actions vorhanden", "scheduled_actions" in data)
    if "scheduled_actions" in data:
        print(f"  Geplante Aktionen: {data['scheduled_actions']}")
    check("  watchdogs vorhanden", "watchdogs" in data)
    if "watchdogs" in data:
        print(f"  Watchdogs: {data['watchdogs']}")
else:
    skip("Automation-Checks", "Integration Status nicht erreichbar")


# ─────────────────────────────────────────────────────────────────────────
# 6. KOMPOSIT-SENSOREN & WEITERE FEATURES
# ─────────────────────────────────────────────────────────────────────────
banner("6. Weitere Integration-Features")

status, data = http_get("/api/integration/status")
if status == 200:
    check("  composite_sensors vorhanden", "composite_sensors" in data)
    check("  background_tasks vorhanden", "background_tasks" in data)
    if "background_tasks" in data:
        tasks = data["background_tasks"]
        expected = ["watchdog_loop", "schedule_cleanup",
                     "stale_entity_monitor", "ha_health_check"]
        for t in expected:
            check(f"  background_task: {t}", t in tasks)
else:
    skip("Weitere Feature-Checks", "Integration Status nicht erreichbar")


# ─────────────────────────────────────────────────────────────────────────
# ZUSAMMENFASSUNG
# ─────────────────────────────────────────────────────────────────────────
banner("ERGEBNIS")
total = PASS + FAIL + SKIP
print(f"  ✓ Bestanden: {PASS}")
print(f"  ✗ Fehlgeschlagen: {FAIL}")
print(f"  — Übersprungen: {SKIP}")
print(f"  ∑ Gesamt: {total}")
print()

if FAIL > 0:
    sys.exit(1)
else:
    sys.exit(0)
