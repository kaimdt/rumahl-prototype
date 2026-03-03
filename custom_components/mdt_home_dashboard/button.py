"""Button platform for MDT HOME Dashboard integration."""
from __future__ import annotations

import logging
from typing import Any

from homeassistant.components.button import ButtonEntity
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
    """Set up MDT HOME Dashboard buttons based on a config entry."""

    buttons = [
        MDTDashboardRefreshButton(hass, entry),
        MDTDashboardReloadButton(hass, entry),
        MDTDashboardClearCacheButton(hass, entry),
        MDTDashboardRestartButton(hass, entry),
    ]

    async_add_entities(buttons)


class MDTDashboardButtonBase(ButtonEntity):
    """Base class for MDT Dashboard buttons."""

    def __init__(
        self,
        hass: HomeAssistant,
        entry: ConfigEntry,
        button_type: str,
        name: str,
        icon: str,
    ) -> None:
        """Initialize the button."""
        self.hass = hass
        self._entry = entry
        self._button_type = button_type
        self._attr_unique_id = f"{entry.entry_id}_{button_type}"
        self._attr_name = name
        self._attr_icon = icon
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

    async def async_press(self) -> None:
        """Handle the button press."""
        # Fire event for dashboard
        self.hass.bus.async_fire(
            f"{DOMAIN}_button",
            {
                "button_type": self._button_type,
                "action": "pressed",
            }
        )

        _LOGGER.info("Button %s pressed", self._button_type)


class MDTDashboardRefreshButton(MDTDashboardButtonBase):
    """Button to refresh dashboard state."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """Initialize the refresh button."""
        super().__init__(
            hass,
            entry,
            "refresh",
            "Refresh",
            "mdi:refresh"
        )


class MDTDashboardReloadButton(MDTDashboardButtonBase):
    """Button to reload dashboard."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """Initialize the reload button."""
        super().__init__(
            hass,
            entry,
            "reload",
            "Reload",
            "mdi:reload"
        )


class MDTDashboardClearCacheButton(MDTDashboardButtonBase):
    """Button to clear dashboard cache."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """Initialize the clear cache button."""
        super().__init__(
            hass,
            entry,
            "clear_cache",
            "Clear Cache",
            "mdi:delete-sweep"
        )


class MDTDashboardRestartButton(MDTDashboardButtonBase):
    """Button to restart dashboard."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """Initialize the restart button."""
        super().__init__(
            hass,
            entry,
            "restart",
            "Restart",
            "mdi:restart"
        )
