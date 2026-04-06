"""Diagnostics support for MDT HOME Dashboard.

Provides diagnostic data to the HA diagnostics panel, including
backend health, cache metrics, and integration status.
"""
from __future__ import annotations

from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import CONF_DASHBOARD_URL, DATA_CLIENT, DATA_COORDINATOR, DOMAIN


async def async_get_config_entry_diagnostics(
    hass: HomeAssistant, entry: ConfigEntry
) -> dict[str, Any]:
    """Return diagnostics for a config entry."""
    entry_data = hass.data.get(DOMAIN, {}).get(entry.entry_id, {})
    coordinator = entry_data.get(DATA_COORDINATOR)
    client = entry_data.get(DATA_CLIENT)

    diagnostics: dict[str, Any] = {
        "config_entry": {
            "entry_id": entry.entry_id,
            "dashboard_url": entry.data.get(CONF_DASHBOARD_URL, "not configured"),
            "version": entry.version,
        },
        "coordinator_data": {},
        "backend_health": {},
        "backend_statistics": {},
    }

    # Coordinator data
    if coordinator and coordinator.data:
        data = coordinator.data
        diagnostics["coordinator_data"] = {
            "status": data.get("status", "unknown"),
            "online": data.get("online", False),
            "ha_connected": data.get("ha_connected", False),
            "ha_ws_connected": data.get("ha_ws_connected", False),
            "connected_clients": data.get("connected_clients", 0),
            "entity_count": data.get("entity_count", 0),
            "version": data.get("version", "unknown"),
            "timestamp": data.get("timestamp"),
            "diagnostics": data.get("diagnostics", {}),
        }

    # Live backend health check
    if client:
        try:
            health = await client.health()
            diagnostics["backend_health"] = health
        except Exception as err:
            diagnostics["backend_health"] = {"error": str(err)}

        # Backend statistics
        try:
            stats = await client.get_statistics()
            diagnostics["backend_statistics"] = stats
        except Exception as err:
            diagnostics["backend_statistics"] = {"error": str(err)}

    return diagnostics
