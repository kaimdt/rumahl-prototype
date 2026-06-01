//! Database Manager for Apps and Plugins
//!
//! Each App gets its own isolated database with dedicated user.
//! System retains control over all databases.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseInfo {
    pub database_name: String,
    pub provider_id: String,
    pub provider_type: ProviderType,
    pub db_user: String,
    pub db_password: String, // Encrypted in production
    pub created_at: String,
    pub size_mb: u64,
    pub connection_string: String,
    pub max_connections: u32,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProviderType {
    App,
    Plugin,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseBackup {
    pub backup_id: String,
    pub database_name: String,
    pub provider_id: String,
    pub backup_path: String,
    pub size_mb: u64,
    pub created_at: String,
    pub can_restore: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabasePermissions {
    pub can_create_tables: bool,
    pub can_drop_tables: bool,
    pub can_create_indexes: bool,
    pub can_create_views: bool,
    pub can_execute_functions: bool,
    pub max_table_size_mb: u64,
    pub max_total_size_mb: u64,
}

impl Default for DatabasePermissions {
    fn default() -> Self {
        Self {
            can_create_tables: true,
            can_drop_tables: true,
            can_create_indexes: true,
            can_create_views: true,
            can_execute_functions: false, // Security: disabled by default
            max_table_size_mb: 100,
            max_total_size_mb: 500,
        }
    }
}

/// Database Manager handles database provisioning and lifecycle
#[derive(Default)]
pub struct DatabaseManager {
    databases: RwLock<HashMap<String, DatabaseInfo>>,
    backups: RwLock<HashMap<String, Vec<DatabaseBackup>>>,
    permissions: RwLock<HashMap<String, DatabasePermissions>>,
}

impl DatabaseManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Create a new database for an App or Plugin
    pub async fn create_database(
        &self,
        provider_id: String,
        provider_type: ProviderType,
    ) -> anyhow::Result<DatabaseInfo> {
        // Check if database already exists
        let databases = self.databases.read().await;
        if databases.values().any(|db| db.provider_id == provider_id) {
            anyhow::bail!("Database for provider '{}' already exists", provider_id);
        }
        drop(databases);

        // Generate database name and credentials
        let db_name = self.generate_database_name(&provider_id);
        let db_user = self.generate_database_user(&provider_id);
        let db_password = self.generate_password();

        let db_info = DatabaseInfo {
            database_name: db_name.clone(),
            provider_id: provider_id.clone(),
            provider_type,
            db_user: db_user.clone(),
            db_password: db_password.clone(),
            created_at: chrono::Utc::now().to_rfc3339(),
            size_mb: 0,
            connection_string: format!(
                "postgresql://{}:{}@localhost:5432/{}",
                db_user, db_password, db_name
            ),
            max_connections: 10,
            is_active: true,
        };

        // Store database info
        let mut databases = self.databases.write().await;
        databases.insert(provider_id.clone(), db_info.clone());
        drop(databases);

        // Set default permissions
        let mut permissions = self.permissions.write().await;
        permissions.insert(provider_id, DatabasePermissions::default());

        Ok(db_info)
    }

    /// Delete a database
    pub async fn delete_database(
        &self,
        provider_id: &str,
        delete_data: bool,
    ) -> anyhow::Result<()> {
        let mut databases = self.databases.write().await;
        let _db_info = databases
            .remove(provider_id)
            .ok_or_else(|| anyhow::anyhow!("Database for provider '{}' not found", provider_id))?;

        if !delete_data {
            // Create final backup before marking as inactive
            drop(databases);
            self.create_backup(provider_id).await?;
        }

        // Remove permissions
        let mut permissions = self.permissions.write().await;
        permissions.remove(provider_id);

        Ok(())
    }

    /// Create a backup of a database
    pub async fn create_backup(&self, provider_id: &str) -> anyhow::Result<DatabaseBackup> {
        let databases = self.databases.read().await;
        let db_info = databases
            .get(provider_id)
            .ok_or_else(|| anyhow::anyhow!("Database for provider '{}' not found", provider_id))?;

        let backup = DatabaseBackup {
            backup_id: format!("backup_{}", uuid::Uuid::new_v4()),
            database_name: db_info.database_name.clone(),
            provider_id: provider_id.to_string(),
            backup_path: format!(
                "/var/lib/iora/backups/{}_{}_{}.sql",
                provider_id,
                chrono::Utc::now().format("%Y%m%d_%H%M%S"),
                uuid::Uuid::new_v4()
            ),
            size_mb: db_info.size_mb,
            created_at: chrono::Utc::now().to_rfc3339(),
            can_restore: true,
        };

        let mut backups = self.backups.write().await;
        backups
            .entry(provider_id.to_string())
            .or_insert_with(Vec::new)
            .push(backup.clone());

        Ok(backup)
    }

    /// Restore a database from backup
    pub async fn restore_backup(&self, backup_id: &str) -> anyhow::Result<()> {
        let backups = self.backups.read().await;
        let backup = backups
            .values()
            .flat_map(|v| v.iter())
            .find(|b| b.backup_id == backup_id)
            .ok_or_else(|| anyhow::anyhow!("Backup '{}' not found", backup_id))?;

        if !backup.can_restore {
            anyhow::bail!("Backup '{}' cannot be restored", backup_id);
        }

        // Restore logic would go here
        Ok(())
    }

    /// Get database info
    pub async fn get_database(&self, provider_id: &str) -> Option<DatabaseInfo> {
        self.databases.read().await.get(provider_id).cloned()
    }

    /// List all databases
    pub async fn list_databases(&self) -> Vec<DatabaseInfo> {
        self.databases.read().await.values().cloned().collect()
    }

    /// List backups for a database
    pub async fn list_backups(&self, provider_id: &str) -> Vec<DatabaseBackup> {
        self.backups
            .read()
            .await
            .get(provider_id)
            .cloned()
            .unwrap_or_default()
    }

    /// Update database size
    pub async fn update_size(&self, provider_id: &str, size_mb: u64) -> anyhow::Result<()> {
        let mut databases = self.databases.write().await;
        if let Some(db) = databases.get_mut(provider_id) {
            db.size_mb = size_mb;
            Ok(())
        } else {
            anyhow::bail!("Database for provider '{}' not found", provider_id)
        }
    }

    /// Set database permissions
    pub async fn set_permissions(&self, provider_id: String, perms: DatabasePermissions) {
        let mut permissions = self.permissions.write().await;
        permissions.insert(provider_id, perms);
    }

    /// Get database permissions
    pub async fn get_permissions(&self, provider_id: &str) -> DatabasePermissions {
        self.permissions
            .read()
            .await
            .get(provider_id)
            .cloned()
            .unwrap_or_default()
    }

    /// Helper: Generate database name
    fn generate_database_name(&self, provider_id: &str) -> String {
        format!("iora_app_{}", provider_id.replace('-', "_"))
    }

    /// Helper: Generate database user
    fn generate_database_user(&self, provider_id: &str) -> String {
        format!("iora_user_{}", provider_id.replace('-', "_"))
    }

    /// Helper: Generate secure password
    fn generate_password(&self) -> String {
        format!("iora_pass_{}", uuid::Uuid::new_v4())
    }
}
