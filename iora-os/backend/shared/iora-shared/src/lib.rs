//! IORA Shared – common types, plugin system, and utilities used across all IORA programs.

pub mod api_gateway;
pub mod app_manifest;
pub mod env;
pub mod heartbeat;
pub mod manifest_validator;
pub mod manifest_validator_ext;
pub mod plugin;
pub mod port_manager;
pub mod registration;
pub mod types;
pub mod widget_registry;
pub mod update_system;
pub mod security_monitor;
pub mod database_manager;
pub mod permissions;
pub mod settings;
pub mod system_config;
pub mod token_manager;
pub mod integrity_monitor;
pub mod app_storage;
pub mod app_database;
pub mod app_scheduler;
pub mod app_messaging;
pub mod app_webhooks;
pub mod theme;
