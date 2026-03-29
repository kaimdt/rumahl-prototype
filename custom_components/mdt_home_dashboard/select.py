"""Select platform for MDT HOME Dashboard integration."""
from __future__ import annotations

import logging
from typing import Any

from homeassistant.components.select import SelectEntity
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
    PAGE_OPTIONS,
    THEME_OPTIONS,
    VERSION,
)

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up MDT HOME Dashboard select entities."""
    entry_data = hass.data[DOMAIN][entry.entry_id]
    client = entry_data.get(DATA_CLIENT)
    coordinator = entry_data[DATA_COORDINATOR]

    async_add_entities([
        MDTDashboardThemeSelect(coordinator, entry, client),
        MDTDashboardPageSelect(coordinator, entry, client),
    ])


class _BaseSelect(CoordinatorEntity, SelectEntity):
    """Base for MDT Dashboard select entities."""

    def __init__(self, coordinator, entry, client, select_type, name, icon, options, setting_key, command):
        super().__init__(coordinator)
        self._entry = entry
        self._client = client
        self._attr_unique_id = f"{entry.entry_id}_{select_type}"
        self._attr_name = name
        self._attr_icon = icon
        self._attr_has_entity_name = True
        self._attr_options = options
        self._setting_key = setting_key
        self._command = command
        self._data_key = setting_key  # key in backend command data
        self._optimistic: str | None = None

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
    def current_option(self) -> str | None:
        if self._optimistic is not None:
            return self._optimistic
        settings = self.coordinator.data.get("settings", {})
        return settings.get(self._setting_key, self._attr_options[0])

    async def async_select_option(self, option: str) -> None:
        self._optimistic = option
        self.async_write_ha_state()
        if self._client:
            try:
                await self._client.send_command(self._command, {self._data_key: option})
            except Exception:
                _LOGGER.warning("Dashboard unreachable for %s change", self._setting_key)
        self.hass.bus.async_fire(
            f"{DOMAIN}_{self._setting_key}",
            {self._setting_key: option, "action": "set"},
        )
        await self.coordinator.async_request_refresh()
        self._optimistic = None


class MDTDashboardThemeSelect(_BaseSelect):
    """Select the active dashboard theme."""

    def __init__(self, coordinator, entry, client):
        super().__init__(
            coordinator, entry, client,
            "theme_select", "Dashboard Theme", "mdi:palette",
            THEME_OPTIONS, "theme", "set_theme",
        )


class MDTDashboardPageSelect(_BaseSelect):
    """Select the active dashboard page."""

    def __init__(self, coordinator, entry, client):
        super().__init__(
            coordinator, entry, client,
            "page_select", "Dashboard Page", "mdi:book-open-page-variant",
            PAGE_OPTIONS, "current_page", "switch_page",
        )
        self._data_key = "page_id"
