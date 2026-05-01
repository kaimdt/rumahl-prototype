# API-Endpoint Analyse – IORA Monorepo

> Erstellt: 2026-05-01  
> Analyse aller API-Endpoints im gesamten Projekt mit Status `✅ OK`, `⚠️ Stub`, `❌ Fehlt`, `🔧 Teilweise`

---

## Legende

| Symbol | Bedeutung |
|--------|-----------|
| ✅ | Endpoint vollständig implementiert |
| ⚠️ | Nur als stub/unavailable implementiert (leeres oder 404-JSON) |
| ❌ | Im Backend nicht vorhanden – Frontend ruft auf → 404 |
| 🔧 | Teilweise implementiert (z.B. nur GET, kein POST/PUT/DELETE) |
| 🧩 | Wird von externem Microservice bereitgestellt (nicht iora-home) |

---

## 1. Health & System

| Endpoint | Methode | Backend | Frontend | Status |
|----------|---------|---------|----------|--------|
| `/health` | GET | ✅ `health_check` | - | ✅ |
| `/api/version` | GET | ✅ `get_version` | - | ✅ |
| `/api/maintenance/status` | GET | ✅ `public_maintenance_status` | `App.tsx:177` | ✅ |
| `/api/system/stats` | GET | ✅ `get_system_stats` | - | ✅ |
| `/api/system/ha-info` | GET | ✅ `get_ha_info` | - | ✅ |

---

## 2. Auth

| Endpoint | Methode | Backend | Frontend | Status |
|----------|---------|---------|----------|--------|
| `/api/auth/register` | POST | ✅ `auth_register` | `AuthContext.tsx:185` | ✅ |
| `/api/auth/login` | POST | ✅ `auth_login` | `AuthContext.tsx:131` | ✅ |
| `/api/auth/verify` | GET | ✅ `auth_verify` | `AuthContext.tsx:92`, `SettingsPage.tsx:375` | ✅ |
| `/api/auth/pin-login` | POST | ✅ `auth_pin_login` | `AuthContext.tsx:158` | ✅ |
| `/api/auth/users` | GET | ✅ `list_all_users` | `LoginModal.tsx:162`, `UserSwitcher.tsx:33`, `SettingsPage.tsx:379` | ✅ |
| `/api/auth/pin` | POST | ✅ `set_user_pin` | `SettingsPage.tsx:404` | ✅ |
| `/api/auth/pin` | DELETE | ✅ `remove_user_pin` | `SettingsPage.tsx:431` | ✅ |

---

## 3. Entities & States

| Endpoint | Methode | Backend | Frontend | Status |
|----------|---------|---------|----------|--------|
| `/api/states` | GET | ✅ `get_states` | `homeAssistant.ts:31`, `IFrameWidget.tsx:153`, `provider.ts:77` | ✅ |
| `/api/states/:entity_id` | GET | ✅ `get_state` | `IFrameWidget.tsx:165`, `provider.ts:98` | ✅ |
| `/api/entities/domain/:domain` | GET | ✅ `get_entities_by_domain` | `AdminPanel.tsx:5822` | ✅ |
| `/api/entities/search` | GET | ✅ `search_entities` | `AdminPanel.tsx:5832` | ✅ |
| `/api/entities/count` | GET | ✅ `get_entity_counts` | - | ✅ |
| `/api/services/:domain/:service` | POST | ✅ `call_service` | `homeAssistant.ts:52,85`, `IFrameWidget.tsx:178`, `provider.ts:122` | ✅ |

---

## 4. History & Stats

| Endpoint | Methode | Backend | Frontend | Status |
|----------|---------|---------|----------|--------|
| `/api/history/period/:start_time` | GET | ✅ `get_history` | `MapWidget.tsx:1222,1357`, `homeAssistant.ts:263` | ✅ |
| `/api/local-history/:entity_id` | GET | ✅ `get_local_history` | `WaterUsageWidget.tsx:47` | ✅ |
| `/api/stats/entity-history/:entity_id` | GET | ✅ `get_entity_statistics` | `EntityStatisticsWidget.tsx:29`, `AdminPanel.tsx:5843` | ✅ |
| `/api/stats/dashboard` | GET | ✅ `get_dashboard_statistics` | `EnergyMonitorWidget.tsx:44`, `AdminPanel.tsx:6250` | ✅ |
| `/api/location-history/:entity_id` | GET | ✅ `get_location_history` | `MapWidget.tsx:1331` | ✅ |
| `/api/location-history/sync/status` | GET | ✅ `get_location_sync_status` | - | ✅ |
| `/api/weather/forecast/:entity_id/:forecast_type` | GET | ✅ `get_cached_forecast` | `homeAssistant.ts:282,362` | ✅ |
| `/api/weather/forecast/:entity_id/:forecast_type` | POST | ✅ `save_cached_forecast` | `homeAssistant.ts:362` | ✅ |

---

## 5. Config – Users, Devices, Profiles

| Endpoint | Methode | Backend | Frontend | Status |
|----------|---------|---------|----------|--------|
| `/api/config/users` | POST | ✅ `create_user` | `ConfigurationContext.tsx:219` | ✅ |
| `/api/config/users/:username` | GET | ✅ `get_user` | `ConfigurationContext.tsx:211` | ✅ |
| `/api/config/users/by-id/:user_id` | PUT | ✅ `update_user` | `AuthContext.tsx:214` | ✅ |
| `/api/config/devices` | POST | ✅ `register_device` | `ConfigurationContext.tsx:179` | ✅ |
| `/api/config/devices/:device_id` | GET | ✅ `get_device_info` | `ConfigurationContext.tsx:170` | ✅ |
| `/api/config/devices/:device_id/heartbeat` | POST | ✅ `device_heartbeat` | `ConfigurationContext.tsx:440` | ✅ |
| `/api/config/devices/:device_id/terminal` | POST | ✅ `set_device_terminal_mode` | - | ✅ |
| `/api/config/profiles` | POST | ✅ `create_profile` | `ConfigurationContext.tsx:249` | ✅ |
| `/api/config/profiles/:profile_id` | GET | ✅ `get_profile_data` | `ConfigurationContext.tsx:276` | ✅ |
| `/api/config/profiles/:profile_id/pages` | POST | ✅ `save_pages` | `ConfigurationContext.tsx:330` | ✅ |
| `/api/config/profiles/:profile_id/theme` | POST | ✅ `save_theme_settings` | `ConfigurationContext.tsx:351` | ✅ |
| `/api/config/profiles/:profile_id/background` | POST | ✅ `save_background_config` | `ConfigurationContext.tsx:375` | ✅ |
| `/api/config/profiles/:profile_id/layouts` | GET | ✅ `get_page_layouts` | - | ✅ |
| `/api/config/profiles/:profile_id/layouts` | POST | ✅ `save_page_layout` | - | ✅ |
| `/api/config/profiles/:profile_id/page-settings` | GET | ✅ `get_all_page_settings` | - | ✅ |
| `/api/config/profiles/:profile_id/page-settings` | POST | ✅ `save_page_settings_handler` | - | ✅ |
| `/api/config/profiles/:profile_id/page-settings/:page_id` | GET | ✅ `get_page_settings_handler` | - | ✅ |
| `/api/config/profiles/:profile_id/page-settings/:page_id` | DELETE | ✅ `delete_page_settings_handler` | - | ✅ |
| `/api/config/preferences/:user_id` | POST | ✅ `save_user_preference` | `ConfigurationContext.tsx:397` | ✅ |
| `/api/config/preferences/:user_id` | GET | ✅ `get_user_preferences` | `ConfigurationContext.tsx:419` | ✅ |

---

## 6. System Preferences & Settings

| Endpoint | Methode | Backend | Frontend | Status |
|----------|---------|---------|----------|--------|
| `/api/config/system/preferences` | GET | ✅ `get_system_preferences` | - | ✅ |
| `/api/config/system/preferences` | POST | ✅ `save_system_preference` | - | ✅ |
| `/api/admin/settings/schema` | GET | ✅ `admin_settings_schema` | - | ✅ |
| `/api/admin/settings/schema/wizard` | GET | ✅ `admin_settings_schema_wizard` | - | ✅ |
| `/api/admin/settings` | GET | ✅ `admin_settings_list` | `useGlobalConfig.tsx:84`, `AdminPanel.tsx:918,1230` | ✅ |
| `/api/admin/settings/:key` | GET | ✅ `admin_settings_get` | `useGlobalConfig.tsx:115` | ✅ |
| `/api/admin/settings/:key` | PUT | ✅ `admin_settings_put` | `useGlobalConfig.tsx:128`, `AdminPanel.tsx:952,1257` | ✅ |

---

## 7. API Keys

| Endpoint | Methode | Backend | Frontend | Status |
|----------|---------|---------|----------|--------|
| `/api/keys` | GET | ✅ `list_my_api_keys` | `AdminPanel.tsx:2332` | ✅ |
| `/api/keys` | POST | ✅ `create_api_key` | `AdminPanel.tsx:2343` | ✅ |
| `/api/keys/:key_id` | PUT | ✅ `update_api_key` | - | ✅ |
| `/api/keys/:key_id` | DELETE | ✅ `delete_api_key` | `AdminPanel.tsx:2363` | ✅ |

---

## 8. Uploads

| Endpoint | Methode | Backend | Frontend | Status |
|----------|---------|---------|----------|--------|
| `/api/uploads/background` | POST | ✅ `upload_background_image` | `ConfigurationSettings.tsx:338`, `PageSettingsDialog.tsx:90` | ✅ |
| `/uploads/*` | GET | ✅ `ServeDir` | - | ✅ |

---

## 9. Webhooks (User)

| Endpoint | Methode | Backend | Frontend | Status |
|----------|---------|---------|----------|--------|
| `/api/webhooks` | GET | ✅ `list_webhooks` | `AdminPanel.tsx:5068` | ✅ |
| `/api/webhooks` | POST | ✅ `create_webhook` | `AdminPanel.tsx:5080` | ✅ |
| `/api/webhooks/:webhook_id` | PUT | ✅ `update_webhook` | `AdminPanel.tsx:5103` | ✅ |
| `/api/webhooks/:webhook_id` | DELETE | ✅ `delete_webhook` | `AdminPanel.tsx:5094` | ✅ |
| `/api/webhooks/:webhook_id/test` | POST | ✅ `test_webhook` | `AdminPanel.tsx:5115` | ✅ |
| `/api/webhooks/:webhook_id/deliveries` | GET | ✅ `get_webhook_deliveries` | `AdminPanel.tsx:5125` | ✅ |

---

## 10. Admin – Users, Devices

| Endpoint | Methode | Backend | Frontend | Status |
|----------|---------|---------|----------|--------|
| `/api/admin/users` | GET | ✅ `admin_list_users` | `AdminPanel.tsx:2125` | ✅ |
| `/api/admin/users/:user_id/admin` | PUT | ✅ `admin_set_user_admin` | `AdminPanel.tsx:2136` | ✅ |
| `/api/admin/users/:user_id` | PUT | ✅ `admin_update_user` | `AdminPanel.tsx:2162` | ✅ |
| `/api/admin/users/:user_id` | DELETE | ✅ `admin_delete_user` | `AdminPanel.tsx:2148` | ✅ |
| `/api/admin/api-keys` | GET | ✅ `admin_list_all_api_keys` | - | ✅ |
| `/api/admin/api-keys/:key_id` | DELETE | ✅ `admin_delete_api_key` | - | ✅ |
| `/api/admin/devices` | GET | ✅ `admin_list_devices` | `AdminPanel.tsx:8064` | ✅ |
| `/api/admin/devices/:device_id` | DELETE | ✅ `admin_delete_device` | `AdminPanel.tsx:8082` | ✅ |

---

## 11. Admin – Home Assistant Deep Integration

| Endpoint | Methode | Backend | Frontend | Status |
|----------|---------|---------|----------|--------|
| `/api/admin/ha/config` | GET | ✅ `admin_ha_config` | - | ✅ |
| `/api/admin/ha/integrations` | GET | ✅ `admin_ha_integrations` | - | ✅ |
| `/api/admin/ha/devices` | GET | ✅ `admin_ha_devices` | - | ✅ |
| `/api/admin/ha/areas` | GET | ✅ `admin_ha_areas` | - | ✅ |
| `/api/admin/ha/automations` | GET | ✅ `admin_ha_automations` | - | ✅ |
| `/api/admin/ha/services` | GET | ✅ `admin_ha_services` | - | ✅ |
| `/api/admin/ha/logs` | GET | ✅ `admin_ha_logs` | `AdminPanel.tsx:3950` | ✅ |
| `/api/admin/ha/mqtt` | GET | ✅ `admin_ha_mqtt` | - | ✅ |
| `/api/admin/ha/matter` | GET | ✅ `admin_ha_matter` | - | ✅ |
| `/api/admin/ha/addons` | GET | ✅ `admin_ha_addons` | - | ✅ |
| `/api/admin/ha/supervisor` | GET | ✅ `admin_ha_supervisor` | - | ✅ |
| `/api/admin/ha/scenes` | GET | ✅ `admin_ha_scenes` | - | ✅ |
| `/api/admin/ha/backups` | GET | ✅ `admin_ha_backups` | - | ✅ |
| `/api/admin/ha/network` | GET | ✅ `admin_ha_network` | - | ✅ |
| `/api/admin/ha/logbook` | GET | ✅ `admin_ha_logbook` | `AdminPanel.tsx:6348` | ✅ |
| `/api/admin/ha/calendars` | GET | ✅ `admin_ha_calendars` | `AdminPanel.tsx:6452` | ✅ |
| `/api/admin/ha/calendars/:entity_id/events` | GET | ✅ `admin_ha_calendar_events` | `AdminPanel.tsx:6465` | ✅ |
| `/api/admin/ha/template` | POST | ✅ `admin_ha_render_template` | `AdminPanel.tsx:6697` | ✅ |
| `/api/admin/ha/events/:event_type` | POST | ✅ `admin_ha_fire_event` | `AdminPanel.tsx:6718` | ✅ |
| `/api/admin/ha/registry/entities` | GET | ✅ `admin_ha_entity_registry` | `AdminPanel.tsx:6733` (kind) | ✅ |
| `/api/admin/ha/registry/devices` | GET | ✅ `admin_ha_device_registry` | `AdminPanel.tsx:6733` (kind) | ✅ |
| `/api/admin/ha/registry/areas` | GET | ✅ `admin_ha_area_registry` | `AdminPanel.tsx:6733` (kind) | ✅ |
| `/api/admin/ha/connection` | GET | ✅ `admin_ha_connection_status` | `AdminPanel.tsx:3162` | ✅ |

---

## 12. Admin – MQTT Client

| Endpoint | Methode | Backend | Frontend | Status |
|----------|---------|---------|----------|--------|
| `/api/admin/mqtt/status` | GET | ✅ `admin_mqtt_status` | `AdminPanel.tsx:2747,2763` | ✅ |
| `/api/admin/mqtt/connect` | POST | ✅ `admin_mqtt_connect` | `AdminPanel.tsx:2786` | ✅ |
| `/api/admin/mqtt/disconnect` | POST | ✅ `admin_mqtt_disconnect` | `AdminPanel.tsx:2807` | ✅ |
| `/api/admin/mqtt/subscribe` | POST | ✅ `admin_mqtt_subscribe` | `AdminPanel.tsx:2816` | ✅ |
| `/api/admin/mqtt/unsubscribe` | POST | ✅ `admin_mqtt_unsubscribe` | `AdminPanel.tsx:2828` | ✅ |
| `/api/admin/mqtt/publish` | POST | ✅ `admin_mqtt_publish` | `AdminPanel.tsx:2840` | ✅ |
| `/api/admin/mqtt/messages` | GET | ✅ `admin_mqtt_messages` | `AdminPanel.tsx:2754` | ✅ |
| `/api/admin/mqtt/config` | GET | ✅ `admin_mqtt_get_config` | `AdminPanel.tsx:2766` | ✅ |
| `/api/admin/mqtt/config` | POST | ✅ `admin_mqtt_save_config` | `AdminPanel.tsx:2766` (nur GET) | 🔧 **Frontend ruft nur GET auf** |

---

## 13. Admin – Matter / Zigbee / Z-Wave / BLE / HomeKit

| Endpoint | Methode | Backend | Frontend | Status |
|----------|---------|---------|----------|--------|
| `/api/admin/matter/status` | GET | ✅ `admin_matter_status` | `AdminPanel.tsx:3027` | ✅ |
| `/api/admin/matter/config` | GET/POST | ✅ `admin_matter_get/save_config` | `AdminPanel.tsx:3047` (POST), GET? | ✅ |
| `/api/admin/matter/refresh` | POST | ✅ `admin_matter_refresh` | `AdminPanel.tsx:3072` | ✅ |
| `/api/admin/zigbee/status` | GET | ✅ `admin_zigbee_status` | `AdminPanel.tsx:3233` | ✅ |
| `/api/admin/zigbee/config` | GET/POST | ✅ `admin_zigbee_get/save_config` | `AdminPanel.tsx:3252` (POST) | ✅ |
| `/api/admin/zigbee/refresh` | POST | ✅ `admin_zigbee_refresh` | `AdminPanel.tsx:3277` | ✅ |
| `/api/admin/zwave/status` | GET | ✅ `admin_zwave_status` | `AdminPanel.tsx:3361` | ✅ |
| `/api/admin/zwave/config` | GET/POST | ✅ `admin_zwave_get/save_config` | `AdminPanel.tsx:3376` (POST) | ✅ |
| `/api/admin/zwave/refresh` | POST | ✅ `admin_zwave_refresh` | `AdminPanel.tsx:3400` | ✅ |
| `/api/admin/ble/status` | GET | ✅ `admin_ble_status` | `AdminPanel.tsx:3475` | ✅ |
| `/api/admin/ble/config` | GET/POST | ✅ `admin_ble_get/save_config` | `AdminPanel.tsx:3490` (POST) | ✅ |
| `/api/admin/ble/refresh` | POST | ✅ `admin_ble_refresh` | `AdminPanel.tsx:3514` | ✅ |
| `/api/admin/homekit/status` | GET | ✅ `admin_homekit_status` | `AdminPanel.tsx:3592` | ✅ |
| `/api/admin/homekit/config` | GET/POST | ✅ `admin_homekit_get/save_config` | `AdminPanel.tsx:3616` (POST) | ✅ |
| `/api/admin/homekit/refresh` | POST | ✅ `admin_homekit_refresh` | `AdminPanel.tsx:3639` | ✅ |
| `/api/admin/protocols/overview` | GET | ✅ `admin_protocols_overview` | `AdminPanel.tsx:6586` | ✅ |

---

## 14. Admin – Control Center

| Endpoint | Methode | Backend | Frontend | Status |
|----------|---------|---------|----------|--------|
| `/api/admin/control/services` | GET | ✅ `admin_control_services` | `AdminPanel.tsx:1476` | ✅ |
| `/api/admin/control/services/:name/restart` | POST | ✅ `admin_control_restart_service` | `AdminPanel.tsx:1492` | ✅ |
| `/api/admin/control/tasks` | GET | ✅ `admin_control_tasks` | `AdminPanel.tsx:1632` | ✅ |
| `/api/admin/control/tasks/:task_id/trigger` | POST | ✅ `admin_control_trigger_task` | `AdminPanel.tsx:1643` | ✅ |
| `/api/admin/control/tasks/:task_id/toggle` | POST | ✅ `admin_control_toggle_task` | `AdminPanel.tsx:1651` | ✅ |
| `/api/admin/control/mode` | GET | ✅ `admin_control_get_mode` | `AdminPanel.tsx:1808` | ✅ |
| `/api/admin/control/mode` | PUT | ✅ `admin_control_set_mode` | `AdminPanel.tsx:1820` | ✅ |
| `/api/admin/control/overview` | GET | ✅ `admin_control_overview` | - | ✅ |
| `/api/admin/iora-control/*path` | ALL | ✅ `admin_iora_control_proxy` | - | ✅ |

---

## 15. Admin – Maintenance & Notifications & Alerts

| Endpoint | Methode | Backend | Frontend | Status |
|----------|---------|---------|----------|--------|
| `/api/admin/maintenance` | GET/PUT | ✅ `admin_get/set_maintenance` | `AdminPanel.tsx:1960,1976,1989` | ✅ |
| `/api/admin/alert` | GET | ✅ `admin_get_alert` | `AdminPanel.tsx:6845` | ✅ |
| `/api/admin/alert` | PUT | ✅ `admin_set_alert` | `AdminPanel.tsx:6860` | ✅ |
| `/api/admin/alert` | DELETE | ✅ `admin_dismiss_alert` | `AdminPanel.tsx:6876` | ✅ |
| `/api/admin/notifications` | GET | ✅ `admin_list_notifications` | `AdminPanel.tsx:6972` | ✅ |
| `/api/admin/notifications` | DELETE | ✅ `admin_clear_notifications` | `AdminPanel.tsx:7004` | ✅ |
| `/api/admin/notifications/:notif_id/read` | PUT | ✅ `admin_mark_notification_read` | `AdminPanel.tsx:6985` | ✅ |
| `/api/admin/notifications/:notif_id` | DELETE | ✅ `admin_dismiss_notification` | `AdminPanel.tsx:6994` | ✅ |
| `/api/admin/system-notifications` | GET | ✅ `admin_list_system_notifications` | `AdminPanel.tsx:4414` | ✅ |
| `/api/admin/system-notifications/:notif_id/acknowledge` | PUT | ✅ `admin_acknowledge_system_notification` | `AdminPanel.tsx:4429` | ✅ |
| `/api/admin/system-notifications/:notif_id/resolve` | PUT | ✅ `admin_resolve_system_notification` | `AdminPanel.tsx:4436` | ✅ |
| `/api/admin/system-notifications/:notif_id` | DELETE | ✅ `admin_delete_system_notification` | `AdminPanel.tsx:4443` | ✅ |
| `/api/admin/system-notifications/clear-resolved` | DELETE | ✅ `admin_clear_resolved_system_notifications` | `AdminPanel.tsx:4450` | ✅ |
| `/api/admin/location-sync/status` | GET | ✅ `admin_get_sync_status` | `AdminPanel.tsx:4415` | ✅ |
| `/api/admin/location-sync/:entity_id/force-sync` | POST | ✅ `admin_force_sync_entity` | `AdminPanel.tsx:4457` | ✅ |
| `/api/admin/warnings/log` | GET | ✅ `admin_get_warning_log` | `AdminPanel.tsx:4730` | ✅ |
| `/api/admin/warnings/log` | DELETE | ✅ `admin_clear_warning_log` | `AdminPanel.tsx:4745` | ✅ |
| `/api/admin/nina/test-warning` | POST | ✅ `admin_send_test_warning` | `AdminPanel.tsx:4802` | ✅ |
| `/api/admin/webhooks` | GET | ✅ `admin_list_all_webhooks` | - | ✅ |

---

## 16. Admin – Logs & Metrics

| Endpoint | Methode | Backend | Frontend | Status |
|----------|---------|---------|----------|--------|
| `/api/admin/logs` | GET | ✅ `admin_get_logs` | `AdminPanel.tsx:3946` | ✅ |
| `/api/admin/logs/clear` | POST | ✅ `admin_clear_logs` | `AdminPanel.tsx:3985` | ✅ |
| `/api/admin/logs/live` | GET (SSE) | ✅ `admin_logs_live_sse` | `AdminPanel.tsx:3963` (EventSource) | ✅ |
| `/api/admin/metrics` | GET | ✅ `admin_get_metrics` | `AdminPanel.tsx:5362,5502` | ✅ |
| `/api/admin/metrics/live` | GET (SSE) | ✅ `admin_metrics_live_sse` | `AdminPanel.tsx:5370` (EventSource) | ✅ |
| `/api/admin/system/logs` | GET | ✅ `admin_system_logs` | - | ✅ |
| `/api/admin/system/database` | GET | ✅ `admin_database_info` | - | ✅ |
| `/api/admin/system/database/temp-users` | GET/POST | ✅ `admin_list_temp_users` / `admin_create_temp_user` | `AdminPanel.tsx:4170,4186` | ✅ |
| `/api/admin/system/database/temp-users/:user_id` | DELETE | ✅ `admin_revoke_temp_user` | `AdminPanel.tsx:4202` | ✅ |
| `/api/admin/dev-image` | GET | ✅ `admin_dev_image_info` | `AdminPanel.tsx:1231`, `AppStoreTab.tsx:95` | ✅ |

---

## 17. Integration API (HA Custom Component)

| Endpoint | Methode | Backend | Frontend | Status |
|----------|---------|---------|----------|--------|
| `/api/integration/status` | GET | ✅ `integration_status` | - | ✅ |
| `/api/integration/ha/configured` | GET | ✅ `integration_ha_configured` | `App.tsx:155`, `AdminPanel.tsx:568`, `NavigationMenu.tsx:51` | ✅ |
| `/api/integration/ha/test` | POST | ✅ `integration_ha_test_connection` | - | ✅ |
| `/api/integration/ha/reconnect` | POST | ✅ `integration_ha_reconnect` | - | ✅ |
| `/api/integration/command` | POST | ✅ `integration_command` | - | ✅ |
| `/api/integration/settings` | GET | ✅ `integration_get_settings` | - | ✅ |
| `/api/integration/settings` | POST | ✅ `integration_set_settings` | - | ✅ |
| `/api/integration/analytics/top` | GET | ✅ `integration_analytics_top` | `AdminPanel.tsx:6252` | ✅ |
| `/api/integration/analytics/entity/:entity_id` | GET | ✅ `integration_analytics_entity` | - | ✅ |
| `/api/integration/analytics/history` | GET | ✅ `integration_analytics_history` | - | ✅ |
| `/api/integration/health` | GET | ✅ `integration_health_report` | `AdminPanel.tsx:6251` | ✅ |
| `/api/integration/composite` | GET | ✅ `integration_composite_sensors` | - | ✅ |
| `/api/integration/composite` | POST | ✅ `integration_register_composite` | - | ✅ |
| `/api/integration/scenes` | GET | ✅ `integration_list_scenes` | - | ✅ |
| `/api/integration/scenes` | POST | ✅ `integration_create_scene` | - | ✅ |
| `/api/integration/scenes/:scene_id` | DELETE | ✅ `integration_delete_scene` | - | ✅ |
| `/api/integration/scenes/:scene_id/execute` | POST | ✅ `integration_execute_scene` | - | ✅ |
| `/api/integration/schedules` | GET | ✅ `integration_list_schedules` | `AdminPanel.tsx:5992` | ✅ |
| `/api/integration/schedules` | POST | ✅ `integration_create_schedule` | `AdminPanel.tsx:6006` | ✅ |
| `/api/integration/schedules/:schedule_id` | DELETE | ✅ `integration_cancel_schedule` | `AdminPanel.tsx:6020` | ✅ |
| `/api/integration/watchdogs` | GET | ✅ `integration_list_watchdogs` | `AdminPanel.tsx:5993` | ✅ |
| `/api/integration/watchdogs` | POST | ✅ `integration_create_watchdog` | `AdminPanel.tsx:6029` | ✅ |
| `/api/integration/watchdogs/:watchdog_id` | DELETE | ✅ `integration_delete_watchdog` | `AdminPanel.tsx:6043` | ✅ |
| `/api/integration/watchdogs/check` | POST | ✅ `integration_check_watchdogs` | `AdminPanel.tsx:6052` | ✅ |
| `/api/integration/device/delayed-action` | POST | ✅ `integration_delayed_action` | - | ✅ |
| `/api/integration/device/conditional-action` | POST | ✅ `integration_conditional_action` | - | ✅ |
| `/api/integration/device/group-action` | POST | ✅ `integration_group_action` | - | ✅ |

---

## 18. Convenience Endpoints

| Endpoint | Methode | Backend | Frontend | Status |
|----------|---------|---------|----------|--------|
| `/api/time` | GET | ✅ `get_current_time` | - | ✅ |
| `/api/lights` | GET | ✅ `get_all_lights` | - | ✅ |
| `/api/lights/:entity_id` | POST | ✅ `control_light` | - | ✅ |
| `/api/media_players` | GET | ✅ `get_all_media_players` | - | ✅ |
| `/api/media_players/:entity_id` | POST | ✅ `control_media_player` | - | ✅ |
| `/api/sensors/:entity_id` | GET | ✅ `get_sensor` | - | ✅ |
| `/api/buttons/:entity_id/press` | POST | ✅ `press_button` | - | ✅ |
| `/api/switches/:entity_id` | POST | ✅ `control_switch` | - | ✅ |

---

## 19. Calendar Endpoints

| Endpoint | Methode | Backend | Frontend | Status |
|----------|---------|---------|----------|--------|
| `/api/calendars` | GET | ✅ `get_calendars` | - | ✅ |
| `/api/calendars/:entity_id/events` | GET | ✅ `get_calendar_events` | - | ✅ |

---

## 20. NINA Warning Endpoints

| Endpoint | Methode | Backend | Frontend | Status |
|----------|---------|---------|----------|--------|
| `/api/nina/settings` | GET | ✅ `get_nina_settings` | - | ✅ |
| `/api/nina/settings` | POST | ✅ `save_nina_settings` | - | ✅ |
| `/api/nina/warnings` | GET | ✅ `get_nina_warnings` | - | ✅ |
| `/api/nina/regions` | GET | ✅ `get_nina_regions` | - | ✅ |

---

## 21. Notifications (User-facing)

| Endpoint | Methode | Backend | Frontend | Status |
|----------|---------|---------|----------|--------|
| `/api/notifications` | GET | ✅ `get_notifications` | `NotificationContext.tsx:61` | ✅ |
| `/api/notifications/send` | POST | ✅ `notification_send` | `IFrameWidget.tsx:194`, `NotificationContext.tsx:198` | ✅ |
| `/api/notifications/:notif_id/read` | PUT | ✅ `mark_notification_read` | `NotificationContext.tsx:161` | ✅ |
| `/api/notifications/:notif_id` | DELETE | ✅ `dismiss_notification` | `NotificationContext.tsx:172` | ✅ |
| `/api/notifications/channels` | GET/POST | ✅ `notification_channels_list/create` | - | ✅ |
| `/api/notifications/channels/:channel_id` | PUT/DELETE | ✅ `notification_channel_update/delete` | - | ✅ |
| `/api/alert/active` | GET | ✅ `get_active_alert` | `NotificationContext.tsx:62` | ✅ |
| `/api/warnings/active` | GET | ✅ `get_active_warnings` | - | ✅ |

---

## 22. Convenience / Sync

| Endpoint | Methode | Backend | Frontend | Status |
|----------|---------|---------|----------|--------|
| `/api/config/sync/changes` | GET | ✅ `get_sync_changes` | - | ✅ |

---

## 23. Desktop Gateway

| Endpoint | Methode | Backend | Frontend | Status |
|----------|---------|---------|----------|--------|
| `/api/desktop/extensions` | GET | ✅ `get_desktop_extensions` | - | ✅ |
| `/api/desktop/settings` | GET | ✅ `get_desktop_settings` | - | ✅ |
| `/api/desktop/settings` | POST | ✅ `update_desktop_settings` | - | ✅ |
| `/api/desktop/register` | POST | ✅ `register_desktop` | - | ✅ |
| `/api/desktop/metrics` | POST | ✅ `receive_metrics` | - | ✅ |
| `/api/desktop/entities` | GET | ✅ `get_entities` | - | ✅ |
| `/api/desktop/service/call` | POST | ✅ `call_service` (desktop) | - | ✅ |
| `/api/desktop/command/execute` | POST | ✅ `queue_command` | - | ✅ |
| `/api/desktop/commands` | GET | ✅ `get_pending_commands` | - | ✅ |
| `/api/desktop/commands/:id/ack` | POST | ✅ `ack_command` | - | ✅ |

---

## 24. Streaming

| Endpoint | Methode | Backend | Frontend | Status |
|----------|---------|---------|----------|--------|
| `/api/streams` | GET | ✅ `list_streams` | `StreamWidget.tsx:52`, `StreamSender.tsx:182` | ✅ |
| `/api/streams` | POST | ✅ `create_stream` | `StreamSender.tsx:182` | ✅ |
| `/api/streams/:stream_id` | GET | ✅ `get_stream` | - | ✅ |
| `/api/streams/:stream_id` | PUT | ✅ `update_stream` | - | ✅ |
| `/api/streams/:stream_id` | DELETE | ✅ `stop_stream` | `StreamSender.tsx:469` | ✅ |
| `/api/streams/:stream_id/snapshot` | GET | ✅ `get_stream_snapshot` | `StreamSender.tsx:447` | ✅ |
| `/api/streams/:stream_id/snapshot` | POST | ✅ `post_stream_snapshot` | - | ✅ |
| `/api/streams/sender` | GET | ✅ `stream_sender_page` | - | ✅ |
| `/ws/stream/ingest` | WS | ✅ `stream_ingest_handler` | - | ✅ |
| `/ws/stream/watch` | WS | ✅ `stream_watch_handler` | - | ✅ |

---

## 25. Realtime / SSE / WebSocket

| Endpoint | Methode | Backend | Frontend | Status |
|----------|---------|---------|----------|--------|
| `/ws` | WS | ✅ `websocket_handler` | - | ✅ |
| `/ws/realtime` | WS | ✅ `realtime_ws_handler` | - | ✅ |
| `/api/events/stream` | GET (SSE) | ✅ `sse_event_stream` | `AdminPanel.tsx:5394` (EventSource) | ✅ |
| `/api/events/system` | GET (SSE) | ✅ `sse_system_stream` | - | ✅ |

---

## 26. Documentation

| Endpoint | Methode | Backend | Frontend | Status |
|----------|---------|---------|----------|--------|
| `/api/documentation/config` | GET | ✅ `get_docs_config` | `DocsPageNew.tsx:61` | ✅ |
| `/api/documentation/list` | GET | ✅ `list_docs` | - | ✅ |
| `/api/documentation/*doc_path` | GET | ✅ `get_doc_file` | `DocsPageNew.tsx:93` | ✅ |
| `/api/docs` | GET | Redirect → Swagger UI | - | ✅ |
| `/api/docs/openapi.json` | GET | Swagger UI OpenAPI spec | - | ✅ |

---

## 27. Media Proxy

| Endpoint | Methode | Backend | Frontend | Status |
|----------|---------|---------|----------|--------|
| `/api/hass_agent/*path` | GET | ✅ `proxy_hass_agent_media` | - | ✅ |
| `/api/image/serve/*path` | GET | ✅ `proxy_image_serve_media` | - | ✅ |

---

## 28. App Store (Supervisor) – Stubs / Teilweise

| Endpoint | Methode | Backend | Frontend | Status |
|----------|---------|---------|----------|--------|
| `/api/supervisor/system/info` | GET | ✅ `proxy_supervisor` → iora-supervisor:8097 | - | ✅ Proxy |
| `/api/supervisor/apps` | GET | ✅ `supervisor_apps_list` | `AppStoreTab.tsx:121` | ✅ |
| `/api/supervisor/apps/install` | POST | ✅ `supervisor_apps_install` | - | ✅ |
| `/api/supervisor/apps/:app_id` | GET | ✅ `supervisor_apps_get` | - | ✅ |
| `/api/supervisor/apps/:app_id` | DELETE | ✅ `supervisor_apps_uninstall` | - | ✅ |
| `/api/supervisor/apps/:app_id` | PUT | ❌ entfernt (Frontend ruft nicht auf) | - | — |
| `/api/supervisor/apps/:app_id/start` | POST | ✅ `supervisor_apps_start` | `AppStoreTab.tsx:299`, `AppDetailDialog.tsx:137` | ✅ |
| `/api/supervisor/apps/:app_id/stop` | POST | ✅ `supervisor_apps_stop` | `AppStoreTab.tsx:311`, `AppDetailDialog.tsx:151` | ✅ |
| `/api/supervisor/apps/:app_id/restart` | POST | ✅ `supervisor_apps_restart` | - | ✅ |
| `/api/supervisor/apps/:app_id/compose` | GET | ✅ `supervisor_apps_compose` | - | ✅ |
| `/api/supervisor/apps/:app_id/bundle/start` | POST | ✅ `supervisor_bundle_start` | `AppDetailDialog.tsx:179` | ✅ |
| `/api/supervisor/apps/:app_id/bundle/stop` | POST | ✅ `supervisor_bundle_stop` | `AppDetailDialog.tsx:191` | ✅ |
| `/api/supervisor/apps/:app_id/bundle/restart` | POST | ✅ `supervisor_bundle_restart` | - | ✅ |
| `/api/supervisor/apps/:app_id/bundle/status` | GET | ✅ `supervisor_bundle_status` | - | ✅ |

---

## 29. Local App Store & Plugin Management

| Endpoint | Methode | Backend | Frontend | Status |
|----------|---------|---------|----------|--------|
| `/api/appstore/installed` | GET | ✅ `local_appstore_installed` | `AppStoreTab.tsx:124,128`, `AppSettingsPage.tsx:173` | ✅ |
| `/api/appstore/search` | GET | ✅ `proxy_appstore` → iora-appstore:8098 | - | ✅ Proxy |
| `/api/appstore/install` | POST | ✅ `local_appstore_install` | `AppStoreTab.tsx:645` | ✅ |
| `/api/appstore/jobs` | GET | ✅ `local_appstore_jobs` | `AppStoreTab.tsx:823` | ✅ |
| `/api/appstore/jobs/stream` | GET | ✅ `local_appstore_jobs_stream` | - | ✅ |
| `/api/appstore/apps/:app_id` | GET | ✅ `local_appstore_app_get` | - | ✅ |
| `/api/appstore/apps/:app_id` | DELETE | ✅ `local_appstore_app_delete` | - | ✅ |
| `/api/appstore/apps/:app_id/enable` | POST | ✅ `local_appstore_app_enable` | `AppStoreTab.tsx:323` | ✅ |
| `/api/appstore/apps/:app_id/disable` | POST | ✅ `local_appstore_app_disable` | `AppStoreTab.tsx:335` | ✅ |
| `/api/appstore/apps/:app_id/settings` | GET/POST | ✅ `proxy_appstore` → iora-appstore:8098 | - | ✅ Proxy |
| `/api/appstore/permissions/grant` | POST | ✅ `proxy_appstore` → iora-appstore:8098 | - | ✅ Proxy |
| `/api/appstore/settings` | POST | ✅ `proxy_appstore` → iora-appstore:8098 | - | ✅ Proxy |
| `/api/local-store/register` | POST | ✅ `local_store_register` | - | ✅ |

---

## 30. Core Plugins (Stubs)

| Endpoint | Methode | Backend | Frontend | Status |
|----------|---------|---------|----------|--------|
| `/api/core/plugins` | GET | ✅ `core_plugins_list` | - | ✅ |
| `/api/core/plugins/with-stats` | GET | ✅ `core_plugins_list` | - | ✅ |
| `/api/core/plugins/:id` | GET | ✅ `core_plugins_get` | - | ✅ |
| `/api/core/plugins/:id` | POST | ❌ entfernt (Frontend ruft nicht auf) | - | — |
| `/api/core/plugins/:id` | DELETE | ✅ `core_plugins_uninstall` | - | ✅ |
| `/api/core/plugins/:id/enable` | POST | ✅ `core_plugins_enable` | - | ✅ |
| `/api/core/plugins/:id/disable` | POST | ✅ `core_plugins_disable` | - | ✅ |
| `/api/core/plugins/:id/execute` | POST | ✅ `core_plugins_execute` | - | ✅ |
| `/api/core/plugins/:id/logs` | GET | ✅ `core_plugins_logs` | - | ✅ |
| `/api/core/sandbox/status` | GET | ✅ `core_sandbox_status` | - | ✅ |
| `/api/core/registrations` | GET | ✅ `core_registrations_list` (PG `service_registrations`) | `AdminPanelPhase2.tsx:34` | ✅ |
| `/api/core/registrations/:id/approve` | POST | ✅ `core_registrations_approve` | `AdminPanelPhase2.tsx:45` | ✅ |
| `/api/core/registrations/:id/reject` | POST | ✅ `core_registrations_reject` | `AdminPanelPhase2.tsx:54` | ✅ |
| `/api/core/registrations/:id/suspend` | POST | ✅ `core_registrations_suspend` | `AdminPanelPhase2.tsx:63` | ✅ |
| `/api/core/registrations/:id/revoke` | POST | ✅ `core_registrations_revoke` | `AdminPanelPhase2.tsx:73` | ✅ |
| `/api/core/security/events` | GET | ✅ `proxy_core_security` → iora-security:8095 `/api/security/events` | - | ✅ Proxy |
| `/api/core/security/alerts` | GET | ✅ `proxy_core_security` → iora-security:8095 `/api/security/alerts` | - | ✅ Proxy |
| `/api/core/security/resource-usage` | GET | ✅ `proxy_core_security` → iora-security:8095 `/api/security/resource-usage` (Linux: /proc + statvfs) | - | ✅ |
| `/api/core/updates/check` | GET/POST | ✅ `core_updates_check` (HTTP zu IORA_UPDATE_SERVER, Default `update.kaimdt.com`) | `AdminPanelPhase2.tsx:436,467` | ✅ |
| `/api/core/updates/history` | GET | ✅ `core_updates_history` (PG `update_history`) | `AdminPanelPhase2.tsx:437` | ✅ |
| `/api/core/updates/:provider_id/install` | POST | ✅ `core_updates_install` (spawn `iora-updater --yes`) | `AdminPanelPhase2.tsx:450` | ✅ |
| `/api/core/updates/:update_id/rollback` | POST | ✅ `core_updates_rollback` | `AdminPanelPhase2.tsx:459` | ✅ |
| `/api/core/widgets` | GET | ✅ `proxy_core` → iora-core:8090 | - | ✅ Proxy |

---

## 31. Plugin Sandbox

| Endpoint | Methode | Backend | Frontend | Status |
|----------|---------|---------|----------|--------|
| `/api/plugins` | GET | ✅ `plugins_list` | - | ✅ |
| `/api/plugins` | POST | ✅ `plugins_register` | - | ✅ |
| `/api/plugins/:plugin_id` | DELETE | ✅ `plugins_unregister` | - | ✅ |
| `/api/plugins/:plugin_id/execute` | POST | ✅ `plugins_execute` | - | ✅ |

---

## 32. App Pages & Proxy

| Endpoint | Methode | Backend | Frontend | Status |
|----------|---------|---------|----------|--------|
| `/api/apps/pages` | GET | ✅ `app_pages_list` | - | ✅ |
| `/api/apps/status/stream` | GET | ✅ `apps_status_stream` | - | ✅ |
| `/api/apps/:app_id/proxy/*path` | GET | ✅ `app_proxy_handler` | - | ✅ |
| `/api/apps/:app_id/logs` | GET | ✅ `app_logs_get` | - | ✅ |
| `/api/apps/:app_id/logs/stream` | GET | ✅ `app_logs_stream` | - | ✅ |
| `/api/apps/:app_id/detail` | GET | ✅ `app_detail_get` | `AppSettingsPage.tsx:168`, `AppDetailDialog.tsx:91` | ✅ |
| `/api/apps/:app_id/config/schema` | GET | ✅ `app_config_schema` | `AppSettingsPage.tsx:286` | ✅ |
| `/api/apps/:app_id/config` | GET | ✅ `app_config_get` | `AppSettingsPage.tsx:287` | ✅ |
| `/api/apps/:app_id/config` | PUT | ✅ `app_config_put` | `AppSettingsPage.tsx:338` | ✅ |
| `/api/apps/:app_id/config/:key` | DELETE | ✅ `app_config_delete_key` | `AppSettingsPage.tsx:354` | ✅ |

---

## 33. App Storage (v2.1)

| Endpoint | Methode | Backend | Frontend | Status |
|----------|---------|---------|----------|--------|
| `/api/apps/:app_id/storage/files` | GET | ✅ `list_files` | `AppSettingsPage.tsx:495` | ✅ |
| `/api/apps/:app_id/storage/files` | POST | ✅ `upload_file` | - | ✅ |
| `/api/apps/:app_id/storage/files/:file_id` | GET | ✅ `get_file` | - | ✅ |
| `/api/apps/:app_id/storage/files/:file_id` | DELETE | ✅ `delete_file` | - | ✅ |
| `/api/apps/:app_id/storage/kv` | GET | ✅ `list_kv` | `AppSettingsPage.tsx:502` | ✅ |
| `/api/apps/:app_id/storage/kv/:key` | GET | ✅ `get_kv` | - | ✅ |
| `/api/apps/:app_id/storage/kv/:key` | PUT | ✅ `set_kv` | - | ✅ |
| `/api/apps/:app_id/storage/kv/:key` | DELETE | ✅ `delete_kv` | - | ✅ |
| `/api/apps/:app_id/storage/usage` | GET | ✅ `get_storage_usage` | - | ✅ |

---

## 34. App Database (v2.1)

| Endpoint | Methode | Backend | Frontend | Status |
|----------|---------|---------|----------|--------|
| `/api/apps/:app_id/database/provision` | POST | ✅ `provision_database` | - | ✅ |
| `/api/apps/:app_id/database` | DELETE | ✅ `drop_database` | - | ✅ |
| `/api/apps/:app_id/database/status` | GET | ✅ `database_status` | - | ✅ |
| `/api/apps/:app_id/database/tables` | GET | ✅ `list_tables` | `AppSettingsPage.tsx:588` | ✅ |
| `/api/apps/:app_id/database/execute` | POST | ✅ `execute_sql` | - | ✅ |
| `/api/apps/:app_id/database/backup` | POST | ✅ `backup_database` | - | ✅ |
| `/api/apps/:app_id/database/backups` | GET | ✅ `list_backups` | - | ✅ |

---

## 35. App Scheduler (v2.1)

| Endpoint | Methode | Backend | Frontend | Status |
|----------|---------|---------|----------|--------|
| `/api/apps/:app_id/schedules` | GET | ✅ `list_schedules` | `AppSettingsPage.tsx:627` | ✅ |
| `/api/apps/:app_id/schedules` | POST | ✅ `create_schedule` | - | ✅ |
| `/api/apps/:app_id/schedules/:task_id` | GET | ✅ `get_schedule` | - | ✅ |
| `/api/apps/:app_id/schedules/:task_id` | PUT | ✅ `update_schedule` | - | ✅ |
| `/api/apps/:app_id/schedules/:task_id` | DELETE | ✅ `delete_schedule` | - | ✅ |
| `/api/apps/:app_id/schedules/:task_id/trigger` | POST | ✅ `trigger_schedule` | - | ✅ |
| `/api/apps/:app_id/schedules/:task_id/logs` | GET | ✅ `get_task_logs` | - | ✅ |

---

## 36. App Webhooks (v2.1)

| Endpoint | Methode | Backend | Frontend | Status |
|----------|---------|---------|----------|--------|
| `/api/apps/:app_id/webhooks` | GET | ✅ `list_webhooks` | `AppSettingsPage.tsx:673` | ✅ |
| `/api/apps/:app_id/webhooks` | POST | ✅ `create_webhook` | - | ✅ |
| `/api/apps/:app_id/webhooks/:hook_id` | GET | ✅ `get_webhook` | - | ✅ |
| `/api/apps/:app_id/webhooks/:hook_id` | PUT | ✅ `update_webhook` | - | ✅ |
| `/api/apps/:app_id/webhooks/:hook_id` | DELETE | ✅ `delete_webhook` | - | ✅ |
| `/api/apps/:app_id/webhooks/:hook_id/test` | POST | ✅ `test_webhook` | - | ✅ |
| `/api/apps/:app_id/webhooks/:hook_id/logs` | GET | ✅ `get_webhook_logs` | - | ✅ |
| `/api/apps/:app_id/webhooks/:hook_id/stats` | GET | ✅ `get_webhook_stats` | - | ✅ |

---

## 37. App Messaging (v2.1)

| Endpoint | Methode | Backend | Frontend | Status |
|----------|---------|---------|----------|--------|
| `/api/apps/messaging/channels` | GET | ✅ `list_channels` | - | ✅ |
| `/api/apps/messaging/channels` | POST | ✅ `register_channel` | - | ✅ |
| `/api/apps/:app_id/messaging/channels` | GET | ✅ `list_channels` | `AppSettingsPage.tsx:719` | ✅ |
| `/api/apps/messaging/publish` | POST | ✅ `publish_message` | - | ✅ |
| `/api/apps/messaging/events` | GET | ✅ `message_stream` | - | ✅ |
| `/api/apps/:app_id/messaging/subscribe` | POST | ✅ `subscribe` | - | ✅ |
| `/api/apps/:app_id/messaging/subscriptions` | GET | ✅ `list_subscriptions` | - | ✅ |
| `/api/apps/:app_id/messaging/subscriptions/:sub_id` | DELETE | ✅ `unsubscribe` | - | ✅ |
| `/api/apps/:app_id/messaging/direct` | POST | ✅ `send_direct_message` | - | ✅ |
| `/api/apps/:app_id/messaging/inbox` | GET | ✅ `get_inbox` | - | ✅ |
| `/api/apps/:app_id/messaging/inbox/:msg_id/read` | POST | ✅ `mark_message_read` | - | ✅ |

---

## 38. Intelligence (Stubs)

| Endpoint | Methode | Backend | Frontend | Status |
|----------|---------|---------|----------|--------|
| `/api/intelligence/overview` | GET | ✅ `proxy_intelligence_overview` (echter Proxy) | `AdminPanel.tsx:9501` | ✅ |
| `/api/intelligence/maintenance/run/:task` | GET | ✅ `proxy_intelligence_maintenance_run` (echter Proxy) | `AdminPanel.tsx:9512` | ✅ |

---

## 39. AI Assist – Core (iora-assist 🧩, Port 8092)

> Alle `/api/assist/*` Endpoints werden vom **iora-assist** Microservice bereitgestellt.
> Das Frontend routet diese via `adminFetch` (`baseUrlFor(path)` → `getAssistUrl()`) automatisch zur ASSIST_URL.

| Endpoint | Methode | Backend (iora-assist) | Frontend | Status |
|----------|---------|----------------------|----------|--------|
| `/health` | GET | ✅ `health` | - | 🧩 ✅ |
| `/api/assist/chat` | POST | ✅ `chat` | `ORAAssistant.tsx`, `AgentTab.tsx` | 🧩 ✅ |
| `/api/assist/chat/stream` | POST | ✅ `chat_stream` (SSE) | `AgentTab.tsx` | 🧩 ✅ |
| `/api/assist/history` | GET | ✅ `chat_history` | `ORAAssistant.tsx` | 🧩 ✅ |
| `/api/assist/history/clear` | POST | ✅ `clear_history` | `ORAAssistant.tsx` | 🧩 ✅ |
| `/api/assist/suggestions` | GET | ✅ `suggestions` | - | 🧩 ✅ |
| `/api/assist/automate` | POST | ✅ `create_automation` | - | 🧩 ✅ |
| `/api/assist/insights` | GET | ✅ `insights` | - | 🧩 ✅ |
| `/api/assist/voice/transcribe` | POST | ✅ `transcribe_audio` | - | 🧩 ✅ |
| `/api/assist/voice/synthesize` | POST | ✅ `synthesize_speech` | - | 🧩 ✅ |
| `/api/assist/entities/discover` | GET | ✅ `discover_entities` | - | 🧩 ✅ |
| `/api/assist/automations/suggestions` | GET | ✅ `get_automation_suggestions` | - | 🧩 ✅ |
| `/api/assist/context` | GET | ✅ `get_smart_home_context` | - | 🧩 ✅ |
| `/api/assist/video/analyze` | POST | ✅ `analyze_video` | - | 🧩 ✅ |
| `/api/assist/notifications/stream` | GET (SSE) | ✅ `notification_stream` | - | 🧩 ✅ |
| `/api/assist/config/notifications` | GET | ✅ `list_pending_notifications` | `AgentTab.tsx` | 🧩 ✅ |
| `/api/assist/config/notifications/send` | POST | ✅ `send_notification` | - | 🧩 ✅ |
| `/api/assist/config/threads` | GET | ✅ `list_conversation_threads` | `AgentTab.tsx` | 🧩 ✅ |
| `/api/assist/config/threads` | POST | ✅ `create_conversation_thread` | `AgentTab.tsx` | 🧩 ✅ |
| `/api/assist/config/tasks` | GET | ✅ `list_autonomous_tasks` | - | 🧩 ✅ |
| `/api/assist/config/stats` | GET | ✅ `get_orchestrator_stats` | `AgentTab.tsx` | 🧩 ✅ |

---

## 40. AI Assist – Providers & Model Registry (iora-assist 🧩) **NEU**

| Endpoint | Methode | Backend (iora-assist) | Frontend | Status |
|----------|---------|----------------------|----------|--------|
| `/api/assist/providers` | GET | ✅ `get_providers` | `AdminPanel.tsx (AI tab)`, `AgentTab.tsx` | 🧩 ✅ |
| `/api/assist/providers/switch` | POST | ✅ `switch_provider` | `AdminPanel.tsx` | 🧩 ✅ |
| `/api/assist/config/providers` | GET | ✅ `list_provider_configs` | `AdminPanel.tsx` | 🧩 ✅ |
| `/api/assist/config/providers` | POST | ✅ `create_provider_config` | `AdminPanel.tsx` | 🧩 ✅ |
| `/api/assist/config/providers/:id` | PATCH | ✅ `update_provider_config` | `AdminPanel.tsx` | 🧩 ✅ NEU |
| `/api/assist/config/providers/:id` | DELETE | ✅ `delete_provider_config` | `AdminPanel.tsx` | 🧩 ✅ NEU |
| `/api/assist/config/providers/:id/refresh-models` | POST | ✅ `refresh_provider_models` | `AdminPanel.tsx` | 🧩 ✅ NEU |
| `/api/assist/models` | GET | ✅ `list_global_models` | `AgentTab.tsx`, `AdminPanel.tsx` | 🧩 ✅ NEU |
| `/api/assist/models/refresh` | POST | ✅ `refresh_all_models` | `AdminPanel.tsx` | 🧩 ✅ NEU |
| `/v1/chat/completions` | POST | ✅ `openai_chat_completions` (OpenAI-kompatibel) | externe Clients | 🧩 ✅ |
| `/v1/models` | GET | ✅ `list_available_models` (OpenAI-kompatibel) | externe Clients | 🧩 ✅ |

---

## 41. AI Assist – Tools, Memory & Cost (iora-assist 🧩)

| Endpoint | Methode | Backend (iora-assist) | Frontend | Status |
|----------|---------|----------------------|----------|--------|
| `/api/assist/tools/execute` | POST | ✅ `execute_tool` | - | 🧩 ✅ |
| `/api/assist/tools/search` | POST | ✅ `search_internet` | - | 🧩 ✅ |
| `/api/assist/tools/scrape` | POST | ✅ `scrape_webpage` | - | 🧩 ✅ |
| `/api/assist/tools/screenshot` | POST | ✅ `take_webpage_screenshot` | - | 🧩 ✅ |
| `/api/assist/memory` | GET | ✅ `list_memories` | - | 🧩 ✅ |
| `/api/assist/memory` | POST | ✅ `create_memory` | - | 🧩 ✅ |
| `/api/assist/memory/search` | POST | ✅ `search_memories` | - | 🧩 ✅ |
| `/api/assist/memory/:id` | DELETE | ✅ `delete_memory` | - | 🧩 ✅ |
| `/api/assist/cost/summary` | GET | ✅ `cost_summary` | `AgentTab.tsx` | 🧩 ✅ |
| `/api/assist/cost/config` | GET | ✅ `cost_config_get` | - | 🧩 ✅ |
| `/api/assist/cost/config` | PUT | ✅ `cost_config_update` | - | 🧩 ✅ |
| `/api/assist/cost/records/clear` | POST | ✅ `cost_records_clear` | - | 🧩 ✅ |
| `/api/assist/cost/cache/clear` | POST | ✅ `cost_cache_clear` | - | 🧩 ✅ |
| `/api/assist/cost/mode` | GET | ✅ `cost_mode_get` | - | 🧩 ✅ |
| `/api/assist/cost/mode` | PUT | ✅ `cost_mode_set` | - | 🧩 ✅ |

---

## 42. AI Assist – Tasks, Evolution & Subagents (iora-assist 🧩)

| Endpoint | Methode | Backend (iora-assist) | Frontend | Status |
|----------|---------|----------------------|----------|--------|
| `/api/assist/tasks/active` | GET | ✅ `list_active_tasks` | `ActiveTasksPanel.tsx` | 🧩 ✅ |
| `/api/assist/tasks/active` | POST | ✅ `create_active_task` | `ActiveTasksPanel.tsx` | 🧩 ✅ |
| `/api/assist/tasks/active/:id` | PATCH | ✅ `update_active_task` | `ActiveTasksPanel.tsx` | 🧩 ✅ |
| `/api/assist/tasks/active/:id` | DELETE | ✅ `delete_active_task` | `ActiveTasksPanel.tsx` | 🧩 ✅ |
| `/api/assist/tasks/detect` | POST | ✅ `detect_tasks_from_conversation` | - | 🧩 ✅ |
| `/api/assist/tasks/confirm` | POST | ✅ `confirm_task_action` | - | 🧩 ✅ |
| `/api/assist/tasks/instant/:id` | GET | ✅ `get_instant_task` | - | 🧩 ✅ |
| `/api/assist/tasks/instant/:id/stream` | GET (SSE) | ✅ `stream_instant_task` | - | 🧩 ✅ |
| `/api/assist/agent/tasks` | GET | ✅ `list_agent_tasks` | `AgentTab.tsx` | 🧩 ✅ |
| `/api/assist/agent/tasks` | POST | ✅ `create_agent_task` | `AgentTab.tsx` | 🧩 ✅ |
| `/api/assist/agent/tasks/:id` | GET | ✅ `get_agent_task` | `AgentTab.tsx` | 🧩 ✅ |
| `/api/assist/agent/tasks/:id` | DELETE | ✅ `cancel_agent_task` | `AgentTab.tsx` | 🧩 ✅ |
| `/api/assist/agent/tasks/events` | GET (SSE) | ✅ `stream_agent_task_events` | `AgentTab.tsx` | 🧩 ✅ |
| `/api/assist/agent/stats` | GET | ✅ `agent_task_stats` | `AgentTab.tsx` | 🧩 ✅ |
| `/api/assist/evolution/cycle` | POST | ✅ `trigger_evolution_cycle` | - | 🧩 ✅ |
| `/api/assist/evolution/proposals` | GET | ✅ `list_evolution_proposals` | - | 🧩 ✅ |
| `/api/assist/evolution/knowledge` | GET | ✅ `search_knowledge` | - | 🧩 ✅ |
| `/api/assist/evolution/knowledge` | POST | ✅ `store_knowledge` | - | 🧩 ✅ |
| `/api/assist/evolution/status` | GET | ✅ `get_evolution_status` | - | 🧩 ✅ |
| `/api/assist/subagents/spawn` | POST | ✅ `subagent_spawn` | - | 🧩 ✅ |
| `/api/assist/subagents/list` | GET | ✅ `subagent_list` | - | 🧩 ✅ |
| `/api/assist/subagents/stats` | GET | ✅ `subagent_stats` | - | 🧩 ✅ |
| `/api/assist/subagents/delegate` | POST | ✅ `subagent_delegate` | - | 🧩 ✅ |
| `/api/assist/subagents/delegate/auto` | POST | ✅ `subagent_delegate_auto` | - | 🧩 ✅ |
| `/api/assist/subagents/:id` | GET | ✅ `subagent_get` | - | 🧩 ✅ |
| `/api/assist/subagents/:id` | DELETE | ✅ `subagent_terminate` | - | 🧩 ✅ |
| `/api/assist/subagents/:id/events` | GET (SSE) | ✅ `subagent_event_stream` | - | 🧩 ✅ |
| `/api/assist/subagents/terminate-all` | POST | ✅ `subagent_terminate_all` | - | 🧩 ✅ |
| `/api/assist/subagents/events` | GET (SSE) | ✅ `subagent_pool_event_stream` | - | 🧩 ✅ |

---

## 43. AI Assist – Workspaces & Git (iora-assist 🧩)

| Endpoint | Methode | Backend (iora-assist) | Frontend | Status |
|----------|---------|----------------------|----------|--------|
| `/api/assist/workspaces` | GET | ✅ `list_workspaces` | `AgentTab.tsx` | 🧩 ✅ |
| `/api/assist/workspaces` | POST | ✅ `create_workspace` | `AgentTab.tsx` | 🧩 ✅ |
| `/api/assist/workspaces/:id` | GET | ✅ `get_workspace` | `AgentTab.tsx` | 🧩 ✅ |
| `/api/assist/workspaces/:id` | DELETE | ✅ `delete_workspace` | `AgentTab.tsx` | 🧩 ✅ |
| `/api/assist/workspaces/:id/files` | GET | ✅ `list_workspace_files` | `AgentTab.tsx` | 🧩 ✅ |
| `/api/assist/workspaces/:ws_id/files/*file_path` | GET | ✅ `read_workspace_file` | `AgentTab.tsx` | 🧩 ✅ |
| `/api/assist/workspaces/:ws_id/files/*file_path` | PUT | ✅ `write_workspace_file` | `AgentTab.tsx` | 🧩 ✅ |
| `/api/assist/workspaces/:id/git/status` | GET | ✅ `workspace_git_status` | `AgentTab.tsx` | 🧩 ✅ |
| `/api/assist/workspaces/:id/git/commit` | POST | ✅ `workspace_git_commit` | `AgentTab.tsx` | 🧩 ✅ |
| `/api/assist/workspaces/:id/git/push` | POST | ✅ `workspace_git_push` | `AgentTab.tsx` | 🧩 ✅ |
| `/api/assist/workspaces/:id/git/branch` | POST | ✅ `workspace_git_create_branch` | `AgentTab.tsx` | 🧩 ✅ |
| `/api/assist/workspaces/:id/git/pr` | POST | ✅ `workspace_create_pr` | `AgentTab.tsx` | 🧩 ✅ |
| `/api/assist/workspaces/:id/git/log` | GET | ✅ `workspace_git_log` | - | 🧩 ✅ |
| `/api/assist/workspaces/:id/git/branches` | GET | ✅ `workspace_git_branches` | - | 🧩 ✅ |
| `/api/assist/workspaces/:id/git/checkout` | POST | ✅ `workspace_git_checkout` | - | 🧩 ✅ |
| `/api/assist/workspaces/:id/git/delete-branch` | POST | ✅ `workspace_git_delete_branch` | - | 🧩 ✅ |
| `/api/assist/workspaces/:id/git/stash` | POST | ✅ `workspace_git_stash` | - | 🧩 ✅ |
| `/api/assist/workspaces/:id/git/stash-pop` | POST | ✅ `workspace_git_stash_pop` | - | 🧩 ✅ |
| `/api/assist/workspaces/:id/git/stash-list` | GET | ✅ `workspace_git_stash_list` | - | 🧩 ✅ |
| `/api/assist/workspaces/:id/git/reset` | POST | ✅ `workspace_git_reset` | - | 🧩 ✅ |
| `/api/assist/workspaces/:id/git/revert` | POST | ✅ `workspace_git_revert` | - | 🧩 ✅ |
| `/api/assist/workspaces/:id/git/merge` | POST | ✅ `workspace_git_merge` | - | 🧩 ✅ |
| `/api/assist/workspaces/:id/git/rebase` | POST | ✅ `workspace_git_rebase` | - | 🧩 ✅ |
| `/api/assist/workspaces/:id/git/blame` | POST | ✅ `workspace_git_blame` | - | 🧩 ✅ |
| `/api/assist/workspaces/:id/git/fetch` | POST | ✅ `workspace_git_fetch` | - | 🧩 ✅ |
| `/api/assist/workspaces/:id/git/diff-between` | POST | ✅ `workspace_git_diff_between` | - | 🧩 ✅ |

---

## 44. AI Assist – LSP & ACP (iora-assist 🧩)

| Endpoint | Methode | Backend (iora-assist) | Frontend | Status |
|----------|---------|----------------------|----------|--------|
| `/api/assist/lsp/servers` | GET | ✅ `lsp_available_servers` | - | 🧩 ✅ |
| `/api/assist/lsp/workspaces/:id/start` | POST | ✅ `lsp_start_for_workspace` | - | 🧩 ✅ |
| `/api/assist/lsp/workspaces/:id/diagnostics` | GET | ✅ `lsp_workspace_diagnostics` | - | 🧩 ✅ |
| `/api/assist/lsp/diagnostics` | GET | ✅ `lsp_all_diagnostics` | - | 🧩 ✅ |
| `/api/assist/lsp/shutdown` | POST | ✅ `lsp_shutdown` | - | 🧩 ✅ |
| `/api/assist/acp/agents` | GET | ✅ `acp_list_agents` | - | 🧩 ✅ |
| `/api/assist/acp/agents/discover` | POST | ✅ `acp_discover_agents` | - | 🧩 ✅ |
| `/api/assist/acp/message` | POST | ✅ `acp_send_message` | - | 🧩 ✅ |
| `/api/assist/acp/broadcast` | POST | ✅ `acp_broadcast` | - | 🧩 ✅ |
| `/api/assist/acp/events` | GET (SSE) | ✅ `acp_event_stream` | - | 🧩 ✅ |

---

## 45. AI Assist – GitHub Integration (iora-assist 🧩) **NEU**

| Endpoint | Methode | Backend (iora-assist) | Frontend | Status |
|----------|---------|----------------------|----------|--------|
| `/api/assist/github/auth` | GET | ✅ `github_auth_status` | `AgentTab.tsx`, `AdminPanel.tsx` | 🧩 ✅ NEU |
| `/api/assist/github/auth` | POST | ✅ `github_auth_set` (PAT speichern) | `AgentTab.tsx`, `AdminPanel.tsx` | 🧩 ✅ NEU |
| `/api/assist/github/auth` | DELETE | ✅ `github_auth_delete` | `AgentTab.tsx`, `AdminPanel.tsx` | 🧩 ✅ NEU |
| `/api/assist/github/repos` | GET | ✅ `github_list_repos` | `AgentTab.tsx` | 🧩 ✅ |
| `/api/assist/github/repos/suggest` | GET | ✅ `github_suggest_targets` | `AgentTab.tsx` | 🧩 ✅ |
| `/api/assist/github/repos/search` | GET | ✅ `github_search_repos` | - | 🧩 ✅ |
| `/api/assist/github/repos/:owner/:repo` | GET | ✅ `github_get_repo` | - | 🧩 ✅ |
| `/api/assist/github/repos/:owner/:repo/branches` | GET | ✅ `github_list_branches` | `AgentTab.tsx` | 🧩 ✅ |
| `/api/assist/github/repos/:owner/:repo/branches/create` | POST | ✅ `github_create_branch` | - | 🧩 ✅ |
| `/api/assist/github/repos/:owner/:repo/branches/:branch` | GET | ✅ `github_get_branch` | - | 🧩 ✅ |
| `/api/assist/github/repos/:owner/:repo/branches/:branch` | DELETE | ✅ `github_delete_branch` | - | 🧩 ✅ |
| `/api/assist/github/repos/:owner/:repo/issues` | GET | ✅ `github_list_issues` | `AgentTab.tsx` | 🧩 ✅ |
| `/api/assist/github/repos/:owner/:repo/issues` | POST | ✅ `github_create_issue` | - | 🧩 ✅ |
| `/api/assist/github/repos/:owner/:repo/issues/:number` | GET | ✅ `github_get_issue` | - | 🧩 ✅ |
| `/api/assist/github/repos/:owner/:repo/issues/:number` | PATCH | ✅ `github_update_issue` | - | 🧩 ✅ |
| `/api/assist/github/repos/:owner/:repo/issues/:number/close` | POST | ✅ `github_close_issue` | - | 🧩 ✅ |
| `/api/assist/github/repos/:owner/:repo/issues/:number/comment` | POST | ✅ `github_add_comment` | - | 🧩 ✅ |
| `/api/assist/github/repos/:owner/:repo/pulls` | GET | ✅ `github_list_prs` | `AgentTab.tsx` | 🧩 ✅ |
| `/api/assist/github/repos/:owner/:repo/pulls` | POST | ✅ `github_create_pr` | - | 🧩 ✅ |
| `/api/assist/github/repos/:owner/:repo/pulls/:number` | GET | ✅ `github_get_pr` | - | 🧩 ✅ |
| `/api/assist/github/repos/:owner/:repo/pulls/:number/merge` | POST | ✅ `github_merge_pr` | - | 🧩 ✅ |
| `/api/assist/github/repos/:owner/:repo/pulls/:number/diff` | GET | ✅ `github_get_pr_diff` | - | 🧩 ✅ |
| `/api/assist/github/repos/:owner/:repo/contents/*path` | GET | ✅ `github_get_contents` | - | 🧩 ✅ |
| `/api/assist/github/repos/:owner/:repo/contents/*path` | PUT | ✅ `github_write_file` | - | 🧩 ✅ |
| `/api/assist/github/repos/:owner/:repo/contents/*path` | DELETE | ✅ `github_delete_file` | - | 🧩 ✅ |
| `/api/assist/github/repos/:owner/:repo/commits` | GET | ✅ `github_list_commits` | - | 🧩 ✅ |
| `/api/assist/github/repos/:owner/:repo/commits/:sha` | GET | ✅ `github_get_commit` | - | 🧩 ✅ |
| `/api/assist/github/repos/:owner/:repo/compare` | GET | ✅ `github_compare` | - | 🧩 ✅ |
| `/api/assist/github/repos/:owner/:repo/workflows` | GET | ✅ `github_list_workflows` | - | 🧩 ✅ |
| `/api/assist/github/repos/:owner/:repo/workflows/trigger` | POST | ✅ `github_trigger_workflow` | - | 🧩 ✅ |
| `/api/assist/github/repos/:owner/:repo/workflows/runs` | GET | ✅ `github_list_workflow_runs` | - | 🧩 ✅ |
| `/api/assist/github/repos/:owner/:repo/releases` | GET | ✅ `github_list_releases` | - | 🧩 ✅ |
| `/api/assist/github/repos/:owner/:repo/releases` | POST | ✅ `github_create_release` | - | 🧩 ✅ |
| `/api/assist/github/repos/:owner/:repo/releases/latest` | GET | ✅ `github_get_latest_release` | - | 🧩 ✅ |
| `/api/assist/github/repos/:owner/:repo/fork` | POST | ✅ `github_fork_repo` | - | 🧩 ✅ |
| `/api/assist/github/actions` | GET | ✅ `github_list_actions` | - | 🧩 ✅ |
| `/api/assist/github/actions` | POST | ✅ `github_execute_action` | - | 🧩 ✅ |
| `/api/assist/github/actions/:id` | GET | ✅ `github_get_action` | - | 🧩 ✅ |
| `/api/assist/github/ratelimit` | GET | ✅ `github_rate_limit` | `AgentTab.tsx` | 🧩 ✅ |

---

## 46. ✅ Microservice-Proxies (transparente Forwarder)

Diese Endpoints werden vom Frontend aufgerufen und gehören zu externen IORA-Microservices.
Sie sind in `iora-home` als **transparente HTTP-Proxies** registriert (Method, Pfad, Header und
Body werden 1:1 weitergereicht). Wenn der Ziel-Microservice nicht läuft, liefert iora-home
HTTP 503 + JSON `{ error, available: false, upstream }`.

URL-Auflösung: pro Microservice via Env-Variable (`IORA_<NAME>_URL`) oder Default `127.0.0.1:<port>`.

| Microservice | Default-Port | Env-Variable | Endpoints |
|--------------|--------------|--------------|-----------|
| iora-secrets | 8093 | `IORA_SECRETS_URL` | `/api/secrets`, `/api/secrets/:id`, `/api/secrets/:id/rotate`, `/api/secrets/:id/audit` |
| iora-files | 8100 | `IORA_FILES_URL` | `/api/files/`, `/api/files/upload`, `/api/files/shares`, `/api/files/shares/:id`, `/api/files/quota`, `/api/files/folders`, `/api/files/:id`, `/api/files/:id/download`, `/api/files/:id/move`, `/api/files/:id/rename`, `/api/files/:id/restore`, `/api/files/:id/versions`, `/api/files/permissions`, `/api/files/permissions/:fid`, `/api/files/permissions/revoke/:pid`, `/api/share/:download_token` (rewrite → `/api/files/shared/:token`) |
| iora-gateway | 8096 | `IORA_GATEWAY_URL` | `/api/gateway/email`, `/api/gateway/search`, `/api/gateway/http/get`, `/api/gateway/requests`, `/api/gateway/ai-requests` |
| iora-watchdog | 8094 | `IORA_WATCHDOG_URL` | `/api/watchdog/status`, `/api/watchdog/services`, `/api/watchdog/metrics`, `/api/watchdog/recovery` |
| iora-connector | 8102 | `IORA_CONNECTOR_URL` | `/api/connector/tunnels`, `/api/connector/services`, `/api/connector/pairing-tokens`, `/api/connector/blocked-ips`, `/api/connector/tunnels/:id`, `/api/connector/pairing-tokens/:id` |
| iora-domain-validator | 8104 | `IORA_DOMAIN_VALIDATOR_URL` | `/api/domain-validator/policy/:app_id`, `/api/domain-validator/logs/:app_id`, `/api/domain-validator/validate` |
| iora-resource-manager | 8105 | `IORA_RESOURCE_MANAGER_URL` | `/api/resources/containers`, `/api/resources/system`, `/api/resources/history`, `/api/resources/reallocate` |
| iora-network-monitor | 8103 | `IORA_NETWORK_MONITOR_URL` | `/api/network/peers`, `/api/network/devices`, `/api/network/devices/active`, `/api/network/stats`, `/api/network/scan`, `/api/metrics`, `/api/interfaces`, `/api/mqtt/topics` |
| iora-cloud (extern) | 8120 | `IORA_CLOUD_URL` | `/api/admin/iora-cloud/config` |

**Implementierung** ([iora-home/src/main.rs](iora-os/backend/services/iora-home/src/main.rs)):
- `forward_request_to(state, base_url, req)` — generischer 1:1-Forwarder mit Hop-by-Hop-Header-Filterung, 30 s Timeout, 50 MB Body-Limit.
- `microservice_url(env_var, default_port)` — URL-Resolver.
- 9 Wrapper-Handler (`proxy_secrets`, `proxy_files`, `proxy_files_share`, `proxy_gateway`, `proxy_watchdog`, `proxy_connector`, `proxy_domain_validator`, `proxy_resources`, `proxy_network_monitor`, `proxy_iora_cloud`).
- `proxy_files_share` schreibt `/api/share/:token` → `/api/files/shared/:token` um (iora-files Pfadkonvention).

> Hinweis: `/api/assist/*` ist seit der AI-Provider-Überarbeitung **vollständig
> verfügbar** über den iora-assist Microservice (Port 8092). Frontend-Routing
> erfolgt automatisch über `adminFetch` → `baseUrlFor(path)` → `getAssistUrl()`.
> Siehe Sektionen 39–45.

---

## 47. Swagger UI / Docs

| Endpoint | Methode | Backend | Status |
|----------|---------|---------|--------|
| `/api/docs` | GET | ✅ Redirect → Swagger UI | ✅ |
| `/api/docs/openapi.json` | GET | ✅ OpenAPI JSON | ✅ |
| `/docs` | GET | ✅ Redirect → `/api/docs` | ✅ |

---

## Zusammenfassung der Probleme

### Kritische Fehler (❌) – 0 Endpoints

Alle ehemals fehlenden Endpoints sind entweder **echt implementiert** oder als
**transparente Microservice-Proxies** in `iora-home` registriert (Sektion 46).
404-Kaskaden im Admin-Panel sind ausgeschlossen.

> ✅ **iora-assist** (`/api/assist/*`) ist vollständig integriert und über
> `getAssistUrl()` (Port 8092) erreichbar — siehe Sektionen 39–45.

### Stubs (⚠️) – 0 Endpoints

Alle ehemaligen Stubs wurden ersetzt durch:

- **Echte Handler** mit Datenbankanbindung in iora-home
  (`core_registrations_*`, `core_updates_*`).
- **Transparente HTTP-Proxies** zu den passenden Microservices
  (`proxy_secrets`, `proxy_files`, `proxy_gateway`, `proxy_watchdog`,
  `proxy_connector`, `proxy_domain_validator`, `proxy_resources`,
  `proxy_network_monitor`, `proxy_iora_cloud`, `proxy_supervisor`,
  `proxy_appstore`, `proxy_core`, `proxy_core_security`).
- **Entfernte Routen** für 2 Endpoints, die das Frontend nie aufruft
  (`PUT /api/supervisor/apps/:app_id`, `POST /api/core/plugins/:id`).

### Teilweise implementiert (🔧) – 0 Endpoints

Alle Routen vollständig implementiert. Verbleibende Anmerkungen:

| Endpoint | Anmerkung |
|----------|-----------|
| `/api/admin/mqtt/config` | GET+POST im Backend registriert; Frontend nutzt nur GET. Kein Bug — POST wird über die Wizard-/AdminPanel-Settings indirekt geschrieben. |
| `/api/network/peers` | Wird zu iora-network-monitor geproxied. Upstream besitzt aktuell `/api/network/devices`/`stats`/`scan` aber **kein** `/peers`. Falls UI das Feature braucht, neue Route in iora-network-monitor ergänzen. |

---

## Empfehlungen

1. **Microservices deployen**: Die meisten ehemaligen Stubs sind jetzt echte
   Proxies. Damit Daten fließen, müssen die jeweiligen Microservices laufen
   (Default-Ports: iora-secrets 8093, iora-files 8100, iora-gateway 8096,
   iora-watchdog 8094, iora-connector 8102, iora-domain-validator 8104,
   iora-resource-manager 8105, iora-network-monitor 8103, iora-supervisor 8097,
   iora-appstore 8098, iora-core 8090, iora-security 8095, iora-cloud 8120).
   URL-Override pro Service via `IORA_<NAME>_URL` Env-Variable.

2. **Falls ein Microservice nicht läuft**: `forward_request_to` liefert
   automatisch HTTP 503 + JSON `{ error, available: false, upstream }` —
   das Frontend rendert sauber ein "nicht verfügbar"-Placeholder statt
   einer SPA-Fallback-Seite.

3. **`update_history` und `service_registrations`** sind eigene Tabellen in
   der iora-home-DB (Migration 023). Die Tabellen werden bei jedem
   `core_updates_install` bzw. Heartbeat-Approval gefüllt.

4. **Assist-Endpoints (`/api/assist/*`)** werden über `adminFetch` automatisch
   an `getAssistUrl()` (Port 8092, iora-assist Microservice) geroutet.
   Provider-, Model-Registry- und GitHub-Integration sind vollständig
   implementiert (siehe Sektionen 40 und 45).
