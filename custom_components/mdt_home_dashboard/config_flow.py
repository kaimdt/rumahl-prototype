"""Config flow for MDT HOME Dashboard integration."""
from __future__ import annotations

import logging
from typing import Any

import aiohttp
import voluptuous as vol

from homeassistant import config_entries
from homeassistant.const import CONF_NAME
from homeassistant.core import HomeAssistant, callback
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers.aiohttp_client import async_get_clientsession

_LOGGER = logging.getLogger(__name__)

from .const import (
    CONF_DASHBOARD_URL,
    CONF_ENABLE_SENSORS,
    CONF_ENABLE_WEBHOOKS,
    CONF_PANEL_ENABLED,
    DEFAULT_NAME,
    DOMAIN,
)

_LOGGER = logging.getLogger(__name__)


async def _test_dashboard_url(hass: HomeAssistant, url: str) -> bool:
    """Try to reach the dashboard. Returns True if reachable, False otherwise.

    This is intentionally non-blocking — a failed check will NOT prevent
    the config entry from being created.
    """
    if not url:
        return False

    session = async_get_clientsession(hass, verify_ssl=False)
    try:
        async with session.get(
            f"{url.rstrip('/')}/health",
            timeout=aiohttp.ClientTimeout(total=10),
        ) as resp:
            if resp.status == 200:
                data = await resp.json()
                return data.get("status") == "ok"
    except Exception as err:
        _LOGGER.debug("Dashboard connection test failed for %s: %s", url, err)
    return False


class MDTHomeDashboardConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for MDT HOME Dashboard."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Handle the initial step."""
        errors: dict[str, str] = {}

        if user_input is not None:
            dashboard_url = user_input.get(CONF_DASHBOARD_URL, "").strip()
            user_input[CONF_DASHBOARD_URL] = dashboard_url

            # Basic URL format check (non-blocking)
            if dashboard_url and not (
                dashboard_url.startswith("http://")
                or dashboard_url.startswith("https://")
            ):
                errors["base"] = "invalid_url"

            if not errors:
                # Prevent duplicate entries for the same URL
                await self.async_set_unique_id(
                    dashboard_url or "mdt_home_dashboard_default"
                )
                self._abort_if_unique_id_configured()

                # Test connection (non-blocking — entry is created regardless)
                if dashboard_url:
                    reachable = await _test_dashboard_url(self.hass, dashboard_url)
                    if not reachable:
                        _LOGGER.warning(
                            "Dashboard at %s is not reachable right now. "
                            "The integration will keep retrying in the background.",
                            dashboard_url,
                        )

                return self.async_create_entry(
                    title=user_input.get(CONF_NAME, DEFAULT_NAME),
                    data=user_input,
                )

        data_schema = vol.Schema(
            {
                vol.Optional(CONF_NAME, default=DEFAULT_NAME): str,
                vol.Optional(CONF_DASHBOARD_URL, default=""): str,
                vol.Optional(CONF_PANEL_ENABLED, default=True): bool,
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
        self.config_entry = config_entry

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Manage the options."""
        errors: dict[str, str] = {}

        if user_input is not None:
            dashboard_url = user_input.get(CONF_DASHBOARD_URL, "").strip()
            user_input[CONF_DASHBOARD_URL] = dashboard_url

            if dashboard_url and not (
                dashboard_url.startswith("http://")
                or dashboard_url.startswith("https://")
            ):
                errors["base"] = "invalid_url"

            if not errors:
                # Update entry.data so the integration picks up the new URL
                self.hass.config_entries.async_update_entry(
                    self.config_entry, data={**self.config_entry.data, **user_input}
                )
                await self.hass.config_entries.async_reload(self.config_entry.entry_id)
                return self.async_create_entry(title="", data={})

        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Optional(
                        CONF_DASHBOARD_URL,
                        default=self.config_entry.data.get(CONF_DASHBOARD_URL, ""),
                    ): str,
                    vol.Optional(
                        CONF_PANEL_ENABLED,
                        default=self.config_entry.data.get(CONF_PANEL_ENABLED, True),
                    ): bool,
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
            errors=errors,
        )
