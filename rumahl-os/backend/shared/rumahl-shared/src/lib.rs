//! rumahl Shared – common types, plugin system, and utilities used across all rumahl programs.

pub mod api_gateway;
pub mod app_capabilities;
pub mod app_database;
pub mod app_manifest;
pub mod app_messaging;
pub mod app_scheduler;
pub mod app_storage;
pub mod app_webhooks;
pub mod automation;
pub mod clipboard;
pub mod database_manager;
pub mod devices;
pub mod integrity_monitor;
pub mod manifest_validator;
pub mod manifest_validator_ext;
pub mod permission_requests;
pub mod permissions;
pub mod plugin;
pub mod port_manager;
pub mod registration;
pub mod security_monitor;
pub mod session;
pub mod settings;
pub mod system_jobs;
pub mod theme;
pub mod token_manager;
pub mod update_system;
pub mod user_profiles;
pub mod widget_registry;

// Compatibility re-exports keep the established `rumahl_shared::...` module
// paths stable while services can depend on smaller leaf crates in dev builds.
pub use rumahl_shared_config::{env, system_config};
pub use rumahl_shared_heartbeat as heartbeat;
pub use rumahl_shared_types as types;
pub use rumahl_shared_upload as upload_store;
