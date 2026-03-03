"""Binary sensor platform for MDT HOME Dashboard integration."""
from __future__ import annotations

import logging
from typing import Any

from homeassistant.components.binary_sensor import (
    BinarySensorEntity,
    BinarySensorDeviceClass,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_NAME
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up MDT HOME Dashboard binary sensors based on a config entry."""

    binary_sensors = [
        MDTDashboardConnectionSensor(hass, entry),
        MDTDashboardUpdateAvailableSensor(hass, entry),
        MDTDashboardBackendConnectedSensor(hass, entry),
    ]

    async_add_entities(binary_sensors)


class MDTDashboardBinarySensorBase(BinarySensorEntity):
    """Base class for MDT Dashboard binary sensors."""

    def __init__(
        self,
        hass: HomeAssistant,
        entry: ConfigEntry,
        sensor_type: str,
        name: str,
        icon: str,
        device_class: BinarySensorDeviceClass | None = None,
    ) -> None:
        """Initialize the binary sensor."""
        self.hass = hass
        self._entry = entry
        self._sensor_type = sensor_type
        self._attr_unique_id = f"{entry.entry_id}_{sensor_type}"
        self._attr_name = name
        self._attr_icon = icon
        self._attr_device_class = device_class
        self._attr_has_entity_name = True
        self._is_on = False

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

    @property
    def is_on(self) -> bool:
        """Return true if the binary sensor is on."""
        return self._is_on


class MDTDashboardConnectionSensor(MDTDashboardBinarySensorBase):
    """Binary sensor for dashboard connection status."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """Initialize the connection sensor."""
        super().__init__(
            hass,
            entry,
            "connection",
            "Connection",
            "mdi:lan-connect",
            BinarySensorDeviceClass.CONNECTIVITY
        )
        self._is_on = True  # Assume connected initially


class MDTDashboardUpdateAvailableSensor(MDTDashboardBinarySensorBase):
    """Binary sensor for update availability."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """Initialize the update available sensor."""
        super().__init__(
            hass,
            entry,
            "update_available",
            "Update Available",
            "mdi:update",
            BinarySensorDeviceClass.UPDATE
        )


class MDTDashboardBackendConnectedSensor(MDTDashboardBinarySensorBase):
    """Binary sensor for backend connection status."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """Initialize the backend connected sensor."""
        super().__init__(
            hass,
            entry,
            "backend_connected",
            "Backend Connected",
            "mdi:server-network",
            BinarySensorDeviceClass.CONNECTIVITY
        )
