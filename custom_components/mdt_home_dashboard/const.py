"""Constants for the MDT HOME Dashboard integration."""

DOMAIN = "mdt_home_dashboard"

# Configuration constants
CONF_DASHBOARD_URL = "dashboard_url"
CONF_ENABLE_WEBHOOKS = "enable_webhooks"
CONF_ENABLE_SENSORS = "enable_sensors"

# Event types
EVENT_DASHBOARD_UPDATE = f"{DOMAIN}_update"
EVENT_DASHBOARD_REFRESH = f"{DOMAIN}_refresh"
EVENT_DASHBOARD_NOTIFICATION = f"{DOMAIN}_notification"
EVENT_DASHBOARD_THEME = f"{DOMAIN}_theme"
EVENT_DASHBOARD_NAVIGATION = f"{DOMAIN}_navigation"
EVENT_DASHBOARD_SCENE = f"{DOMAIN}_scene"
EVENT_DASHBOARD_BACKGROUND = f"{DOMAIN}_background"
EVENT_DASHBOARD_AUTOMATION = f"{DOMAIN}_automation"
EVENT_DASHBOARD_SWITCH = f"{DOMAIN}_switch"
EVENT_DASHBOARD_BUTTON = f"{DOMAIN}_button"

# Service names
SERVICE_UPDATE_DASHBOARD = "update_dashboard"
SERVICE_REFRESH_STATE = "refresh_state"
SERVICE_SEND_NOTIFICATION = "send_notification"
SERVICE_SET_THEME = "set_theme"
SERVICE_SWITCH_PAGE = "switch_page"
SERVICE_ACTIVATE_SCENE = "activate_scene"
SERVICE_SET_BACKGROUND = "set_background"
SERVICE_TRIGGER_AUTOMATION = "trigger_automation"

# Sensor types
SENSOR_CONNECTED_CLIENTS = "connected_clients"
SENSOR_LAST_UPDATE = "last_update"
SENSOR_DASHBOARD_STATE = "dashboard_state"
