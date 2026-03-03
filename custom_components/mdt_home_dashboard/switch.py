"""Switch platform for MDT HOME Dashboard integration."""
from __future__ import annotations

import logging
from typing import Any

from homeassistant.components.switch import SwitchEntity
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
    """Set up MDT HOME Dashboard switches based on a config entry."""

    switches = [
        MDTDashboardScreensaverSwitch(hass, entry),
        MDTDashboardAutoThemeSwitch(hass, entry),
        MDTDashboardWebhooksSwitch(hass, entry),
        MDTDashboardSleepModeSwitch(hass, entry),
    ]

    async_add_entities(switches)


class MDTDashboardSwitchBase(SwitchEntity):
    """Base class for MDT Dashboard switches."""

    def __init__(
        self,
        hass: HomeAssistant,
        entry: ConfigEntry,
        switch_type: str,
        name: str,
        icon: str,
    ) -> None:
        """Initialize the switch."""
        self.hass = hass
        self._entry = entry
        self._switch_type = switch_type
        self._attr_unique_id = f"{entry.entry_id}_{switch_type}"
        self._attr_name = name
        self._attr_icon = icon
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
        """Return true if the switch is on."""
        return self._is_on

    async def async_turn_on(self, **kwargs: Any) -> None:
        """Turn the switch on."""
        self._is_on = True

        # Fire event for dashboard
        self.hass.bus.async_fire(
            f"{DOMAIN}_switch",
            {
                "switch_type": self._switch_type,
                "state": "on",
            }
        )

        self.async_write_ha_state()
        _LOGGER.info("Switch %s turned on", self._switch_type)

    async def async_turn_off(self, **kwargs: Any) -> None:
        """Turn the switch off."""
        self._is_on = False

        # Fire event for dashboard
        self.hass.bus.async_fire(
            f"{DOMAIN}_switch",
            {
                "switch_type": self._switch_type,
                "state": "off",
            }
        )

        self.async_write_ha_state()
        _LOGGER.info("Switch %s turned off", self._switch_type)


class MDTDashboardScreensaverSwitch(MDTDashboardSwitchBase):
    """Switch for dashboard screensaver."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """Initialize the screensaver switch."""
        super().__init__(
            hass,
            entry,
            "screensaver",
            "Screensaver",
            "mdi:monitor-off"
        )


class MDTDashboardAutoThemeSwitch(MDTDashboardSwitchBase):
    """Switch for automatic theme switching."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """Initialize the auto theme switch."""
        super().__init__(
            hass,
            entry,
            "auto_theme",
            "Auto Theme",
            "mdi:theme-light-dark"
        )


class MDTDashboardWebhooksSwitch(MDTDashboardSwitchBase):
    """Switch for enabling/disabling webhooks."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """Initialize the webhooks switch."""
        super().__init__(
            hass,
            entry,
            "webhooks",
            "Webhooks",
            "mdi:webhook"
        )
        self._is_on = entry.data.get("enable_webhooks", True)


class MDTDashboardSleepModeSwitch(MDTDashboardSwitchBase):
    """Switch for sleep mode."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """Initialize the sleep mode switch."""
        super().__init__(
            hass,
            entry,
            "sleep_mode",
            "Sleep Mode",
            "mdi:sleep"
        )
