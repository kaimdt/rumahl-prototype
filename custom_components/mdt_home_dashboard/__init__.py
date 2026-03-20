"""MDT HOME Dashboard Integration for Home Assistant.

This integration provides a connection interface between Home Assistant and the MDT HOME Dashboard,
enabling bidirectional communication, state synchronization, and enhanced functionality.
"""
from __future__ import annotations

import logging
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers import config_validation as cv
import voluptuous as vol

_LOGGER = logging.getLogger(__name__)

DOMAIN = "mdt_home_dashboard"
PLATFORMS = [Platform.SENSOR, Platform.SWITCH, Platform.BINARY_SENSOR, Platform.BUTTON]

# Configuration schema for configuration.yaml (optional)
CONFIG_SCHEMA = vol.Schema(
    {
        DOMAIN: vol.Schema(
            {
                vol.Optional("dashboard_url"): cv.string,
                vol.Optional("enable_webhooks", default=True): cv.boolean,
            }
        )
    },
    extra=vol.ALLOW_EXTRA,
)

# Service schemas
SERVICE_UPDATE_DASHBOARD = "update_dashboard"
SERVICE_REFRESH_STATE = "refresh_state"
SERVICE_SEND_NOTIFICATION = "send_notification"
SERVICE_SET_THEME = "set_theme"
SERVICE_SWITCH_PAGE = "switch_page"
SERVICE_ACTIVATE_SCENE = "activate_scene"
SERVICE_SET_BACKGROUND = "set_background"
SERVICE_TRIGGER_AUTOMATION = "trigger_automation"

SERVICE_UPDATE_DASHBOARD_SCHEMA = vol.Schema(
    {
        vol.Required("entity_id"): cv.entity_id,
        vol.Optional("data"): dict,
    }
)

SERVICE_SEND_NOTIFICATION_SCHEMA = vol.Schema(
    {
        vol.Required("message"): cv.string,
        vol.Optional("title"): cv.string,
        vol.Optional("type", default="info"): vol.In(["info", "warning", "error", "success"]),
    }
)

SERVICE_SET_THEME_SCHEMA = vol.Schema(
    {
        vol.Required("theme"): vol.In(["auto", "day", "evening", "night", "sleep"]),
    }
)

SERVICE_SWITCH_PAGE_SCHEMA = vol.Schema(
    {
        vol.Required("page_id"): cv.string,
    }
)

SERVICE_ACTIVATE_SCENE_SCHEMA = vol.Schema(
    {
        vol.Required("scene_id"): cv.string,
    }
)

SERVICE_SET_BACKGROUND_SCHEMA = vol.Schema(
    {
        vol.Required("type"): vol.In(["static", "slideshow", "video", "gradient"]),
        vol.Optional("config"): dict,
    }
)

SERVICE_TRIGGER_AUTOMATION_SCHEMA = vol.Schema(
    {
        vol.Required("automation_id"): cv.string,
        vol.Optional("data"): dict,
    }
)


async def async_setup(hass: HomeAssistant, config: dict[str, Any]) -> bool:
    """Set up the MDT HOME Dashboard integration from configuration.yaml."""
    hass.data.setdefault(DOMAIN, {})

    if DOMAIN in config:
        hass.data[DOMAIN]["config"] = config[DOMAIN]

    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up MDT HOME Dashboard from a config entry."""
    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN][entry.entry_id] = entry.data

    # Register services
    await _async_register_services(hass)

    # Forward setup to platforms
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)

    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id)

    return unload_ok


async def _async_register_services(hass: HomeAssistant) -> None:
    """Register services for the integration."""

    async def handle_update_dashboard(call: ServiceCall) -> None:
        """Handle update_dashboard service call."""
        entity_id = call.data.get("entity_id")
        data = call.data.get("data", {})

        _LOGGER.info(
            "Dashboard update requested for %s with data: %s",
            entity_id,
            data
        )

        # Fire event that dashboard can listen to
        hass.bus.async_fire(
            f"{DOMAIN}_update",
            {
                "entity_id": entity_id,
                "data": data,
            }
        )

    async def handle_refresh_state(call: ServiceCall) -> None:
        """Handle refresh_state service call."""
        _LOGGER.info("Dashboard state refresh requested")

        # Fire event for dashboard to refresh
        hass.bus.async_fire(f"{DOMAIN}_refresh")

    async def handle_send_notification(call: ServiceCall) -> None:
        """Handle send_notification service call."""
        message = call.data.get("message")
        title = call.data.get("title", "MDT HOME Dashboard")
        notif_type = call.data.get("type", "info")

        _LOGGER.info("Sending notification: %s", message)

        # Fire event that dashboard can listen to
        hass.bus.async_fire(
            f"{DOMAIN}_notification",
            {
                "message": message,
                "title": title,
                "type": notif_type,
            }
        )

    async def handle_set_theme(call: ServiceCall) -> None:
        """Handle set_theme service call."""
        theme = call.data.get("theme")

        _LOGGER.info("Setting dashboard theme to: %s", theme)

        # Fire event for theme change
        hass.bus.async_fire(
            f"{DOMAIN}_theme",
            {
                "theme": theme,
                "action": "set",
            }
        )

    async def handle_switch_page(call: ServiceCall) -> None:
        """Handle switch_page service call."""
        page_id = call.data.get("page_id")

        _LOGGER.info("Switching dashboard page to: %s", page_id)

        # Fire event for page navigation
        hass.bus.async_fire(
            f"{DOMAIN}_navigation",
            {
                "page_id": page_id,
                "action": "switch",
            }
        )

    async def handle_activate_scene(call: ServiceCall) -> None:
        """Handle activate_scene service call."""
        scene_id = call.data.get("scene_id")

        _LOGGER.info("Activating dashboard scene: %s", scene_id)

        # Fire event for scene activation
        hass.bus.async_fire(
            f"{DOMAIN}_scene",
            {
                "scene_id": scene_id,
                "action": "activate",
            }
        )

    async def handle_set_background(call: ServiceCall) -> None:
        """Handle set_background service call."""
        bg_type = call.data.get("type")
        config = call.data.get("config", {})

        _LOGGER.info("Setting dashboard background type: %s", bg_type)

        # Fire event for background change
        hass.bus.async_fire(
            f"{DOMAIN}_background",
            {
                "type": bg_type,
                "config": config,
                "action": "set",
            }
        )

    async def handle_trigger_automation(call: ServiceCall) -> None:
        """Handle trigger_automation service call."""
        automation_id = call.data.get("automation_id")
        data = call.data.get("data", {})

        _LOGGER.info("Triggering dashboard automation: %s", automation_id)

        # Fire event for automation trigger
        hass.bus.async_fire(
            f"{DOMAIN}_automation",
            {
                "automation_id": automation_id,
                "data": data,
                "action": "trigger",
            }
        )

    # Register services only once
    if not hass.services.has_service(DOMAIN, SERVICE_UPDATE_DASHBOARD):
        hass.services.async_register(
            DOMAIN,
            SERVICE_UPDATE_DASHBOARD,
            handle_update_dashboard,
            schema=SERVICE_UPDATE_DASHBOARD_SCHEMA,
        )

    if not hass.services.has_service(DOMAIN, SERVICE_REFRESH_STATE):
        hass.services.async_register(
            DOMAIN,
            SERVICE_REFRESH_STATE,
            handle_refresh_state,
        )

    if not hass.services.has_service(DOMAIN, SERVICE_SEND_NOTIFICATION):
        hass.services.async_register(
            DOMAIN,
            SERVICE_SEND_NOTIFICATION,
            handle_send_notification,
            schema=SERVICE_SEND_NOTIFICATION_SCHEMA,
        )

    if not hass.services.has_service(DOMAIN, SERVICE_SET_THEME):
        hass.services.async_register(
            DOMAIN,
            SERVICE_SET_THEME,
            handle_set_theme,
            schema=SERVICE_SET_THEME_SCHEMA,
        )

    if not hass.services.has_service(DOMAIN, SERVICE_SWITCH_PAGE):
        hass.services.async_register(
            DOMAIN,
            SERVICE_SWITCH_PAGE,
            handle_switch_page,
            schema=SERVICE_SWITCH_PAGE_SCHEMA,
        )

    if not hass.services.has_service(DOMAIN, SERVICE_ACTIVATE_SCENE):
        hass.services.async_register(
            DOMAIN,
            SERVICE_ACTIVATE_SCENE,
            handle_activate_scene,
            schema=SERVICE_ACTIVATE_SCENE_SCHEMA,
        )

    if not hass.services.has_service(DOMAIN, SERVICE_SET_BACKGROUND):
        hass.services.async_register(
            DOMAIN,
            SERVICE_SET_BACKGROUND,
            handle_set_background,
            schema=SERVICE_SET_BACKGROUND_SCHEMA,
        )

    if not hass.services.has_service(DOMAIN, SERVICE_TRIGGER_AUTOMATION):
        hass.services.async_register(
            DOMAIN,
            SERVICE_TRIGGER_AUTOMATION,
            handle_trigger_automation,
            schema=SERVICE_TRIGGER_AUTOMATION_SCHEMA,
        )
