"""MDT HOME Dashboard Integration for Home Assistant.

Provides real-time connectivity between Home Assistant and the MDT HOME
Dashboard backend (Rust/Axum).  Sensors are backed by ``/api/integration/status``
so every metric shown in HA reflects actual dashboard state.
"""
from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

import aiohttp
import voluptuous as vol

try:
    from homeassistant.components import frontend as ha_frontend
except ImportError:
    ha_frontend = None  # type: ignore[assignment]
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_NAME, Platform
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from homeassistant.helpers.update_coordinator import DataUpdateCoordinator

from .const import (
    CONF_DASHBOARD_URL,
    CONF_PANEL_ENABLED,
    DATA_CLIENT,
    DATA_COORDINATOR,
    DEFAULT_SCAN_INTERVAL,
    DOMAIN,
    SERVICE_ACTIVATE_SCENE,
    SERVICE_REFRESH_STATE,
    SERVICE_SEND_NOTIFICATION,
    SERVICE_SET_BACKGROUND,
    SERVICE_SET_THEME,
    SERVICE_SWITCH_PAGE,
    SERVICE_TRIGGER_AUTOMATION,
    SERVICE_UPDATE_DASHBOARD,
    VERSION,
)

_LOGGER = logging.getLogger(__name__)

PLATFORMS = [
    Platform.SENSOR,
    Platform.SWITCH,
    Platform.BINARY_SENSOR,
    Platform.BUTTON,
    Platform.NUMBER,
    Platform.SELECT,
]

# Optional YAML configuration (backwards-compat, config-flow is preferred)
CONFIG_SCHEMA = vol.Schema(
    {
        DOMAIN: vol.Schema(
            {
                vol.Optional("dashboard_url"): cv.string,
                vol.Optional("enable_webhooks", default=True): cv.boolean,
            }
        )
    },
    extra=vol.ALLOW_EXTRA,
)

# ---------- Service schemas ----------

SERVICE_UPDATE_DASHBOARD_SCHEMA = vol.Schema(
    {
        vol.Required("entity_id"): cv.entity_id,
        vol.Optional("data"): dict,
    }
)

SERVICE_SEND_NOTIFICATION_SCHEMA = vol.Schema(
    {
        vol.Required("message"): cv.string,
        vol.Optional("title"): cv.string,
        vol.Optional("type", default="info"): vol.In(
            ["info", "warning", "error", "success"]
        ),
    }
)

SERVICE_SET_THEME_SCHEMA = vol.Schema(
    {
        vol.Required("theme"): vol.In(
            ["auto", "day", "evening", "night", "sleep"]
        ),
    }
)

SERVICE_SWITCH_PAGE_SCHEMA = vol.Schema(
    {vol.Required("page_id"): cv.string}
)

SERVICE_ACTIVATE_SCENE_SCHEMA = vol.Schema(
    {vol.Required("scene_id"): cv.string}
)

SERVICE_SET_BACKGROUND_SCHEMA = vol.Schema(
    {
        vol.Required("type"): vol.In(
            ["static", "slideshow", "video", "gradient"]
        ),
        vol.Optional("config"): dict,
    }
)

SERVICE_TRIGGER_AUTOMATION_SCHEMA = vol.Schema(
    {
        vol.Required("automation_id"): cv.string,
        vol.Optional("data"): dict,
    }
)


# ---------- Helpers ----------

class DashboardClient:
    """Thin HTTP wrapper around the dashboard backend API."""

    def __init__(self, url: str, session: aiohttp.ClientSession) -> None:
        self._base = url.rstrip("/")
        self._session = session

    async def get_status(self) -> dict[str, Any]:
        """GET /api/integration/status – used by the coordinator."""
        async with self._session.get(
            f"{self._base}/api/integration/status", timeout=aiohttp.ClientTimeout(total=10)
        ) as resp:
            resp.raise_for_status()
            return await resp.json()

    async def send_command(self, command: str, data: dict | None = None) -> dict:
        """POST /api/integration/command."""
        payload: dict[str, Any] = {"command": command}
        if data:
            payload["data"] = data
        async with self._session.post(
            f"{self._base}/api/integration/command",
            json=payload,
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            resp.raise_for_status()
            return await resp.json()

    async def health(self) -> dict:
        """GET /health."""
        async with self._session.get(
            f"{self._base}/health", timeout=aiohttp.ClientTimeout(total=5)
        ) as resp:
            resp.raise_for_status()
            return await resp.json()

    async def get_settings(self) -> dict[str, Any]:
        """GET /api/integration/settings."""
        async with self._session.get(
            f"{self._base}/api/integration/settings", timeout=aiohttp.ClientTimeout(total=10)
        ) as resp:
            resp.raise_for_status()
            data = await resp.json()
            return data.get("settings", {})

    async def set_settings(self, settings: dict[str, Any]) -> dict:
        """POST /api/integration/settings."""
        async with self._session.post(
            f"{self._base}/api/integration/settings",
            json=settings,
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            resp.raise_for_status()
            return await resp.json()


# ---------- Setup ----------

async def async_setup(hass: HomeAssistant, config: dict[str, Any]) -> bool:
    """Set up from configuration.yaml (optional)."""
    hass.data.setdefault(DOMAIN, {})
    if DOMAIN in config:
        hass.data[DOMAIN]["config"] = config[DOMAIN]
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up MDT HOME Dashboard from a config entry."""
    hass.data.setdefault(DOMAIN, {})

    dashboard_url = entry.data.get(CONF_DASHBOARD_URL, "")
    session = async_get_clientsession(hass, verify_ssl=False)
    client = DashboardClient(dashboard_url, session) if dashboard_url else None

    hass.data[DOMAIN][entry.entry_id] = {
        DATA_CLIENT: client,
        "url": dashboard_url,
    }

    # Create the data coordinator here so ALL platforms (sensor, binary_sensor,
    # etc.) can use it even when async_forward_entry_setups runs concurrently.
    async def _async_update_data() -> dict[str, Any]:
        """Poll the dashboard backend for live metrics."""
        if client is None:
            return {
                "status": "not_configured",
                "online": False,
                "ha_connected": False,
                "connected_clients": 0,
                "entity_count": 0,
                "version": VERSION,
                "timestamp": None,
            }
        try:
            data = await client.get_status()
            data["online"] = True
            return data
        except Exception as err:
            _LOGGER.debug("Dashboard unreachable: %s", err)
            return {
                "status": "offline",
                "online": False,
                "ha_connected": False,
                "connected_clients": 0,
                "entity_count": 0,
                "version": "unknown",
                "timestamp": None,
            }

    coordinator = DataUpdateCoordinator(
        hass,
        _LOGGER,
        name=f"{DOMAIN}_{entry.entry_id}",
        update_interval=timedelta(seconds=DEFAULT_SCAN_INTERVAL),
        update_method=_async_update_data,
    )
    await coordinator.async_config_entry_first_refresh()
    hass.data[DOMAIN][entry.entry_id][DATA_COORDINATOR] = coordinator

    # Register sidebar panel (iframe pointing at the dashboard)
    if dashboard_url and entry.data.get(CONF_PANEL_ENABLED, True) and ha_frontend:
        try:
            ha_frontend.async_register_built_in_panel(
                hass,
                "iframe",
                entry.data.get(CONF_NAME, "MDT HOME"),
                "mdi:monitor-dashboard",
                DOMAIN,
                {"url": dashboard_url},
                require_admin=False,
            )
        except Exception:
            _LOGGER.debug("Could not register sidebar panel")

    # Register services (idempotent)
    await _async_register_services(hass)

    # Forward platform setup
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id, None)
        # Remove sidebar panel
        try:
            ha_frontend.async_remove_panel(hass, DOMAIN)
        except Exception:
            _LOGGER.debug("Could not remove sidebar panel")
    return unload_ok


# ---------- Services ----------

async def _async_register_services(hass: HomeAssistant) -> None:
    """Register all dashboard services (idempotent)."""

    def _get_client() -> DashboardClient | None:
        """Return the first available DashboardClient."""
        for eid, data in hass.data.get(DOMAIN, {}).items():
            if isinstance(data, dict) and data.get(DATA_CLIENT):
                return data[DATA_CLIENT]
        return None

    async def handle_update_dashboard(call: ServiceCall) -> None:
        entity_id = call.data.get("entity_id")
        data = call.data.get("data", {})
        hass.bus.async_fire(f"{DOMAIN}_update", {"entity_id": entity_id, "data": data})

    async def handle_refresh_state(call: ServiceCall) -> None:
        client = _get_client()
        if client:
            try:
                await client.send_command("refresh")
            except Exception:
                _LOGGER.warning("Could not reach dashboard for refresh")
        hass.bus.async_fire(f"{DOMAIN}_refresh")

    async def handle_send_notification(call: ServiceCall) -> None:
        message = call.data["message"]
        title = call.data.get("title", "MDT HOME Dashboard")
        notif_type = call.data.get("type", "info")
        payload = {"message": message, "title": title, "type": notif_type}
        client = _get_client()
        if client:
            try:
                await client.send_command("notify", payload)
            except Exception:
                _LOGGER.warning("Could not send notification to dashboard")
        hass.bus.async_fire(f"{DOMAIN}_notification", payload)

    async def handle_set_theme(call: ServiceCall) -> None:
        theme = call.data["theme"]
        client = _get_client()
        if client:
            try:
                await client.send_command("set_theme", {"theme": theme})
            except Exception:
                _LOGGER.warning("Could not set theme on dashboard")
        hass.bus.async_fire(f"{DOMAIN}_theme", {"theme": theme, "action": "set"})

    async def handle_switch_page(call: ServiceCall) -> None:
        page_id = call.data["page_id"]
        client = _get_client()
        if client:
            try:
                await client.send_command("switch_page", {"page_id": page_id})
            except Exception:
                _LOGGER.warning("Could not switch page on dashboard")
        hass.bus.async_fire(
            f"{DOMAIN}_navigation", {"page_id": page_id, "action": "switch"}
        )

    async def handle_activate_scene(call: ServiceCall) -> None:
        scene_id = call.data["scene_id"]
        client = _get_client()
        if client:
            try:
                await client.send_command("set_setting", {"active_scene": scene_id})
            except Exception:
                _LOGGER.warning("Could not activate scene on dashboard")
        hass.bus.async_fire(
            f"{DOMAIN}_scene", {"scene_id": scene_id, "action": "activate"}
        )

    async def handle_set_background(call: ServiceCall) -> None:
        bg_type = call.data["type"]
        bg_config = call.data.get("config", {})
        client = _get_client()
        if client:
            try:
                await client.send_command("set_setting", {
                    "background_type": bg_type,
                    "background_config": bg_config,
                })
            except Exception:
                _LOGGER.warning("Could not set background on dashboard")
        hass.bus.async_fire(
            f"{DOMAIN}_background",
            {"type": bg_type, "config": bg_config, "action": "set"},
        )

    async def handle_trigger_automation(call: ServiceCall) -> None:
        automation_id = call.data["automation_id"]
        data = call.data.get("data", {})
        client = _get_client()
        if client:
            try:
                await client.send_command("set_setting", {
                    "trigger_automation": automation_id,
                    "automation_data": data,
                })
            except Exception:
                _LOGGER.warning("Could not trigger automation on dashboard")
        hass.bus.async_fire(
            f"{DOMAIN}_automation",
            {"automation_id": automation_id, "data": data, "action": "trigger"},
        )

    _svc = [
        (SERVICE_UPDATE_DASHBOARD, handle_update_dashboard, SERVICE_UPDATE_DASHBOARD_SCHEMA),
        (SERVICE_REFRESH_STATE, handle_refresh_state, None),
        (SERVICE_SEND_NOTIFICATION, handle_send_notification, SERVICE_SEND_NOTIFICATION_SCHEMA),
        (SERVICE_SET_THEME, handle_set_theme, SERVICE_SET_THEME_SCHEMA),
        (SERVICE_SWITCH_PAGE, handle_switch_page, SERVICE_SWITCH_PAGE_SCHEMA),
        (SERVICE_ACTIVATE_SCENE, handle_activate_scene, SERVICE_ACTIVATE_SCENE_SCHEMA),
        (SERVICE_SET_BACKGROUND, handle_set_background, SERVICE_SET_BACKGROUND_SCHEMA),
        (SERVICE_TRIGGER_AUTOMATION, handle_trigger_automation, SERVICE_TRIGGER_AUTOMATION_SCHEMA),
    ]

    for name, handler, schema in _svc:
        if not hass.services.has_service(DOMAIN, name):
            hass.services.async_register(DOMAIN, name, handler, schema=schema)
