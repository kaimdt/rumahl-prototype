"""Config flow for MDT HOME Dashboard integration."""
from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.const import CONF_NAME
from homeassistant.core import HomeAssistant, callback
from homeassistant.data_entry_flow import FlowResult
import homeassistant.helpers.config_validation as cv

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

CONF_DASHBOARD_URL = "dashboard_url"
CONF_ENABLE_WEBHOOKS = "enable_webhooks"
CONF_ENABLE_SENSORS = "enable_sensors"


class MDTHomeDashboardConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for MDT HOME Dashboard."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Handle the initial step."""
        errors: dict[str, str] = {}

        if user_input is not None:
            # Validate the dashboard URL if provided
            dashboard_url = user_input.get(CONF_DASHBOARD_URL, "")

            # Create the entry
            return self.async_create_entry(
                title=user_input.get(CONF_NAME, "MDT HOME Dashboard"),
                data=user_input,
            )

        # Show form
        data_schema = vol.Schema(
            {
                vol.Optional(CONF_NAME, default="MDT HOME Dashboard"): str,
                vol.Optional(CONF_DASHBOARD_URL, default=""): str,
                vol.Optional(CONF_ENABLE_WEBHOOKS, default=True): bool,
                vol.Optional(CONF_ENABLE_SENSORS, default=True): bool,
            }
        )

        return self.async_show_form(
            step_id="user",
            data_schema=data_schema,
            errors=errors,
        )

    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry: config_entries.ConfigEntry,
    ) -> MDTHomeDashboardOptionsFlow:
        """Get the options flow for this handler."""
        return MDTHomeDashboardOptionsFlow(config_entry)


class MDTHomeDashboardOptionsFlow(config_entries.OptionsFlow):
    """Handle options flow for MDT HOME Dashboard."""

    def __init__(self, config_entry: config_entries.ConfigEntry) -> None:
        """Initialize options flow."""
        self.config_entry = config_entry

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Manage the options."""
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Optional(
                        CONF_DASHBOARD_URL,
                        default=self.config_entry.data.get(CONF_DASHBOARD_URL, ""),
                    ): str,
                    vol.Optional(
                        CONF_ENABLE_WEBHOOKS,
                        default=self.config_entry.data.get(CONF_ENABLE_WEBHOOKS, True),
                    ): bool,
                    vol.Optional(
                        CONF_ENABLE_SENSORS,
                        default=self.config_entry.data.get(CONF_ENABLE_SENSORS, True),
                    ): bool,
                }
            ),
        )
