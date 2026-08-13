//! IORA Shared – common types, plugin system, and utilities used across all IORA programs.

pub mod api_gateway;
pub mod automation;
pub mod app_capabilities;
pub mod app_database;
pub mod app_manifest;
pub mod app_messaging;
pub mod app_scheduler;
pub mod clipboard;
pub mod devices;
pub mod permission_requests;
pub mod session;
pub mod user_profiles;
pub mod app_storage;
pub mod app_webhooks;
pub mod database_manager;
pub mod integrity_monitor;
pub mod manifest_validator;
pub mod manifest_validator_ext;
pub mod permissions;
pub mod plugin;
pub mod port_manager;
pub mod registration;
pub mod security_monitor;
pub mod settings;
pub mod system_jobs;
pub mod theme;
pub mod token_manager;
pub mod update_system;
pub mod widget_registry;

// Compatibility re-exports keep the established `iora_shared::...` module
// paths stable while services can depend on smaller leaf crates in dev builds.
pub use iora_shared_config::{env, system_config};
pub use iora_shared_heartbeat as heartbeat;
pub use iora_shared_types as types;
pub use iora_shared_upload as upload_store;
