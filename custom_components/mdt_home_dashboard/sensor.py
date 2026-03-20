"""Sensor platform for MDT HOME Dashboard integration."""
from __future__ import annotations

from datetime import datetime, timedelta
import logging
from typing import Any

from homeassistant.components.sensor import (
    SensorEntity,
    SensorDeviceClass,
    SensorStateClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_NAME
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import (
    CoordinatorEntity,
    DataUpdateCoordinator,
)

from .const import DOMAIN, SENSOR_CONNECTED_CLIENTS, SENSOR_LAST_UPDATE, SENSOR_DASHBOARD_STATE

_LOGGER = logging.getLogger(__name__)

SCAN_INTERVAL = timedelta(seconds=30)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up MDT HOME Dashboard sensors based on a config entry."""

    coordinator = MDTDashboardDataUpdateCoordinator(hass, entry)
    await coordinator.async_config_entry_first_refresh()

    sensors = [
        MDTDashboardConnectedClientsSensor(coordinator, entry),
        MDTDashboardLastUpdateSensor(coordinator, entry),
        MDTDashboardStateSensor(coordinator, entry),
        MDTDashboardActiveThemeSensor(coordinator, entry),
        MDTDashboardCurrentPageSensor(coordinator, entry),
        MDTDashboardEntityCountSensor(coordinator, entry),
        MDTDashboardMemoryUsageSensor(coordinator, entry),
    ]

    async_add_entities(sensors)


class MDTDashboardDataUpdateCoordinator(DataUpdateCoordinator):
    """Class to manage fetching MDT Dashboard data."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """Initialize."""
        self.entry = entry

        super().__init__(
            hass,
            _LOGGER,
            name=f"{DOMAIN}_{entry.entry_id}",
            update_interval=SCAN_INTERVAL,
        )

    async def _async_update_data(self) -> dict[str, Any]:
        """Update data via library."""
        # This would typically fetch data from the dashboard
        # For now, we'll provide mock data
        return {
            "connected_clients": 0,
            "last_update": datetime.now().isoformat(),
            "state": "active",
            "active_theme": "auto",
            "current_page": "home",
            "entity_count": 0,
            "memory_usage": 0,
        }


class MDTDashboardSensorBase(CoordinatorEntity, SensorEntity):
    """Base class for MDT Dashboard sensors."""

    def __init__(
        self,
        coordinator: MDTDashboardDataUpdateCoordinator,
        entry: ConfigEntry,
        sensor_type: str,
    ) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator)
        self._entry = entry
        self._sensor_type = sensor_type
        self._attr_unique_id = f"{entry.entry_id}_{sensor_type}"
        self._attr_has_entity_name = True

    @property
    def device_info(self) -> dict[str, Any]:
        """Return device information."""
        return {
            "identifiers": {(DOMAIN, self._entry.entry_id)},
            "name": self._entry.data.get(CONF_NAME, "MDT HOME Dashboard"),
            "manufacturer": "MDT",
            "model": "Home Dashboard",
            "sw_version": "1.0.0",
        }


class MDTDashboardConnectedClientsSensor(MDTDashboardSensorBase):
    """Sensor for tracking connected dashboard clients."""

    def __init__(
        self,
        coordinator: MDTDashboardDataUpdateCoordinator,
        entry: ConfigEntry,
    ) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator, entry, SENSOR_CONNECTED_CLIENTS)
        self._attr_name = "Connected Clients"
        self._attr_icon = "mdi:devices"
        self._attr_state_class = SensorStateClass.MEASUREMENT

    @property
    def native_value(self) -> int:
        """Return the state of the sensor."""
        return self.coordinator.data.get("connected_clients", 0)


class MDTDashboardLastUpdateSensor(MDTDashboardSensorBase):
    """Sensor for last dashboard update timestamp."""

    def __init__(
        self,
        coordinator: MDTDashboardDataUpdateCoordinator,
        entry: ConfigEntry,
    ) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator, entry, SENSOR_LAST_UPDATE)
        self._attr_name = "Last Update"
        self._attr_icon = "mdi:update"
        self._attr_device_class = SensorDeviceClass.TIMESTAMP

    @property
    def native_value(self) -> str | None:
        """Return the state of the sensor."""
        return self.coordinator.data.get("last_update")


class MDTDashboardStateSensor(MDTDashboardSensorBase):
    """Sensor for dashboard state."""

    def __init__(
        self,
        coordinator: MDTDashboardDataUpdateCoordinator,
        entry: ConfigEntry,
    ) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator, entry, SENSOR_DASHBOARD_STATE)
        self._attr_name = "Dashboard State"
        self._attr_icon = "mdi:monitor-dashboard"

    @property
    def native_value(self) -> str:
        """Return the state of the sensor."""
        return self.coordinator.data.get("state", "unknown")

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Return additional state attributes."""
        return {
            "connected_clients": self.coordinator.data.get("connected_clients", 0),
            "last_update": self.coordinator.data.get("last_update"),
        }


class MDTDashboardActiveThemeSensor(MDTDashboardSensorBase):
    """Sensor for active dashboard theme."""

    def __init__(
        self,
        coordinator: MDTDashboardDataUpdateCoordinator,
        entry: ConfigEntry,
    ) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator, entry, "active_theme")
        self._attr_name = "Active Theme"
        self._attr_icon = "mdi:theme-light-dark"

    @property
    def native_value(self) -> str:
        """Return the state of the sensor."""
        return self.coordinator.data.get("active_theme", "auto")


class MDTDashboardCurrentPageSensor(MDTDashboardSensorBase):
    """Sensor for current dashboard page."""

    def __init__(
        self,
        coordinator: MDTDashboardDataUpdateCoordinator,
        entry: ConfigEntry,
    ) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator, entry, "current_page")
        self._attr_name = "Current Page"
        self._attr_icon = "mdi:page-layout-body"

    @property
    def native_value(self) -> str:
        """Return the state of the sensor."""
        return self.coordinator.data.get("current_page", "home")


class MDTDashboardEntityCountSensor(MDTDashboardSensorBase):
    """Sensor for dashboard entity count."""

    def __init__(
        self,
        coordinator: MDTDashboardDataUpdateCoordinator,
        entry: ConfigEntry,
    ) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator, entry, "entity_count")
        self._attr_name = "Entity Count"
        self._attr_icon = "mdi:counter"
        self._attr_state_class = SensorStateClass.MEASUREMENT

    @property
    def native_value(self) -> int:
        """Return the state of the sensor."""
        return self.coordinator.data.get("entity_count", 0)


class MDTDashboardMemoryUsageSensor(MDTDashboardSensorBase):
    """Sensor for dashboard memory usage."""

    def __init__(
        self,
        coordinator: MDTDashboardDataUpdateCoordinator,
        entry: ConfigEntry,
    ) -> None:
        """Initialize the sensor."""
        super().__init__(coordinator, entry, "memory_usage")
        self._attr_name = "Memory Usage"
        self._attr_icon = "mdi:memory"
        self._attr_native_unit_of_measurement = "MB"
        self._attr_state_class = SensorStateClass.MEASUREMENT

    @property
    def native_value(self) -> int:
        """Return the state of the sensor."""
        return self.coordinator.data.get("memory_usage", 0)

