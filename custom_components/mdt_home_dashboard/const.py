"""Constants for the MDT HOME Dashboard integration."""

DOMAIN = "mdt_home_dashboard"
VERSION = "2.3.0"

# Configuration constants
CONF_DASHBOARD_URL = "dashboard_url"
CONF_API_KEY = "api_key"
CONF_ENABLE_WEBHOOKS = "enable_webhooks"
CONF_ENABLE_SENSORS = "enable_sensors"
CONF_PANEL_ENABLED = "panel_enabled"

# Defaults
DEFAULT_NAME = "MDT HOME Dashboard"
DEFAULT_SCAN_INTERVAL = 30

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
SERVICE_NAVIGATE_DASHBOARD = "navigate_dashboard"
SERVICE_SET_SCREENSAVER = "set_screensaver"
SERVICE_SET_SLEEP_MODE = "set_sleep_mode"
SERVICE_SET_BRIGHTNESS = "set_brightness"
SERVICE_SNAPSHOT_STATES = "snapshot_states"
SERVICE_EXECUTE_MACRO = "execute_macro"
SERVICE_RELOAD_DASHBOARD = "reload_dashboard"
SERVICE_CLEAR_CACHE = "clear_cache"
SERVICE_RESTART_BACKEND = "restart_backend"
SERVICE_SET_WIDGET_VALUE = "set_widget_value"
SERVICE_RENDER_TEMPLATE = "render_template"
SERVICE_REGISTER_COMPOSITE = "register_composite_sensor"
SERVICE_REMOVE_COMPOSITE = "remove_composite_sensor"
SERVICE_GET_ENTITY_ANALYTICS = "get_entity_analytics"

# -- Actionable device features (unique to MDT Dashboard) --
SERVICE_CREATE_SMART_SCENE = "create_smart_scene"
SERVICE_EXECUTE_SMART_SCENE = "execute_smart_scene"
SERVICE_DELETE_SMART_SCENE = "delete_smart_scene"
SERVICE_SCHEDULE_ACTION = "schedule_action"
SERVICE_CANCEL_SCHEDULE = "cancel_schedule"
SERVICE_ADD_WATCHDOG = "add_watchdog"
SERVICE_REMOVE_WATCHDOG = "remove_watchdog"
SERVICE_CHECK_WATCHDOGS = "check_watchdogs"
SERVICE_DELAYED_ACTION = "delayed_action"
SERVICE_CONDITIONAL_ACTION = "conditional_action"
SERVICE_GROUP_ACTION = "group_action"

# Sensor types
SENSOR_CONNECTED_CLIENTS = "connected_clients"
SENSOR_LAST_UPDATE = "last_update"
SENSOR_DASHBOARD_STATE = "dashboard_state"
SENSOR_CACHE_HITS = "cache_hits"
SENSOR_CACHE_MISSES = "cache_misses"
SENSOR_WS_CONNECTED = "ws_connected"
SENSOR_CACHE_UPDATE_TIME = "cache_update_time"
SENSOR_UPTIME = "uptime"
SENSOR_MEMORY_USAGE = "memory_usage"
SENSOR_ACTIVE_AUTOMATIONS = "active_automations"
SENSOR_ERROR_COUNT = "error_count"
SENSOR_API_REQUESTS = "api_requests"
SENSOR_CACHE_SIZE = "cache_size"
SENSOR_STATE_CHANGES = "state_changes_total"
SENSOR_MOST_ACTIVE_ENTITY = "most_active_entity"
SENSOR_UNAVAILABLE_ENTITIES = "unavailable_entities"
SENSOR_STALE_ENTITIES = "stale_entities"
SENSOR_ENTITY_HEALTH = "entity_health_issues"

# -- Actionable feature sensors --
SENSOR_SMART_SCENES_COUNT = "smart_scenes_count"
SENSOR_SCHEDULED_ACTIONS_COUNT = "scheduled_actions_count"
SENSOR_WATCHDOGS_COUNT = "watchdogs_count"
SENSOR_WATCHDOG_LAST_TRIGGERED = "watchdog_last_triggered"

# Data keys stored in hass.data[DOMAIN]
DATA_COORDINATOR = "coordinator"
DATA_CLIENT = "client"

# Theme options
THEME_OPTIONS = ["auto", "day", "evening", "night", "sleep"]

# Page options
PAGE_OPTIONS = ["home", "rooms", "climate", "energy", "security", "media", "settings"]

# Brightness range
BRIGHTNESS_MIN = 0
BRIGHTNESS_MAX = 100
BRIGHTNESS_STEP = 5
