"""Number platform for MDT HOME Dashboard integration."""
from __future__ import annotations

import logging
from typing import Any

from homeassistant.components.number import NumberEntity, NumberMode
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_NAME, PERCENTAGE
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import (
    BRIGHTNESS_MAX,
    BRIGHTNESS_MIN,
    BRIGHTNESS_STEP,
    CONF_DASHBOARD_URL,
    DATA_CLIENT,
    DATA_COORDINATOR,
    DEFAULT_NAME,
    DOMAIN,
    VERSION,
)

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up MDT HOME Dashboard number entities."""
    entry_data = hass.data[DOMAIN][entry.entry_id]
    client = entry_data.get(DATA_CLIENT)
    coordinator = entry_data[DATA_COORDINATOR]

    async_add_entities([
        MDTDashboardBrightnessNumber(coordinator, entry, client),
    ])


class MDTDashboardBrightnessNumber(CoordinatorEntity, NumberEntity):
    """Dashboard display brightness slider (0-100%)."""

    def __init__(self, coordinator, entry, client):
        super().__init__(coordinator)
        self._entry = entry
        self._client = client
        self._attr_unique_id = f"{entry.entry_id}_brightness"
        self._attr_name = "Display Brightness"
        self._attr_icon = "mdi:brightness-6"
        self._attr_has_entity_name = True
        self._attr_native_min_value = BRIGHTNESS_MIN
        self._attr_native_max_value = BRIGHTNESS_MAX
        self._attr_native_step = BRIGHTNESS_STEP
        self._attr_native_unit_of_measurement = PERCENTAGE
        self._attr_mode = NumberMode.SLIDER
        self._optimistic: float | None = None

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

    @property
    def available(self) -> bool:
        return self.coordinator.data.get("online", False)

    @property
    def native_value(self) -> float:
        if self._optimistic is not None:
            return self._optimistic
        settings = self.coordinator.data.get("settings", {})
        return float(settings.get("brightness", 100))

    async def async_set_native_value(self, value: float) -> None:
        self._optimistic = value
        self.async_write_ha_state()
        if self._client:
            try:
                await self._client.send_command("set_brightness", {"brightness": int(value)})
            except Exception:
                _LOGGER.warning("Dashboard unreachable for brightness change")
        await self.coordinator.async_request_refresh()
        self._optimistic = None
