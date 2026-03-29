"""Switch platform for MDT HOME Dashboard integration."""
from __future__ import annotations

import logging
from typing import Any

from homeassistant.components.switch import SwitchEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_NAME
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import (
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
    """Set up MDT HOME Dashboard switches based on a config entry."""
    entry_data = hass.data[DOMAIN][entry.entry_id]
    client = entry_data.get(DATA_CLIENT)
    coordinator = entry_data[DATA_COORDINATOR]

    async_add_entities([
        MDTDashboardSwitch(coordinator, entry, client, "screensaver", "Screensaver", "mdi:monitor-off"),
        MDTDashboardSwitch(coordinator, entry, client, "auto_theme", "Auto Theme", "mdi:theme-light-dark"),
        MDTDashboardSwitch(coordinator, entry, client, "webhooks", "Webhooks", "mdi:webhook"),
        MDTDashboardSwitch(coordinator, entry, client, "sleep_mode", "Sleep Mode", "mdi:sleep"),
    ])


class MDTDashboardSwitch(CoordinatorEntity, SwitchEntity):
    """Switch backed by the dashboard backend settings API."""

    def __init__(self, coordinator, entry, client, switch_type, name, icon):
        super().__init__(coordinator)
        self._entry = entry
        self._client = client
        self._switch_type = switch_type
        self._attr_unique_id = f"{entry.entry_id}_{switch_type}"
        self._attr_name = name
        self._attr_icon = icon
        self._attr_has_entity_name = True
        # Optimistic fallback until next coordinator update
        self._optimistic: bool | None = None

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
    def is_on(self) -> bool:
        if self._optimistic is not None:
            return self._optimistic
        settings = self.coordinator.data.get("settings", {})
        return bool(settings.get(self._switch_type, False))

    async def _set_state(self, state: bool) -> None:
        self._optimistic = state
        self.async_write_ha_state()
        if self._client:
            try:
                await self._client.send_command(
                    "set_setting", {self._switch_type: state}
                )
            except Exception:
                _LOGGER.warning("Dashboard unreachable for %s toggle", self._switch_type)
        # Also fire event for automations
        self.hass.bus.async_fire(
            f"{DOMAIN}_switch",
            {"switch_type": self._switch_type, "state": "on" if state else "off"},
        )
        # Request coordinator refresh so all entities get updated settings
        await self.coordinator.async_request_refresh()
        self._optimistic = None

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self._set_state(True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self._set_state(False)
