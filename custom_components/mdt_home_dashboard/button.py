"""Button platform for MDT HOME Dashboard integration."""
from __future__ import annotations

import logging
from typing import Any

from homeassistant.components.button import ButtonEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_NAME
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import CONF_DASHBOARD_URL, DATA_CLIENT, DATA_COORDINATOR, DEFAULT_NAME, DOMAIN, VERSION

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up MDT HOME Dashboard buttons based on a config entry."""
    entry_data = hass.data[DOMAIN][entry.entry_id]
    client = entry_data.get(DATA_CLIENT)
    coordinator = entry_data[DATA_COORDINATOR]

    async_add_entities([
        MDTDashboardButton(coordinator, entry, client, "refresh", "Refresh Data", "mdi:refresh", "refresh"),
        MDTDashboardButton(coordinator, entry, client, "clear_cache", "Clear Cache", "mdi:delete-sweep", "clear_cache"),
        MDTDashboardButton(coordinator, entry, client, "restart", "Restart Backend", "mdi:restart", "restart"),
        MDTDashboardButton(coordinator, entry, client, "force_sync", "Force Sync", "mdi:sync", "refresh"),
        MDTDashboardNotifyButton(coordinator, entry, client),
    ])


class MDTDashboardButton(CoordinatorEntity, ButtonEntity):
    """Button that sends a command to the dashboard backend."""

    def __init__(self, coordinator, entry, client, button_type, name, icon, command):
        super().__init__(coordinator)
        self._entry = entry
        self._client = client
        self._attr_unique_id = f"{entry.entry_id}_{button_type}"
        self._attr_name = name
        self._attr_icon = icon
        self._attr_has_entity_name = True
        self._button_type = button_type
        self._command = command

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

    async def async_press(self) -> None:
        """Send the command to the dashboard backend."""
        if self._client:
            try:
                await self._client.send_command(self._command)
            except Exception:
                _LOGGER.warning("Dashboard unreachable for command %s", self._command)
        self.hass.bus.async_fire(
            f"{DOMAIN}_button",
            {"button_type": self._button_type, "action": "pressed"},
        )
        await self.coordinator.async_request_refresh()


class MDTDashboardNotifyButton(CoordinatorEntity, ButtonEntity):
    """Send a test notification to the dashboard."""

    def __init__(self, coordinator, entry, client):
        super().__init__(coordinator)
        self._entry = entry
        self._client = client
        self._attr_unique_id = f"{entry.entry_id}_test_notification"
        self._attr_name = "Test Notification"
        self._attr_icon = "mdi:bell-ring"
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

    @property
    def available(self) -> bool:
        return self.coordinator.data.get("online", False)

    async def async_press(self) -> None:
        if self._client:
            try:
                await self._client.send_command("notify", {
                    "message": "Test notification from Home Assistant",
                    "title": "MDT HOME Dashboard",
                    "type": "info",
                })
            except Exception:
                _LOGGER.warning("Dashboard unreachable for test notification")
