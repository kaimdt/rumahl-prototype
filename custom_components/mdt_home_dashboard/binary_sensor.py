"""Binary sensor platform for MDT HOME Dashboard integration."""
from __future__ import annotations

import logging
from typing import Any

from homeassistant.components.binary_sensor import (
    BinarySensorDeviceClass,
    BinarySensorEntity,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_NAME
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import CONF_DASHBOARD_URL, DATA_COORDINATOR, DEFAULT_NAME, DOMAIN, VERSION

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up MDT HOME Dashboard binary sensors based on a config entry."""
    coordinator = hass.data[DOMAIN][entry.entry_id].get(DATA_COORDINATOR)
    if coordinator is None:
        _LOGGER.warning("No coordinator available for binary sensors")
        return

    async_add_entities([
        MDTDashboardConnectionSensor(coordinator, entry),
        MDTDashboardHAConnectedSensor(coordinator, entry),
    ])


class _BaseBinarySensor(CoordinatorEntity, BinarySensorEntity):
    """Base binary sensor backed by the shared coordinator."""

    def __init__(self, coordinator, entry, sensor_type, name, icon, device_class=None):
        super().__init__(coordinator)
        self._entry = entry
        self._attr_unique_id = f"{entry.entry_id}_{sensor_type}"
        self._attr_name = name
        self._attr_icon = icon
        self._attr_device_class = device_class
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


class MDTDashboardConnectionSensor(_BaseBinarySensor):
    """True when the dashboard backend is reachable."""

    def __init__(self, coordinator, entry):
        super().__init__(
            coordinator, entry,
            "connection", "Dashboard Online", "mdi:lan-connect",
            BinarySensorDeviceClass.CONNECTIVITY,
        )

    @property
    def is_on(self) -> bool:
        return self.coordinator.data.get("online", False)


class MDTDashboardHAConnectedSensor(_BaseBinarySensor):
    """True when the dashboard backend has an active HA WebSocket connection."""

    def __init__(self, coordinator, entry):
        super().__init__(
            coordinator, entry,
            "ha_connected", "HA Connected", "mdi:home-assistant",
            BinarySensorDeviceClass.CONNECTIVITY,
        )

    @property
    def is_on(self) -> bool:
        return self.coordinator.data.get("ha_connected", False)
