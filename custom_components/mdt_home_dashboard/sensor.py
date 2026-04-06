"""Sensor platform for MDT HOME Dashboard integration."""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_NAME
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import (
    CONF_DASHBOARD_URL,
    DATA_COORDINATOR,
    DEFAULT_NAME,
    DOMAIN,
    SENSOR_ACTIVE_AUTOMATIONS,
    SENSOR_API_REQUESTS,
    SENSOR_CACHE_HITS,
    SENSOR_CACHE_MISSES,
    SENSOR_CACHE_SIZE,
    SENSOR_CACHE_UPDATE_TIME,
    SENSOR_CONNECTED_CLIENTS,
    SENSOR_DASHBOARD_STATE,
    SENSOR_ENTITY_HEALTH,
    SENSOR_ERROR_COUNT,
    SENSOR_LAST_UPDATE,
    SENSOR_MEMORY_USAGE,
    SENSOR_MOST_ACTIVE_ENTITY,
    SENSOR_SCHEDULED_ACTIONS_COUNT,
    SENSOR_SMART_SCENES_COUNT,
    SENSOR_STALE_ENTITIES,
    SENSOR_STATE_CHANGES,
    SENSOR_UNAVAILABLE_ENTITIES,
    SENSOR_UPTIME,
    SENSOR_WATCHDOGS_COUNT,
    SENSOR_WATCHDOG_LAST_TRIGGERED,
    SENSOR_WS_CONNECTED,
    VERSION,
)

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up MDT HOME Dashboard sensors based on a config entry."""
    coordinator = hass.data[DOMAIN][entry.entry_id][DATA_COORDINATOR]

    sensors = [
        MDTDashboardConnectedClientsSensor(coordinator, entry),
        MDTDashboardLastUpdateSensor(coordinator, entry),
        MDTDashboardStateSensor(coordinator, entry),
        MDTDashboardActiveThemeSensor(coordinator, entry),
        MDTDashboardCurrentPageSensor(coordinator, entry),
        MDTDashboardEntityCountSensor(coordinator, entry),
        MDTDashboardVersionSensor(coordinator, entry),
        MDTDashboardCacheHitsSensor(coordinator, entry),
        MDTDashboardCacheMissesSensor(coordinator, entry),
        MDTDashboardCacheUpdateTimeSensor(coordinator, entry),
        MDTDashboardWSConnectedSensor(coordinator, entry),
        MDTDashboardUptimeSensor(coordinator, entry),
        MDTDashboardMemoryUsageSensor(coordinator, entry),
        MDTDashboardActiveAutomationsSensor(coordinator, entry),
        MDTDashboardErrorCountSensor(coordinator, entry),
        MDTDashboardApiRequestsSensor(coordinator, entry),
        MDTDashboardCacheSizeSensor(coordinator, entry),
        MDTDashboardStateChangesTotalSensor(coordinator, entry),
        MDTDashboardMostActiveEntitySensor(coordinator, entry),
        MDTDashboardUnavailableEntitiesSensor(coordinator, entry),
        MDTDashboardStaleEntitiesSensor(coordinator, entry),
        MDTDashboardEntityHealthSensor(coordinator, entry),
        MDTDashboardSmartScenesCountSensor(coordinator, entry),
        MDTDashboardScheduledActionsCountSensor(coordinator, entry),
        MDTDashboardWatchdogsCountSensor(coordinator, entry),
        MDTDashboardWatchdogLastTriggeredSensor(coordinator, entry),
    ]

    async_add_entities(sensors)


class MDTDashboardSensorBase(CoordinatorEntity, SensorEntity):
    """Base class for MDT Dashboard sensors."""

    def __init__(
        self,
        coordinator,
        entry: ConfigEntry,
        sensor_type: str,
    ) -> None:
        super().__init__(coordinator)
        self._entry = entry
        self._sensor_type = sensor_type
        self._attr_unique_id = f"{entry.entry_id}_{sensor_type}"
        self._attr_has_entity_name = True

    @property
    def device_info(self) -> dict[str, Any]:
        return {
            "identifiers": {(DOMAIN, self._entry.entry_id)},
            "name": self._entry.data.get(CONF_NAME, DEFAULT_NAME),
            "manufacturer": "MDT",
            "model": "Home Dashboard",
            "sw_version": self.coordinator.data.get("version", VERSION),
            "configuration_url": self._entry.data.get(CONF_DASHBOARD_URL),
        }


class MDTDashboardConnectedClientsSensor(MDTDashboardSensorBase):
    """Number of frontend browser clients connected to the dashboard."""

    def __init__(self, coordinator, entry):
        super().__init__(coordinator, entry, SENSOR_CONNECTED_CLIENTS)
        self._attr_name = "Connected Clients"
        self._attr_icon = "mdi:devices"
        self._attr_state_class = SensorStateClass.MEASUREMENT

    @property
    def native_value(self) -> int:
        return self.coordinator.data.get("connected_clients", 0)


class MDTDashboardLastUpdateSensor(MDTDashboardSensorBase):
    """Last timestamp the dashboard reported data."""

    def __init__(self, coordinator, entry):
        super().__init__(coordinator, entry, SENSOR_LAST_UPDATE)
        self._attr_name = "Last Update"
        self._attr_icon = "mdi:update"
        self._attr_device_class = SensorDeviceClass.TIMESTAMP

    @property
    def native_value(self) -> datetime | None:
        ts = self.coordinator.data.get("timestamp")
        if not ts:
            return None
        try:
            return datetime.fromisoformat(ts)
        except (ValueError, TypeError):
            return None


class MDTDashboardStateSensor(MDTDashboardSensorBase):
    """Overall dashboard state (ok / offline / not_configured)."""

    def __init__(self, coordinator, entry):
        super().__init__(coordinator, entry, SENSOR_DASHBOARD_STATE)
        self._attr_name = "Dashboard State"
        self._attr_icon = "mdi:monitor-dashboard"

    @property
    def native_value(self) -> str:
        return self.coordinator.data.get("status", "unknown")

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {
            "connected_clients": self.coordinator.data.get("connected_clients", 0),
            "ha_connected": self.coordinator.data.get("ha_connected", False),
        }


class MDTDashboardActiveThemeSensor(MDTDashboardSensorBase):
    """Active theme reported by the dashboard (if available)."""

    def __init__(self, coordinator, entry):
        super().__init__(coordinator, entry, "active_theme")
        self._attr_name = "Active Theme"
        self._attr_icon = "mdi:theme-light-dark"

    @property
    def native_value(self) -> str:
        return self.coordinator.data.get("active_theme", "auto")


class MDTDashboardCurrentPageSensor(MDTDashboardSensorBase):
    """Current page shown on the dashboard."""

    def __init__(self, coordinator, entry):
        super().__init__(coordinator, entry, "current_page")
        self._attr_name = "Current Page"
        self._attr_icon = "mdi:page-layout-body"

    @property
    def native_value(self) -> str:
        return self.coordinator.data.get("current_page", "home")


class MDTDashboardEntityCountSensor(MDTDashboardSensorBase):
    """Number of HA entities cached by the dashboard backend."""

    def __init__(self, coordinator, entry):
        super().__init__(coordinator, entry, "entity_count")
        self._attr_name = "Entity Count"
        self._attr_icon = "mdi:counter"
        self._attr_state_class = SensorStateClass.MEASUREMENT

    @property
    def native_value(self) -> int:
        return self.coordinator.data.get("entity_count", 0)


class MDTDashboardVersionSensor(MDTDashboardSensorBase):
    """Dashboard backend version."""

    def __init__(self, coordinator, entry):
        super().__init__(coordinator, entry, "backend_version")
        self._attr_name = "Backend Version"
        self._attr_icon = "mdi:information-outline"

    @property
    def native_value(self) -> str:
        return self.coordinator.data.get("version", "unknown")


class MDTDashboardCacheHitsSensor(MDTDashboardSensorBase):
    """Number of entity cache hits (measures cache effectiveness)."""

    def __init__(self, coordinator, entry):
        super().__init__(coordinator, entry, SENSOR_CACHE_HITS)
        self._attr_name = "Cache Hits"
        self._attr_icon = "mdi:check-circle-outline"
        self._attr_state_class = SensorStateClass.TOTAL_INCREASING
        self._attr_entity_category = "diagnostic"

    @property
    def native_value(self) -> int:
        diagnostics = self.coordinator.data.get("diagnostics", {})
        return diagnostics.get("cache_hits", 0)


class MDTDashboardCacheMissesSensor(MDTDashboardSensorBase):
    """Number of entity cache misses."""

    def __init__(self, coordinator, entry):
        super().__init__(coordinator, entry, SENSOR_CACHE_MISSES)
        self._attr_name = "Cache Misses"
        self._attr_icon = "mdi:close-circle-outline"
        self._attr_state_class = SensorStateClass.TOTAL_INCREASING
        self._attr_entity_category = "diagnostic"

    @property
    def native_value(self) -> int:
        diagnostics = self.coordinator.data.get("diagnostics", {})
        return diagnostics.get("cache_misses", 0)


class MDTDashboardCacheUpdateTimeSensor(MDTDashboardSensorBase):
    """Last cache update duration in milliseconds."""

    def __init__(self, coordinator, entry):
        super().__init__(coordinator, entry, SENSOR_CACHE_UPDATE_TIME)
        self._attr_name = "Cache Update Time"
        self._attr_icon = "mdi:timer-outline"
        self._attr_native_unit_of_measurement = "ms"
        self._attr_state_class = SensorStateClass.MEASUREMENT
        self._attr_entity_category = "diagnostic"

    @property
    def native_value(self) -> int:
        diagnostics = self.coordinator.data.get("diagnostics", {})
        return diagnostics.get("cache_last_update_ms", 0)


class MDTDashboardWSConnectedSensor(MDTDashboardSensorBase):
    """Whether the backend WebSocket to HA is connected."""

    def __init__(self, coordinator, entry):
        super().__init__(coordinator, entry, SENSOR_WS_CONNECTED)
        self._attr_name = "WebSocket Connected"
        self._attr_icon = "mdi:lan-connect"
        self._attr_entity_category = "diagnostic"

    @property
    def native_value(self) -> str:
        ws_connected = self.coordinator.data.get("ha_ws_connected", False)
        return "connected" if ws_connected else "disconnected"

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        diagnostics = self.coordinator.data.get("diagnostics", {})
        return {
            "cache_update_count": diagnostics.get("cache_update_count", 0),
            "ha_connected": self.coordinator.data.get("ha_connected", False),
        }


class MDTDashboardUptimeSensor(MDTDashboardSensorBase):
    """Dashboard backend uptime in seconds."""

    def __init__(self, coordinator, entry):
        super().__init__(coordinator, entry, SENSOR_UPTIME)
        self._attr_name = "Backend Uptime"
        self._attr_icon = "mdi:clock-check-outline"
        self._attr_native_unit_of_measurement = "s"
        self._attr_state_class = SensorStateClass.TOTAL_INCREASING
        self._attr_device_class = SensorDeviceClass.DURATION
        self._attr_entity_category = "diagnostic"

    @property
    def native_value(self) -> int:
        return self.coordinator.data.get("uptime_seconds", 0)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        uptime = self.coordinator.data.get("uptime_seconds", 0)
        days = uptime // 86400
        hours = (uptime % 86400) // 3600
        minutes = (uptime % 3600) // 60
        return {"uptime_formatted": f"{days}d {hours}h {minutes}m"}


class MDTDashboardMemoryUsageSensor(MDTDashboardSensorBase):
    """Dashboard backend memory usage in MB."""

    def __init__(self, coordinator, entry):
        super().__init__(coordinator, entry, SENSOR_MEMORY_USAGE)
        self._attr_name = "Memory Usage"
        self._attr_icon = "mdi:memory"
        self._attr_native_unit_of_measurement = "MB"
        self._attr_state_class = SensorStateClass.MEASUREMENT
        self._attr_entity_category = "diagnostic"

    @property
    def native_value(self) -> float:
        diagnostics = self.coordinator.data.get("diagnostics", {})
        return round(diagnostics.get("memory_usage_mb", 0.0), 1)


class MDTDashboardActiveAutomationsSensor(MDTDashboardSensorBase):
    """Number of active automations tracked by the dashboard."""

    def __init__(self, coordinator, entry):
        super().__init__(coordinator, entry, SENSOR_ACTIVE_AUTOMATIONS)
        self._attr_name = "Active Automations"
        self._attr_icon = "mdi:robot"
        self._attr_state_class = SensorStateClass.MEASUREMENT

    @property
    def native_value(self) -> int:
        return self.coordinator.data.get("active_automations", 0)


class MDTDashboardErrorCountSensor(MDTDashboardSensorBase):
    """Number of errors recorded by the dashboard backend."""

    def __init__(self, coordinator, entry):
        super().__init__(coordinator, entry, SENSOR_ERROR_COUNT)
        self._attr_name = "Error Count"
        self._attr_icon = "mdi:alert-circle"
        self._attr_state_class = SensorStateClass.TOTAL_INCREASING
        self._attr_entity_category = "diagnostic"

    @property
    def native_value(self) -> int:
        diagnostics = self.coordinator.data.get("diagnostics", {})
        return diagnostics.get("error_count", 0)


class MDTDashboardApiRequestsSensor(MDTDashboardSensorBase):
    """Total API requests served by the dashboard backend."""

    def __init__(self, coordinator, entry):
        super().__init__(coordinator, entry, SENSOR_API_REQUESTS)
        self._attr_name = "API Requests"
        self._attr_icon = "mdi:api"
        self._attr_state_class = SensorStateClass.TOTAL_INCREASING
        self._attr_entity_category = "diagnostic"

    @property
    def native_value(self) -> int:
        diagnostics = self.coordinator.data.get("diagnostics", {})
        return diagnostics.get("api_requests_total", 0)


class MDTDashboardCacheSizeSensor(MDTDashboardSensorBase):
    """Number of entries in the entity cache."""

    def __init__(self, coordinator, entry):
        super().__init__(coordinator, entry, SENSOR_CACHE_SIZE)
        self._attr_name = "Cache Size"
        self._attr_icon = "mdi:database"
        self._attr_state_class = SensorStateClass.MEASUREMENT
        self._attr_entity_category = "diagnostic"

    @property
    def native_value(self) -> int:
        return self.coordinator.data.get("entity_count", 0)


class MDTDashboardStateChangesTotalSensor(MDTDashboardSensorBase):
    """Total entity state changes tracked by the dashboard backend.

    This provides insights into overall system activity that HA
    alone cannot track (because HA doesn't count state changes).
    """

    def __init__(self, coordinator, entry):
        super().__init__(coordinator, entry, SENSOR_STATE_CHANGES)
        self._attr_name = "State Changes Total"
        self._attr_icon = "mdi:swap-horizontal-bold"
        self._attr_state_class = SensorStateClass.TOTAL_INCREASING

    @property
    def native_value(self) -> int:
        analytics = self.coordinator.data.get("entity_analytics", {})
        return analytics.get("total_state_changes", 0)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        analytics = self.coordinator.data.get("entity_analytics", {})
        return {
            "entities_with_changes": analytics.get("entities_with_changes", 0),
            "most_active": analytics.get("most_active", []),
        }


class MDTDashboardMostActiveEntitySensor(MDTDashboardSensorBase):
    """The entity with the most state changes — impossible to know natively in HA.

    The backend continuously tracks every state change and identifies
    the most frequently changing entity, useful for detecting chatty
    sensors or flapping switches.
    """

    def __init__(self, coordinator, entry):
        super().__init__(coordinator, entry, SENSOR_MOST_ACTIVE_ENTITY)
        self._attr_name = "Most Active Entity"
        self._attr_icon = "mdi:chart-line"

    @property
    def native_value(self) -> str:
        analytics = self.coordinator.data.get("entity_analytics", {})
        most_active = analytics.get("most_active", [])
        if most_active:
            return most_active[0].get("entity_id", "none")
        return "none"

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        analytics = self.coordinator.data.get("entity_analytics", {})
        most_active = analytics.get("most_active", [])
        attrs: dict[str, Any] = {}
        for i, entry in enumerate(most_active[:5]):
            attrs[f"rank_{i+1}_entity"] = entry.get("entity_id", "")
            attrs[f"rank_{i+1}_changes"] = entry.get("changes", 0)
        return attrs


class MDTDashboardUnavailableEntitiesSensor(MDTDashboardSensorBase):
    """Count of entities currently in 'unavailable' state.

    While HA can show individual entities as unavailable, it has no
    native sensor counting how many entities are unavailable system-wide.
    The dashboard backend provides this as a health metric.
    """

    def __init__(self, coordinator, entry):
        super().__init__(coordinator, entry, SENSOR_UNAVAILABLE_ENTITIES)
        self._attr_name = "Unavailable Entities"
        self._attr_icon = "mdi:alert-circle-outline"
        self._attr_state_class = SensorStateClass.MEASUREMENT

    @property
    def native_value(self) -> int:
        health = self.coordinator.data.get("entity_health", {})
        return health.get("unavailable_count", 0)


class MDTDashboardStaleEntitiesSensor(MDTDashboardSensorBase):
    """Count of entities that haven't changed for over an hour.

    This is a unique backend feature — it tracks time-between-changes
    for every entity and flags those that seem stuck. HA has no
    native mechanism to detect stale sensors.
    """

    def __init__(self, coordinator, entry):
        super().__init__(coordinator, entry, SENSOR_STALE_ENTITIES)
        self._attr_name = "Stale Entities"
        self._attr_icon = "mdi:clock-alert-outline"
        self._attr_state_class = SensorStateClass.MEASUREMENT
        self._attr_entity_category = "diagnostic"

    @property
    def native_value(self) -> int:
        health = self.coordinator.data.get("entity_health", {})
        return health.get("stale_count", 0)


class MDTDashboardEntityHealthSensor(MDTDashboardSensorBase):
    """Total number of entity health issues (unavailable + stale + unknown).

    Serves as a single glanceable health indicator for the entire
    HA installation, computed by the dashboard backend's analytics engine.
    """

    def __init__(self, coordinator, entry):
        super().__init__(coordinator, entry, SENSOR_ENTITY_HEALTH)
        self._attr_name = "Entity Health Issues"
        self._attr_icon = "mdi:hospital-box"
        self._attr_state_class = SensorStateClass.MEASUREMENT

    @property
    def native_value(self) -> int:
        health = self.coordinator.data.get("entity_health", {})
        return health.get("total_issues", 0)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        health = self.coordinator.data.get("entity_health", {})
        return {
            "unavailable": health.get("unavailable_count", 0),
            "stale": health.get("stale_count", 0),
        }


# ── Actionable feature sensors ──


class MDTDashboardSmartScenesCountSensor(MDTDashboardSensorBase):
    """Number of backend-powered smart scenes registered.

    Smart scenes are unique to MDT Dashboard — they support sequenced
    steps with delays, conditional execution, and live entity state
    checks, going far beyond native HA scenes.
    """

    def __init__(self, coordinator, entry):
        super().__init__(coordinator, entry, SENSOR_SMART_SCENES_COUNT)
        self._attr_name = "Smart Scenes"
        self._attr_icon = "mdi:movie-open-star"
        self._attr_state_class = SensorStateClass.MEASUREMENT

    @property
    def native_value(self) -> int:
        return self.coordinator.data.get("smart_scenes", {}).get("count", 0)


class MDTDashboardScheduledActionsCountSensor(MDTDashboardSensorBase):
    """Number of currently scheduled future actions.

    The scheduler lets users schedule any HA service call from a
    single service call (e.g. 'turn off lights at 23:00') — no
    automation YAML required.
    """

    def __init__(self, coordinator, entry):
        super().__init__(coordinator, entry, SENSOR_SCHEDULED_ACTIONS_COUNT)
        self._attr_name = "Scheduled Actions"
        self._attr_icon = "mdi:calendar-clock"
        self._attr_state_class = SensorStateClass.MEASUREMENT

    @property
    def native_value(self) -> int:
        return self.coordinator.data.get("scheduled_actions", {}).get("count", 0)


class MDTDashboardWatchdogsCountSensor(MDTDashboardSensorBase):
    """Number of active watchdog rules.

    Watchdogs auto-act when entities become unavailable, stale, or
    match a specific state — a capability that natively requires
    complex HA automations with state-duration triggers.
    """

    def __init__(self, coordinator, entry):
        super().__init__(coordinator, entry, SENSOR_WATCHDOGS_COUNT)
        self._attr_name = "Active Watchdogs"
        self._attr_icon = "mdi:shield-alert"
        self._attr_state_class = SensorStateClass.MEASUREMENT

    @property
    def native_value(self) -> int:
        return self.coordinator.data.get("watchdogs", {}).get("count", 0)


class MDTDashboardWatchdogLastTriggeredSensor(MDTDashboardSensorBase):
    """Timestamp of the last watchdog trigger event."""

    def __init__(self, coordinator, entry):
        super().__init__(coordinator, entry, SENSOR_WATCHDOG_LAST_TRIGGERED)
        self._attr_name = "Watchdog Last Triggered"
        self._attr_icon = "mdi:shield-check"
        self._attr_device_class = SensorDeviceClass.TIMESTAMP

    @property
    def native_value(self) -> str | None:
        return self.coordinator.data.get("watchdogs", {}).get("last_triggered")

