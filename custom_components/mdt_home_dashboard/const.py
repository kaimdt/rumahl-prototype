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

# Service names
SERVICE_UPDATE_DASHBOARD = "update_dashboard"
SERVICE_REFRESH_STATE = "refresh_state"
SERVICE_SEND_NOTIFICATION = "send_notification"

# Sensor types
SENSOR_CONNECTED_CLIENTS = "connected_clients"
SENSOR_LAST_UPDATE = "last_update"
SENSOR_DASHBOARD_STATE = "dashboard_state"
