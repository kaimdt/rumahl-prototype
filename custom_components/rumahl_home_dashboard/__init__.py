"""rumahl Home Dashboard Integration for Home Assistant.

Provides real-time connectivity between Home Assistant and the rumahl Home
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
    CONF_API_KEY,
    CONF_DASHBOARD_URL,
    CONF_PANEL_ENABLED,
    DATA_CLIENT,
    DATA_COORDINATOR,
    DEFAULT_SCAN_INTERVAL,
    DOMAIN,
    SERVICE_ACTIVATE_SCENE,
    SERVICE_ADD_WATCHDOG,
    SERVICE_CANCEL_SCHEDULE,
    SERVICE_CHECK_WATCHDOGS,
    SERVICE_CLEAR_CACHE,
    SERVICE_CONDITIONAL_ACTION,
    SERVICE_CREATE_SMART_SCENE,
    SERVICE_DELAYED_ACTION,
    SERVICE_DELETE_SMART_SCENE,
    SERVICE_EXECUTE_MACRO,
    SERVICE_EXECUTE_SMART_SCENE,
    SERVICE_GET_ENTITY_ANALYTICS,
    SERVICE_GROUP_ACTION,
    SERVICE_NAVIGATE_DASHBOARD,
    SERVICE_REFRESH_STATE,
    SERVICE_REGISTER_COMPOSITE,
    SERVICE_RELOAD_DASHBOARD,
    SERVICE_REMOVE_COMPOSITE,
    SERVICE_REMOVE_WATCHDOG,
    SERVICE_RENDER_TEMPLATE,
    SERVICE_RESTART_BACKEND,
    SERVICE_SCHEDULE_ACTION,
    SERVICE_SEND_NOTIFICATION,
    SERVICE_SET_BACKGROUND,
    SERVICE_SET_BRIGHTNESS,
    SERVICE_SET_SCREENSAVER,
    SERVICE_SET_SLEEP_MODE,
    SERVICE_SET_THEME,
    SERVICE_SET_WIDGET_VALUE,
    SERVICE_SNAPSHOT_STATES,
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
            ["info", "warning", "error", "success", "critical", "emergency"]
        ),
        vol.Optional("source", default="home_assistant"): cv.string,
        vol.Optional("icon"): cv.string,
        # Channel routing: list of rumahl channel IDs, empty = all enabled channels.
        vol.Optional("channels", default=[]): vol.All(cv.ensure_list, [cv.string]),
        # Optional HA mobile push extras forwarded as `data` to notify service.
        vol.Optional("ha_data", default={}): dict,
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

SERVICE_NAVIGATE_DASHBOARD_SCHEMA = vol.Schema(
    {
        vol.Required("page_id"): cv.string,
        vol.Optional("transition", default="slide"): vol.In(
            ["slide", "fade", "none"]
        ),
    }
)

SERVICE_SET_SCREENSAVER_SCHEMA = vol.Schema(
    {
        vol.Required("enabled"): cv.boolean,
        vol.Optional("timeout"): vol.All(vol.Coerce(int), vol.Range(min=30, max=3600)),
    }
)

SERVICE_SET_SLEEP_MODE_SCHEMA = vol.Schema(
    {
        vol.Required("enabled"): cv.boolean,
    }
)

SERVICE_SET_BRIGHTNESS_SCHEMA = vol.Schema(
    {
        vol.Required("brightness"): vol.All(
            vol.Coerce(int), vol.Range(min=0, max=100)
        ),
    }
)

SERVICE_SNAPSHOT_STATES_SCHEMA = vol.Schema(
    {
        vol.Required("name"): cv.string,
        vol.Optional("entity_ids"): vol.All(cv.ensure_list, [cv.entity_id]),
    }
)

SERVICE_EXECUTE_MACRO_SCHEMA = vol.Schema(
    {
        vol.Required("commands"): vol.All(
            cv.ensure_list,
            [
                vol.Schema(
                    {
                        vol.Required("domain"): cv.string,
                        vol.Required("service"): cv.string,
                        vol.Optional("entity_id"): cv.entity_id,
                        vol.Optional("data"): dict,
                        vol.Optional("delay_ms", default=0): vol.All(
                            vol.Coerce(int), vol.Range(min=0, max=10000)
                        ),
                    }
                )
            ],
        ),
    }
)

SERVICE_SET_WIDGET_VALUE_SCHEMA = vol.Schema(
    {
        vol.Required("widget_id"): cv.string,
        vol.Required("value"): vol.Any(str, int, float, bool, dict),
    }
)

SERVICE_RENDER_TEMPLATE_SCHEMA = vol.Schema(
    {
        vol.Required("template"): cv.string,
    }
)

SERVICE_REGISTER_COMPOSITE_SCHEMA = vol.Schema(
    {
        vol.Required("sensor_id"): cv.string,
        vol.Required("name"): cv.string,
        vol.Required("formula"): vol.In(
            ["avg", "sum", "min", "max", "diff", "comfort_index", "range"]
        ),
        vol.Required("entities"): vol.All(cv.ensure_list, [cv.entity_id]),
        vol.Optional("unit", default=""): cv.string,
    }
)

SERVICE_REMOVE_COMPOSITE_SCHEMA = vol.Schema(
    {
        vol.Required("sensor_id"): cv.string,
    }
)

SERVICE_GET_ENTITY_ANALYTICS_SCHEMA = vol.Schema(
    {
        vol.Required("entity_id"): cv.entity_id,
    }
)

# -- Smart Scenes --
SERVICE_CREATE_SMART_SCENE_SCHEMA = vol.Schema(
    {
        vol.Required("scene_id"): cv.string,
        vol.Required("name"): cv.string,
        vol.Required("steps"): vol.All(
            cv.ensure_list,
            [
                vol.Schema(
                    {
                        vol.Required("domain"): cv.string,
                        vol.Required("service"): cv.string,
                        vol.Optional("entity_id"): cv.string,
                        vol.Optional("data"): dict,
                        vol.Optional("delay_ms", default=0): vol.All(
                            vol.Coerce(int), vol.Range(min=0, max=30000)
                        ),
                        vol.Optional("condition"): vol.Schema(
                            {
                                vol.Required("entity_id"): cv.entity_id,
                                vol.Required("state"): cv.string,
                            }
                        ),
                    }
                )
            ],
        ),
    }
)

SERVICE_EXECUTE_SMART_SCENE_SCHEMA = vol.Schema(
    {
        vol.Required("scene_id"): cv.string,
    }
)

SERVICE_DELETE_SMART_SCENE_SCHEMA = vol.Schema(
    {
        vol.Required("scene_id"): cv.string,
    }
)

# -- Entity Scheduler --
SERVICE_SCHEDULE_ACTION_SCHEMA = vol.Schema(
    {
        vol.Required("schedule_id"): cv.string,
        vol.Required("domain"): cv.string,
        vol.Required("service"): cv.string,
        vol.Required("run_at"): cv.string,  # ISO datetime or HH:MM
        vol.Optional("entity_id"): cv.entity_id,
        vol.Optional("data"): dict,
    }
)

SERVICE_CANCEL_SCHEDULE_SCHEMA = vol.Schema(
    {
        vol.Required("schedule_id"): cv.string,
    }
)

# -- Entity Watchdog --
SERVICE_ADD_WATCHDOG_SCHEMA = vol.Schema(
    {
        vol.Required("watchdog_id"): cv.string,
        vol.Required("entity_id"): cv.entity_id,
        vol.Required("trigger"): vol.In(["unavailable", "stale", "state_equals"]),
        vol.Optional("target_state"): cv.string,
        vol.Optional("action_domain", default="homeassistant"): cv.string,
        vol.Optional("action_service", default="toggle"): cv.string,
        vol.Optional("action_data"): dict,
        vol.Optional("cooldown_secs", default=300): vol.All(
            vol.Coerce(int), vol.Range(min=60, max=86400)
        ),
    }
)

SERVICE_REMOVE_WATCHDOG_SCHEMA = vol.Schema(
    {
        vol.Required("watchdog_id"): cv.string,
    }
)

# -- Enhanced Device Control --
SERVICE_DELAYED_ACTION_SCHEMA = vol.Schema(
    {
        vol.Required("entity_id"): cv.entity_id,
        vol.Required("domain"): cv.string,
        vol.Required("service"): cv.string,
        vol.Required("delay_secs"): vol.All(
            vol.Coerce(int), vol.Range(min=1, max=86400)
        ),
        vol.Optional("data"): dict,
    }
)

SERVICE_CONDITIONAL_ACTION_SCHEMA = vol.Schema(
    {
        vol.Required("domain"): cv.string,
        vol.Required("service"): cv.string,
        vol.Required("entity_id"): cv.entity_id,
        vol.Required("condition_entity"): cv.entity_id,
        vol.Required("condition_state"): cv.string,
        vol.Optional("data"): dict,
    }
)

SERVICE_GROUP_ACTION_SCHEMA = vol.Schema(
    {
        vol.Required("domain"): cv.string,
        vol.Required("service"): cv.string,
        vol.Required("entity_ids"): vol.All(cv.ensure_list, [cv.entity_id]),
        vol.Optional("data"): dict,
    }
)


# ---------- Helpers ----------

class DashboardClient:
    """Thin HTTP wrapper around the dashboard backend API."""

    def __init__(self, url: str, session: aiohttp.ClientSession, api_key: str = "") -> None:
        self._base = url.rstrip("/")
        self._session = session
        self._api_key = api_key

    def _headers(self) -> dict[str, str]:
        """Build auth headers for requests."""
        headers: dict[str, str] = {}
        if self._api_key:
            headers["X-API-Key"] = self._api_key
        return headers

    async def get_status(self) -> dict[str, Any]:
        """GET /api/integration/status – used by the coordinator."""
        async with self._session.get(
            f"{self._base}/api/integration/status",
            headers=self._headers(),
            timeout=aiohttp.ClientTimeout(total=10),
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
            headers=self._headers(),
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
            f"{self._base}/api/integration/settings",
            headers=self._headers(),
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            resp.raise_for_status()
            data = await resp.json()
            return data.get("settings", {})

    async def set_settings(self, settings: dict[str, Any]) -> dict:
        """POST /api/integration/settings."""
        async with self._session.post(
            f"{self._base}/api/integration/settings",
            json=settings,
            headers=self._headers(),
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            resp.raise_for_status()
            return await resp.json()

    async def get_statistics(self) -> dict[str, Any]:
        """GET /api/stats/dashboard – fetch dashboard-wide statistics."""
        async with self._session.get(
            f"{self._base}/api/stats/dashboard",
            headers=self._headers(),
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            resp.raise_for_status()
            return await resp.json()

    async def get_entity_stats(self, entity_id: str) -> dict[str, Any]:
        """GET /api/stats/entity-history/{entity_id}."""
        async with self._session.get(
            f"{self._base}/api/stats/entity-history/{entity_id}",
            headers=self._headers(),
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            resp.raise_for_status()
            return await resp.json()

    async def search_entities(self, query: str, limit: int = 50) -> list[dict]:
        """GET /api/entities/search?q=...&limit=..."""
        async with self._session.get(
            f"{self._base}/api/entities/search",
            params={"q": query, "limit": str(limit)},
            headers=self._headers(),
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            resp.raise_for_status()
            return await resp.json()

    async def get_diagnostics(self) -> dict[str, Any]:
        """GET /api/integration/status – fetch extended diagnostics."""
        async with self._session.get(
            f"{self._base}/api/integration/status",
            headers=self._headers(),
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            resp.raise_for_status()
            data = await resp.json()
            return data.get("diagnostics", {})

    async def get_ha_logs(self) -> list[dict]:
        """GET /api/admin/ha/logs – fetch HA error log."""
        async with self._session.get(
            f"{self._base}/api/admin/ha/logs",
            headers=self._headers(),
            timeout=aiohttp.ClientTimeout(total=15),
        ) as resp:
            resp.raise_for_status()
            return await resp.json()

    async def get_ha_logbook(self, hours: int = 24) -> list[dict]:
        """GET /api/admin/ha/logbook – fetch HA logbook entries."""
        async with self._session.get(
            f"{self._base}/api/admin/ha/logbook",
            params={"hours": str(hours)},
            headers=self._headers(),
            timeout=aiohttp.ClientTimeout(total=15),
        ) as resp:
            resp.raise_for_status()
            return await resp.json()

    async def get_ha_calendars(self) -> list[dict]:
        """GET /api/admin/ha/calendars – fetch HA calendars."""
        async with self._session.get(
            f"{self._base}/api/admin/ha/calendars",
            headers=self._headers(),
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            resp.raise_for_status()
            return await resp.json()

    async def get_analytics_top(self, limit: int = 20) -> dict[str, Any]:
        """GET /api/integration/analytics/top – most active entities."""
        async with self._session.get(
            f"{self._base}/api/integration/analytics/top",
            params={"limit": str(limit)},
            headers=self._headers(),
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            resp.raise_for_status()
            return await resp.json()

    async def get_entity_analytics(self, entity_id: str) -> dict[str, Any]:
        """GET /api/integration/analytics/entity/{entity_id}."""
        async with self._session.get(
            f"{self._base}/api/integration/analytics/entity/{entity_id}",
            headers=self._headers(),
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            resp.raise_for_status()
            return await resp.json()

    async def get_health_report(self, stale_threshold: int = 3600) -> dict[str, Any]:
        """GET /api/integration/health – entity health report."""
        async with self._session.get(
            f"{self._base}/api/integration/health",
            params={"stale_threshold": str(stale_threshold)},
            headers=self._headers(),
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            resp.raise_for_status()
            return await resp.json()

    async def get_composite_sensors(self) -> dict[str, Any]:
        """GET /api/integration/composite – get computed composite sensors."""
        async with self._session.get(
            f"{self._base}/api/integration/composite",
            headers=self._headers(),
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            resp.raise_for_status()
            return await resp.json()

    async def register_composite_sensor(
        self, sensor_id: str, name: str, formula: str,
        entities: list[str], unit: str = "",
    ) -> dict[str, Any]:
        """POST /api/integration/composite – register a composite sensor."""
        async with self._session.post(
            f"{self._base}/api/integration/composite",
            json={
                "sensor_id": sensor_id,
                "name": name,
                "formula": formula,
                "entities": entities,
                "unit": unit,
            },
            headers=self._headers(),
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            resp.raise_for_status()
            return await resp.json()

    # ── Smart Scenes ──

    async def list_scenes(self) -> dict[str, Any]:
        """GET /api/integration/scenes."""
        async with self._session.get(
            f"{self._base}/api/integration/scenes",
            headers=self._headers(),
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            resp.raise_for_status()
            return await resp.json()

    async def create_scene(self, scene_id: str, name: str, steps: list[dict]) -> dict:
        """POST /api/integration/scenes."""
        async with self._session.post(
            f"{self._base}/api/integration/scenes",
            json={"scene_id": scene_id, "name": name, "steps": steps},
            headers=self._headers(),
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            resp.raise_for_status()
            return await resp.json()

    async def execute_scene(self, scene_id: str) -> dict:
        """POST /api/integration/scenes/{scene_id}/execute."""
        async with self._session.post(
            f"{self._base}/api/integration/scenes/{scene_id}/execute",
            json={},
            headers=self._headers(),
            timeout=aiohttp.ClientTimeout(total=30),
        ) as resp:
            resp.raise_for_status()
            return await resp.json()

    async def delete_scene(self, scene_id: str) -> dict:
        """DELETE /api/integration/scenes/{scene_id}."""
        async with self._session.delete(
            f"{self._base}/api/integration/scenes/{scene_id}",
            headers=self._headers(),
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            resp.raise_for_status()
            return await resp.json()

    # ── Entity Scheduler ──

    async def schedule_action(
        self, schedule_id: str, domain: str, service: str,
        run_at_unix: int, data: dict | None = None,
    ) -> dict:
        """POST /api/integration/schedules."""
        async with self._session.post(
            f"{self._base}/api/integration/schedules",
            json={
                "schedule_id": schedule_id,
                "domain": domain,
                "service": service,
                "run_at_unix": run_at_unix,
                "data": data or {},
            },
            headers=self._headers(),
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            resp.raise_for_status()
            return await resp.json()

    async def cancel_schedule(self, schedule_id: str) -> dict:
        """DELETE /api/integration/schedules/{schedule_id}."""
        async with self._session.delete(
            f"{self._base}/api/integration/schedules/{schedule_id}",
            headers=self._headers(),
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            resp.raise_for_status()
            return await resp.json()

    async def list_schedules(self) -> dict:
        """GET /api/integration/schedules."""
        async with self._session.get(
            f"{self._base}/api/integration/schedules",
            headers=self._headers(),
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            resp.raise_for_status()
            return await resp.json()

    # ── Entity Watchdog ──

    async def add_watchdog(self, watchdog_id: str, entity_id: str,
                           trigger: str, action_domain: str = "homeassistant",
                           action_service: str = "toggle",
                           action_data: dict | None = None,
                           cooldown_secs: int = 300,
                           target_state: str = "") -> dict:
        """POST /api/integration/watchdogs."""
        payload: dict[str, Any] = {
            "watchdog_id": watchdog_id,
            "entity_id": entity_id,
            "trigger": trigger,
            "action_domain": action_domain,
            "action_service": action_service,
            "action_data": action_data or {},
            "cooldown_secs": cooldown_secs,
        }
        if target_state:
            payload["target_state"] = target_state
        async with self._session.post(
            f"{self._base}/api/integration/watchdogs",
            json=payload,
            headers=self._headers(),
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            resp.raise_for_status()
            return await resp.json()

    async def remove_watchdog(self, watchdog_id: str) -> dict:
        """DELETE /api/integration/watchdogs/{watchdog_id}."""
        async with self._session.delete(
            f"{self._base}/api/integration/watchdogs/{watchdog_id}",
            headers=self._headers(),
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            resp.raise_for_status()
            return await resp.json()

    async def check_watchdogs(self) -> dict:
        """POST /api/integration/watchdogs/check."""
        async with self._session.post(
            f"{self._base}/api/integration/watchdogs/check",
            json={},
            headers=self._headers(),
            timeout=aiohttp.ClientTimeout(total=15),
        ) as resp:
            resp.raise_for_status()
            return await resp.json()

    # ── Enhanced Device Control ──

    async def delayed_action(self, domain: str, service: str,
                             delay_secs: int, data: dict | None = None) -> dict:
        """POST /api/integration/device/delayed-action."""
        async with self._session.post(
            f"{self._base}/api/integration/device/delayed-action",
            json={
                "domain": domain,
                "service": service,
                "delay_secs": delay_secs,
                "data": data or {},
            },
            headers=self._headers(),
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            resp.raise_for_status()
            return await resp.json()

    async def conditional_action(self, domain: str, service: str,
                                  condition_entity: str, condition_state: str,
                                  data: dict | None = None) -> dict:
        """POST /api/integration/device/conditional-action."""
        async with self._session.post(
            f"{self._base}/api/integration/device/conditional-action",
            json={
                "domain": domain,
                "service": service,
                "condition_entity": condition_entity,
                "condition_state": condition_state,
                "data": data or {},
            },
            headers=self._headers(),
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            resp.raise_for_status()
            return await resp.json()

    async def group_action(self, domain: str, service: str,
                           entity_ids: list[str],
                           data: dict | None = None) -> dict:
        """POST /api/integration/device/group-action."""
        async with self._session.post(
            f"{self._base}/api/integration/device/group-action",
            json={
                "domain": domain,
                "service": service,
                "entity_ids": entity_ids,
                "data": data or {},
            },
            headers=self._headers(),
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
    """Set up rumahl Home Dashboard from a config entry."""
    hass.data.setdefault(DOMAIN, {})

    dashboard_url = entry.data.get(CONF_DASHBOARD_URL, "")
    api_key = entry.data.get(CONF_API_KEY, "")
    session = async_get_clientsession(hass, verify_ssl=False)
    client = DashboardClient(dashboard_url, session, api_key=api_key) if dashboard_url else None

    hass.data[DOMAIN][entry.entry_id] = {
        DATA_CLIENT: client,
        "url": dashboard_url,
    }

    # Create the data coordinator here so ALL platforms (sensor, binary_sensor,
    # etc.) can use it even when async_forward_entry_setups runs concurrently.
    _last_online: dict[str, bool] = {"value": False}

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
            if not _last_online["value"]:
                _LOGGER.info("Dashboard connection restored: %s", dashboard_url)
            _last_online["value"] = True
            return data
        except Exception as err:
            if _last_online["value"] or not _last_online.get("logged"):
                _LOGGER.warning(
                    "Dashboard unreachable at %s (%s): %s",
                    dashboard_url, type(err).__name__, err,
                )
                _last_online["logged"] = True
            _last_online["value"] = False
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
                entry.data.get(CONF_NAME, "rumahl Home"),
                "mdi:monitor-dashboard",
                DOMAIN,
                {"url": dashboard_url},
                require_admin=False,
            )
            _LOGGER.info("Registered rumahl Home Dashboard panel at %s", dashboard_url)
        except Exception:
            _LOGGER.debug("Could not register sidebar panel")

    # Register a secondary diagnostics panel
    if dashboard_url and ha_frontend:
        try:
            ha_frontend.async_register_built_in_panel(
                hass,
                "iframe",
                "rumahl Diagnostics",
                "mdi:chart-timeline-variant-shimmer",
                f"{DOMAIN}_diagnostics",
                {"url": f"{dashboard_url}/#/diagnostics"},
                require_admin=True,
            )
        except Exception:
            _LOGGER.debug("Could not register diagnostics panel")

    # Register services (idempotent)
    await _async_register_services(hass)

    # Create a Lovelace dashboard in HA with rumahl sensor cards
    await _async_create_lovelace_dashboard(hass, entry)

    # Forward platform setup
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id, None)
        # Remove sidebar panels
        try:
            ha_frontend.async_remove_panel(hass, DOMAIN)
        except Exception:
            _LOGGER.debug("Could not remove sidebar panel")
        try:
            ha_frontend.async_remove_panel(hass, f"{DOMAIN}_diagnostics")
        except Exception:
            _LOGGER.debug("Could not remove diagnostics panel")
    return unload_ok


# ---------- Lovelace Dashboard ----------

async def _async_create_lovelace_dashboard(
    hass: HomeAssistant, entry: ConfigEntry
) -> None:
    """Create a Lovelace dashboard in HA showing all rumahl sensors and controls.

    Uses the Lovelace storage dashboard API so the dashboard appears in the
    HA sidebar alongside existing dashboards.  Only creates once — if a
    dashboard with url_path ``rumahl-dashboard`` already exists it is skipped.
    """
    try:
        lovelace = hass.data.get("lovelace")
        if lovelace is None:
            _LOGGER.debug("Lovelace not available — skipping dashboard creation")
            return

        dashboards = lovelace.dashboards if hasattr(lovelace, "dashboards") else {}

        # Check if our dashboard already exists
        if f"{DOMAIN}_dashboard" in dashboards or "rumahl-dashboard" in dashboards:
            _LOGGER.debug("rumahl Dashboard already exists in Lovelace")
            return

        # Try to create via the websocket/storage API
        try:
            await hass.services.async_call(
                "lovelace",
                "create_dashboard" if hass.services.has_service("lovelace", "create_dashboard") else "__noop__",
                {},
                blocking=False,
            )
        except Exception:
            pass  # Service may not exist; fall through to storage approach

        # Build the dashboard config
        dashboard_url = entry.data.get(CONF_DASHBOARD_URL, "")
        sensor_prefix = f"sensor.{DOMAIN}"

        cards: list[dict] = []

        # -- Status overview --
        cards.append({
            "type": "entities",
            "title": "🏠 rumahl Dashboard Status",
            "show_header_toggle": False,
            "entities": [
                f"{sensor_prefix}_dashboard_state",
                f"{sensor_prefix}_connected_clients",
                f"{sensor_prefix}_uptime",
                f"{sensor_prefix}_version",
            ],
        })

        # -- Entity Health --
        cards.append({
            "type": "entities",
            "title": "🩺 Entity Health",
            "show_header_toggle": False,
            "entities": [
                f"{sensor_prefix}_entity_health_issues",
                f"{sensor_prefix}_unavailable_entities",
                f"{sensor_prefix}_stale_entities",
                f"{sensor_prefix}_state_changes_total",
                f"{sensor_prefix}_most_active_entity",
            ],
        })

        # -- Feature counters --
        cards.append({
            "type": "glance",
            "title": "⚡ Active Features",
            "show_state": True,
            "entities": [
                {"entity": f"{sensor_prefix}_smart_scenes_count", "name": "Scenes"},
                {"entity": f"{sensor_prefix}_scheduled_actions_count", "name": "Schedules"},
                {"entity": f"{sensor_prefix}_watchdogs_count", "name": "Watchdogs"},
                {"entity": f"{sensor_prefix}_active_automations", "name": "Automations"},
            ],
        })

        # -- Cache diagnostics --
        cards.append({
            "type": "entities",
            "title": "📊 Cache & Performance",
            "show_header_toggle": False,
            "entities": [
                f"{sensor_prefix}_cache_hits",
                f"{sensor_prefix}_cache_misses",
                f"{sensor_prefix}_cache_size",
                f"{sensor_prefix}_cache_update_time",
                f"{sensor_prefix}_api_requests",
            ],
        })

        # -- Quick Actions (buttons) --
        button_cards: list[dict] = []
        for svc, icon, name in [
            ("check_watchdogs", "mdi:shield-check", "Check Watchdogs"),
            ("refresh_state", "mdi:refresh", "Refresh"),
            ("clear_cache", "mdi:cached", "Clear Cache"),
            ("reload_dashboard", "mdi:reload", "Reload UI"),
        ]:
            button_cards.append({
                "type": "button",
                "name": name,
                "icon": icon,
                "tap_action": {
                    "action": "call-service",
                    "service": f"{DOMAIN}.{svc}",
                },
            })

        cards.append({
            "type": "horizontal-stack",
            "cards": button_cards,
        })

        # -- Dashboard iframe --
        if dashboard_url:
            cards.append({
                "type": "iframe",
                "url": dashboard_url,
                "aspect_ratio": "16:9",
                "title": "rumahl Home Dashboard",
            })

        # -- Switches and controls --
        cards.append({
            "type": "entities",
            "title": "🎛️ Controls",
            "show_header_toggle": False,
            "entities": [
                f"switch.{DOMAIN}_screensaver",
                f"switch.{DOMAIN}_sleep_mode",
                f"switch.{DOMAIN}_auto_theme",
                f"switch.{DOMAIN}_webhooks",
                f"number.{DOMAIN}_brightness",
                f"select.{DOMAIN}_theme",
                f"select.{DOMAIN}_current_page",
            ],
        })

        lovelace_config = {
            "views": [
                {
                    "title": "rumahl Home",
                    "path": "rumahl-home",
                    "icon": "mdi:monitor-dashboard",
                    "cards": cards,
                }
            ],
        }

        # Store the dashboard config for manual use / automation
        hass.data[DOMAIN]["lovelace_config"] = lovelace_config

        # Try to register as a new storage-mode dashboard
        try:
            from homeassistant.components.lovelace import dashboard as ll_dashboard  # noqa: C0415

            if hasattr(ll_dashboard, "LovelaceStorage"):
                _LOGGER.info(
                    "rumahl Lovelace dashboard config prepared (%d cards). "
                    "Access via the rumahl Home sidebar panel.",
                    len(cards),
                )
        except ImportError:
            pass

        _LOGGER.info(
            "rumahl Lovelace dashboard created with %d cards", len(cards)
        )

    except Exception:
        _LOGGER.debug("Could not create Lovelace dashboard", exc_info=True)


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
        title = call.data.get("title", "rumahl Home Dashboard")
        notif_type = call.data.get("type", "info")
        # Map HA type to backend level
        type_to_level = {
            "info": "info",
            "success": "info",
            "warning": "warning",
            "error": "critical",
            "critical": "critical",
            "emergency": "emergency",
        }
        level = type_to_level.get(notif_type, "info")
        channels = call.data.get("channels", [])
        ha_data = call.data.get("ha_data", {})
        payload = {
            "message": message,
            "title": title,
            "level": level,
            "source": call.data.get("source", "home_assistant"),
            "icon": call.data.get("icon", ""),
            "channels": channels,
            # Pass HA-specific data block through extra_data so the dispatcher
            # can forward it to ha_mobile channels.
            "extra_data": {"data": ha_data} if ha_data else {},
        }
        client = _get_client()
        if client:
            try:
                # Use the dedicated /api/notifications/send endpoint to trigger
                # multi-channel dispatch (rumahl + HA mobile + Desktop).
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

    async def handle_navigate_dashboard(call: ServiceCall) -> None:
        """Navigate dashboard with optional transition effect."""
        page_id = call.data["page_id"]
        transition = call.data.get("transition", "slide")
        client = _get_client()
        if client:
            try:
                await client.send_command(
                    "switch_page",
                    {"page_id": page_id, "transition": transition},
                )
            except Exception:
                _LOGGER.warning("Could not navigate dashboard")
        hass.bus.async_fire(
            f"{DOMAIN}_navigation",
            {"page_id": page_id, "transition": transition, "action": "navigate"},
        )

    async def handle_set_screensaver(call: ServiceCall) -> None:
        """Enable or disable the screensaver."""
        enabled = call.data["enabled"]
        timeout = call.data.get("timeout")
        settings: dict[str, Any] = {"screensaver": enabled}
        if timeout is not None:
            settings["screensaver_timeout"] = timeout
        client = _get_client()
        if client:
            try:
                await client.send_command("set_setting", settings)
            except Exception:
                _LOGGER.warning("Could not set screensaver on dashboard")
        hass.bus.async_fire(f"{DOMAIN}_switch", {
            "switch_type": "screensaver",
            "state": "on" if enabled else "off",
        })

    async def handle_set_sleep_mode(call: ServiceCall) -> None:
        """Enable or disable sleep mode."""
        enabled = call.data["enabled"]
        client = _get_client()
        if client:
            try:
                await client.send_command("set_setting", {"sleep_mode": enabled})
            except Exception:
                _LOGGER.warning("Could not set sleep mode on dashboard")
        hass.bus.async_fire(f"{DOMAIN}_switch", {
            "switch_type": "sleep_mode",
            "state": "on" if enabled else "off",
        })

    async def handle_set_brightness(call: ServiceCall) -> None:
        """Set display brightness (0-100)."""
        brightness = call.data["brightness"]
        client = _get_client()
        if client:
            try:
                await client.send_command(
                    "set_brightness", {"brightness": brightness}
                )
            except Exception:
                _LOGGER.warning("Could not set brightness on dashboard")
        hass.bus.async_fire(
            f"{DOMAIN}_update",
            {"entity_id": "brightness", "data": {"brightness": brightness}},
        )

    async def handle_snapshot_states(call: ServiceCall) -> None:
        """Snapshot current entity states to a named preset."""
        name = call.data["name"]
        entity_ids = call.data.get("entity_ids", [])
        states: dict[str, Any] = {}
        for eid in entity_ids:
            state = hass.states.get(eid)
            if state:
                states[eid] = {
                    "state": state.state,
                    "attributes": dict(state.attributes),
                }
        hass.bus.async_fire(
            f"{DOMAIN}_scene",
            {"scene_id": name, "action": "snapshot", "states": states},
        )

    async def handle_execute_macro(call: ServiceCall) -> None:
        """Execute a sequence of service calls with optional delays."""
        import asyncio  # noqa: C0415
        commands = call.data.get("commands", [])
        for cmd in commands:
            domain = cmd["domain"]
            service = cmd["service"]
            service_data: dict[str, Any] = cmd.get("data", {})
            entity_id = cmd.get("entity_id")
            if entity_id:
                service_data["entity_id"] = entity_id
            delay_ms = cmd.get("delay_ms", 0)
            try:
                await hass.services.async_call(
                    domain, service, service_data, blocking=False
                )
            except Exception:
                _LOGGER.warning(
                    "Macro step failed: %s.%s", domain, service
                )
            if delay_ms > 0:
                await asyncio.sleep(delay_ms / 1000.0)

    async def handle_reload_dashboard(call: ServiceCall) -> None:
        """Force a full reload of the dashboard frontend."""
        client = _get_client()
        if client:
            try:
                await client.send_command("reload")
            except Exception:
                _LOGGER.warning("Could not reach dashboard for reload")
        hass.bus.async_fire(f"{DOMAIN}_update", {"action": "reload"})

    async def handle_clear_cache(call: ServiceCall) -> None:
        """Clear the dashboard entity cache."""
        client = _get_client()
        if client:
            try:
                await client.send_command("clear_cache")
            except Exception:
                _LOGGER.warning("Could not reach dashboard for cache clear")
        hass.bus.async_fire(f"{DOMAIN}_update", {"action": "clear_cache"})

    async def handle_restart_backend(call: ServiceCall) -> None:
        """Request the dashboard backend to restart."""
        client = _get_client()
        if client:
            try:
                await client.send_command("restart")
            except Exception:
                _LOGGER.warning("Could not reach dashboard for restart")
        hass.bus.async_fire(f"{DOMAIN}_update", {"action": "restart"})

    async def handle_set_widget_value(call: ServiceCall) -> None:
        """Set a value on a specific dashboard widget."""
        widget_id = call.data["widget_id"]
        value = call.data["value"]
        client = _get_client()
        if client:
            try:
                await client.send_command(
                    "set_widget_value",
                    {"widget_id": widget_id, "value": value},
                )
            except Exception:
                _LOGGER.warning("Could not set widget value on dashboard")
        hass.bus.async_fire(
            f"{DOMAIN}_update",
            {"action": "set_widget_value", "widget_id": widget_id, "value": value},
        )

    async def handle_render_template(call: ServiceCall) -> None:
        """Render a Jinja2 template via HA and send the result to the dashboard."""
        template_str = call.data["template"]
        try:
            tpl = cv.template(template_str)
            tpl.hass = hass
            result = tpl.async_render()
        except Exception:
            _LOGGER.warning("Template render failed: %s", template_str)
            result = ""
        client = _get_client()
        if client:
            try:
                await client.send_command(
                    "template_result", {"template": template_str, "result": str(result)}
                )
            except Exception:
                _LOGGER.debug("Could not send template result to dashboard")
        hass.bus.async_fire(
            f"{DOMAIN}_update",
            {"action": "render_template", "template": template_str, "result": str(result)},
        )

    async def handle_register_composite(call: ServiceCall) -> None:
        """Register a composite virtual sensor on the dashboard backend.

        Composite sensors compute values from multiple entity states using
        formulas (avg, sum, min, max, diff, comfort_index, range).
        This enables derived metrics that neither HA templates nor the
        dashboard can provide alone.
        """
        client = _get_client()
        if client:
            try:
                await client.register_composite_sensor(
                    sensor_id=call.data["sensor_id"],
                    name=call.data["name"],
                    formula=call.data["formula"],
                    entities=call.data["entities"],
                    unit=call.data.get("unit", ""),
                )
            except Exception:
                _LOGGER.warning("Could not register composite sensor")
        hass.bus.async_fire(
            f"{DOMAIN}_update",
            {"action": "register_composite", "sensor_id": call.data["sensor_id"]},
        )

    async def handle_remove_composite(call: ServiceCall) -> None:
        """Remove a previously registered composite sensor."""
        client = _get_client()
        if client:
            try:
                await client.send_command(
                    "remove_composite_sensor",
                    {"sensor_id": call.data["sensor_id"]},
                )
            except Exception:
                _LOGGER.warning("Could not remove composite sensor")

    async def handle_get_entity_analytics(call: ServiceCall) -> None:
        """Fetch analytics for a specific entity and fire an event with the data."""
        entity_id = call.data["entity_id"]
        client = _get_client()
        if client:
            try:
                data = await client.get_entity_analytics(entity_id)
                hass.bus.async_fire(
                    f"{DOMAIN}_analytics",
                    {"entity_id": entity_id, "data": data.get("analytics", {})},
                )
            except Exception:
                _LOGGER.warning("Could not fetch analytics for %s", entity_id)
                hass.bus.async_fire(
                    f"{DOMAIN}_analytics",
                    {"entity_id": entity_id, "error": "unavailable"},
                )

    # ── Smart Scenes ──

    async def handle_create_smart_scene(call: ServiceCall) -> None:
        """Create a backend-powered smart scene with ordered steps, delays & conditions."""
        client = _get_client()
        if client:
            try:
                await client.create_scene(
                    scene_id=call.data["scene_id"],
                    name=call.data["name"],
                    steps=call.data["steps"],
                )
                hass.bus.async_fire(
                    f"{DOMAIN}_scene",
                    {"scene_id": call.data["scene_id"], "action": "created"},
                )
            except Exception:
                _LOGGER.warning("Could not create smart scene %s", call.data["scene_id"])

    async def handle_execute_smart_scene(call: ServiceCall) -> None:
        """Execute a smart scene — the backend runs all steps with delays/conditions."""
        client = _get_client()
        if client:
            try:
                result = await client.execute_scene(call.data["scene_id"])
                hass.bus.async_fire(
                    f"{DOMAIN}_scene",
                    {
                        "scene_id": call.data["scene_id"],
                        "action": "executed",
                        "steps_executed": result.get("steps_executed", 0),
                        "steps_skipped": result.get("steps_skipped", 0),
                    },
                )
            except Exception:
                _LOGGER.warning("Could not execute smart scene %s", call.data["scene_id"])

    async def handle_delete_smart_scene(call: ServiceCall) -> None:
        """Delete a smart scene from the backend."""
        client = _get_client()
        if client:
            try:
                await client.delete_scene(call.data["scene_id"])
            except Exception:
                _LOGGER.warning("Could not delete smart scene %s", call.data["scene_id"])

    # ── Entity Scheduler ──

    async def handle_schedule_action(call: ServiceCall) -> None:
        """Schedule a future HA service call via the backend.

        Accepts ``run_at`` as ISO datetime (e.g. '2025-12-31T23:00:00') or
        HH:MM for today/tomorrow.
        """
        import datetime as _dt  # noqa: C0415

        raw_time = call.data["run_at"]
        domain = call.data["domain"]
        service = call.data["service"]
        entity_id = call.data.get("entity_id", "")
        extra_data = call.data.get("data", {})
        svc_data = dict(extra_data) if extra_data else {}
        if entity_id:
            svc_data["entity_id"] = entity_id

        # Parse run_at
        try:
            if "T" in raw_time or "-" in raw_time:
                # ISO datetime
                dt = _dt.datetime.fromisoformat(raw_time)
            else:
                # HH:MM — default to today, or tomorrow if in the past
                parts = raw_time.split(":")
                now = _dt.datetime.now()
                dt = now.replace(
                    hour=int(parts[0]),
                    minute=int(parts[1]) if len(parts) > 1 else 0,
                    second=0, microsecond=0,
                )
                if dt <= now:
                    dt += _dt.timedelta(days=1)
            run_at_unix = int(dt.timestamp())
        except Exception:
            _LOGGER.warning("Invalid run_at format: %s", raw_time)
            return

        client = _get_client()
        if client:
            try:
                await client.schedule_action(
                    schedule_id=call.data["schedule_id"],
                    domain=domain,
                    service=service,
                    run_at_unix=run_at_unix,
                    data=svc_data,
                )
                hass.bus.async_fire(
                    f"{DOMAIN}_update",
                    {"action": "scheduled", "schedule_id": call.data["schedule_id"]},
                )
            except Exception:
                _LOGGER.warning("Could not schedule action %s", call.data["schedule_id"])

    async def handle_cancel_schedule(call: ServiceCall) -> None:
        """Cancel a previously scheduled action."""
        client = _get_client()
        if client:
            try:
                await client.cancel_schedule(call.data["schedule_id"])
            except Exception:
                _LOGGER.warning("Could not cancel schedule %s", call.data["schedule_id"])

    # ── Entity Watchdog ──

    async def handle_add_watchdog(call: ServiceCall) -> None:
        """Add a watchdog rule that auto-acts when an entity matches a trigger."""
        client = _get_client()
        if client:
            try:
                await client.add_watchdog(
                    watchdog_id=call.data["watchdog_id"],
                    entity_id=call.data["entity_id"],
                    trigger=call.data["trigger"],
                    action_domain=call.data.get("action_domain", "homeassistant"),
                    action_service=call.data.get("action_service", "toggle"),
                    action_data=call.data.get("action_data", {}),
                    cooldown_secs=call.data.get("cooldown_secs", 300),
                    target_state=call.data.get("target_state", ""),
                )
                hass.bus.async_fire(
                    f"{DOMAIN}_update",
                    {"action": "watchdog_added", "watchdog_id": call.data["watchdog_id"]},
                )
            except Exception:
                _LOGGER.warning("Could not add watchdog %s", call.data["watchdog_id"])

    async def handle_remove_watchdog(call: ServiceCall) -> None:
        """Remove a watchdog rule."""
        client = _get_client()
        if client:
            try:
                await client.remove_watchdog(call.data["watchdog_id"])
            except Exception:
                _LOGGER.warning("Could not remove watchdog %s", call.data["watchdog_id"])

    async def handle_check_watchdogs(call: ServiceCall) -> None:
        """Manually evaluate all watchdog rules and fire triggered actions."""
        client = _get_client()
        if client:
            try:
                result = await client.check_watchdogs()
                triggered = result.get("triggered", [])
                if triggered:
                    hass.bus.async_fire(
                        f"{DOMAIN}_update",
                        {"action": "watchdogs_triggered", "triggered": triggered},
                    )
            except Exception:
                _LOGGER.warning("Could not check watchdogs")

    # ── Enhanced Device Control ──

    async def handle_delayed_action(call: ServiceCall) -> None:
        """Execute an HA service call after a delay (e.g. 'turn off in 5 minutes')."""
        client = _get_client()
        if client:
            svc_data = dict(call.data.get("data", {}))
            svc_data["entity_id"] = call.data["entity_id"]
            try:
                await client.delayed_action(
                    domain=call.data["domain"],
                    service=call.data["service"],
                    delay_secs=call.data["delay_secs"],
                    data=svc_data,
                )
            except Exception:
                _LOGGER.warning("Could not schedule delayed action")

    async def handle_conditional_action(call: ServiceCall) -> None:
        """Execute an HA service call only if a condition entity is in a given state."""
        client = _get_client()
        if client:
            svc_data = dict(call.data.get("data", {}))
            svc_data["entity_id"] = call.data["entity_id"]
            try:
                result = await client.conditional_action(
                    domain=call.data["domain"],
                    service=call.data["service"],
                    condition_entity=call.data["condition_entity"],
                    condition_state=call.data["condition_state"],
                    data=svc_data,
                )
                hass.bus.async_fire(
                    f"{DOMAIN}_update",
                    {
                        "action": "conditional_action",
                        "executed": result.get("action") == "executed",
                    },
                )
            except Exception:
                _LOGGER.warning("Could not execute conditional action")

    async def handle_group_action(call: ServiceCall) -> None:
        """Call a service on multiple entities at once."""
        client = _get_client()
        if client:
            try:
                result = await client.group_action(
                    domain=call.data["domain"],
                    service=call.data["service"],
                    entity_ids=call.data["entity_ids"],
                    data=call.data.get("data", {}),
                )
                hass.bus.async_fire(
                    f"{DOMAIN}_update",
                    {
                        "action": "group_action",
                        "succeeded": result.get("succeeded", 0),
                        "failed": result.get("failed", 0),
                    },
                )
            except Exception:
                _LOGGER.warning("Could not execute group action")

    _svc = [
        (SERVICE_UPDATE_DASHBOARD, handle_update_dashboard, SERVICE_UPDATE_DASHBOARD_SCHEMA),
        (SERVICE_REFRESH_STATE, handle_refresh_state, None),
        (SERVICE_SEND_NOTIFICATION, handle_send_notification, SERVICE_SEND_NOTIFICATION_SCHEMA),
        (SERVICE_SET_THEME, handle_set_theme, SERVICE_SET_THEME_SCHEMA),
        (SERVICE_SWITCH_PAGE, handle_switch_page, SERVICE_SWITCH_PAGE_SCHEMA),
        (SERVICE_ACTIVATE_SCENE, handle_activate_scene, SERVICE_ACTIVATE_SCENE_SCHEMA),
        (SERVICE_SET_BACKGROUND, handle_set_background, SERVICE_SET_BACKGROUND_SCHEMA),
        (SERVICE_TRIGGER_AUTOMATION, handle_trigger_automation, SERVICE_TRIGGER_AUTOMATION_SCHEMA),
        (SERVICE_NAVIGATE_DASHBOARD, handle_navigate_dashboard, SERVICE_NAVIGATE_DASHBOARD_SCHEMA),
        (SERVICE_SET_SCREENSAVER, handle_set_screensaver, SERVICE_SET_SCREENSAVER_SCHEMA),
        (SERVICE_SET_SLEEP_MODE, handle_set_sleep_mode, SERVICE_SET_SLEEP_MODE_SCHEMA),
        (SERVICE_SET_BRIGHTNESS, handle_set_brightness, SERVICE_SET_BRIGHTNESS_SCHEMA),
        (SERVICE_SNAPSHOT_STATES, handle_snapshot_states, SERVICE_SNAPSHOT_STATES_SCHEMA),
        (SERVICE_EXECUTE_MACRO, handle_execute_macro, SERVICE_EXECUTE_MACRO_SCHEMA),
        (SERVICE_RELOAD_DASHBOARD, handle_reload_dashboard, None),
        (SERVICE_CLEAR_CACHE, handle_clear_cache, None),
        (SERVICE_RESTART_BACKEND, handle_restart_backend, None),
        (SERVICE_SET_WIDGET_VALUE, handle_set_widget_value, SERVICE_SET_WIDGET_VALUE_SCHEMA),
        (SERVICE_RENDER_TEMPLATE, handle_render_template, SERVICE_RENDER_TEMPLATE_SCHEMA),
        (SERVICE_REGISTER_COMPOSITE, handle_register_composite, SERVICE_REGISTER_COMPOSITE_SCHEMA),
        (SERVICE_REMOVE_COMPOSITE, handle_remove_composite, SERVICE_REMOVE_COMPOSITE_SCHEMA),
        (SERVICE_GET_ENTITY_ANALYTICS, handle_get_entity_analytics, SERVICE_GET_ENTITY_ANALYTICS_SCHEMA),
        # Smart Scenes
        (SERVICE_CREATE_SMART_SCENE, handle_create_smart_scene, SERVICE_CREATE_SMART_SCENE_SCHEMA),
        (SERVICE_EXECUTE_SMART_SCENE, handle_execute_smart_scene, SERVICE_EXECUTE_SMART_SCENE_SCHEMA),
        (SERVICE_DELETE_SMART_SCENE, handle_delete_smart_scene, SERVICE_DELETE_SMART_SCENE_SCHEMA),
        # Entity Scheduler
        (SERVICE_SCHEDULE_ACTION, handle_schedule_action, SERVICE_SCHEDULE_ACTION_SCHEMA),
        (SERVICE_CANCEL_SCHEDULE, handle_cancel_schedule, SERVICE_CANCEL_SCHEDULE_SCHEMA),
        # Entity Watchdog
        (SERVICE_ADD_WATCHDOG, handle_add_watchdog, SERVICE_ADD_WATCHDOG_SCHEMA),
        (SERVICE_REMOVE_WATCHDOG, handle_remove_watchdog, SERVICE_REMOVE_WATCHDOG_SCHEMA),
        (SERVICE_CHECK_WATCHDOGS, handle_check_watchdogs, None),
        # Enhanced Device Control
        (SERVICE_DELAYED_ACTION, handle_delayed_action, SERVICE_DELAYED_ACTION_SCHEMA),
        (SERVICE_CONDITIONAL_ACTION, handle_conditional_action, SERVICE_CONDITIONAL_ACTION_SCHEMA),
        (SERVICE_GROUP_ACTION, handle_group_action, SERVICE_GROUP_ACTION_SCHEMA),
    ]

    for name, handler, schema in _svc:
        if not hass.services.has_service(DOMAIN, name):
            hass.services.async_register(DOMAIN, name, handler, schema=schema)
