//! Token-based authentication system for Apps and Plugins
//!
//! Provides time-limited access tokens with cryptographic signatures

use anyhow::{bail, Result};
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::sync::RwLock;

use crate::permissions::{Permission, ProviderType};

/// Access token for API authentication
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessToken {
    pub token: String,
    pub token_id: String,
    pub app_id: String,
    pub expires_at: i64,
    pub permissions: Vec<Permission>,
    pub can_renew: bool,
}

/// Token request from App/Plugin
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenRequest {
    pub app_id: String,
    pub provider_type: ProviderType,
    pub permissions: Vec<Permission>,
    pub duration_seconds: Option<u64>,
}

/// JWT Claims structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenClaims {
    /// Subject (app_id or plugin_id)
    pub sub: String,
    /// Provider type
    #[serde(rename = "type")]
    pub provider_type: ProviderType,
    /// Granted permissions
    pub permissions: Vec<Permission>,
    /// Issued at (Unix timestamp)
    pub iat: i64,
    /// Expires at (Unix timestamp)
    pub exp: i64,
    /// JWT ID (unique token ID)
    pub jti: String,
    /// Cannot escalate privileges
    pub cannot_escalate: bool,
}

/// Token management system
pub struct TokenManager {
    /// JWT encoding key (private)
    encoding_key: EncodingKey,
    /// JWT decoding key (public)
    decoding_key: DecodingKey,
    /// Active tokens
    active_tokens: RwLock<HashMap<String, TokenClaims>>,
    /// Revoked tokens (token_id => revocation reason)
    revoked_tokens: RwLock<HashMap<String, String>>,
    /// Rate limiting (app_id => usage counters)
    rate_limits: RwLock<HashMap<String, RateLimitCounters>>,
}

#[derive(Debug, Clone)]
struct RateLimitCounters {
    last_minute: u32,
    last_hour: u32,
    last_day: u32,
    minute_reset: i64,
    hour_reset: i64,
    day_reset: i64,
}

impl TokenManager {
    /// Create new token manager with cryptographic keys
    pub fn new(secret: &[u8]) -> Self {
        Self {
            encoding_key: EncodingKey::from_secret(secret),
            decoding_key: DecodingKey::from_secret(secret),
            active_tokens: RwLock::new(HashMap::new()),
            revoked_tokens: RwLock::new(HashMap::new()),
            rate_limits: RwLock::new(HashMap::new()),
        }
    }

    /// Issue a new access token
    pub async fn issue_token(&self, request: TokenRequest) -> Result<AccessToken> {
        // Validate duration based on provider type
        let max_duration = match request.provider_type {
            ProviderType::Plugin => 900, // 15 minutes for plugins
            ProviderType::App => 86400,  // 24 hours for apps
        };

        let duration = request
            .duration_seconds
            .unwrap_or(max_duration)
            .min(max_duration);

        let now = chrono::Utc::now().timestamp();
        let token_id = uuid::Uuid::new_v4().to_string();

        // Create JWT claims
        let claims = TokenClaims {
            sub: request.app_id.clone(),
            provider_type: request.provider_type.clone(),
            permissions: request.permissions.clone(),
            iat: now,
            exp: now + duration as i64,
            jti: token_id.clone(),
            cannot_escalate: true,
        };

        // Encode JWT
        let token_string = encode(&Header::default(), &claims, &self.encoding_key)
            .map_err(|e| anyhow::anyhow!("Failed to encode token: {}", e))?;

        // Store active token
        let mut active = self.active_tokens.write().await;
        active.insert(token_id.clone(), claims.clone());

        Ok(AccessToken {
            token: token_string,
            token_id: token_id.clone(),
            app_id: request.app_id,
            expires_at: claims.exp,
            permissions: request.permissions,
            can_renew: matches!(request.provider_type, ProviderType::App),
        })
    }

    /// Validate and decode a token
    pub async fn validate_token(&self, token: &str) -> Result<TokenClaims> {
        // Decode and verify JWT
        let mut validation = Validation::new(Algorithm::HS256);
        validation.validate_exp = true;

        let token_data = decode::<TokenClaims>(token, &self.decoding_key, &validation)
            .map_err(|e| anyhow::anyhow!("Invalid token: {}", e))?;

        let claims = token_data.claims;

        // Check if token is revoked
        let revoked = self.revoked_tokens.read().await;
        if revoked.contains_key(&claims.jti) {
            bail!("Token has been revoked");
        }

        // Verify cannot_escalate flag
        if !claims.cannot_escalate {
            bail!("Token missing anti-escalation flag");
        }

        Ok(claims)
    }

    /// Renew a token (Apps only)
    pub async fn renew_token(&self, old_token: &str) -> Result<AccessToken> {
        let claims = self.validate_token(old_token).await?;

        // Only apps can renew
        if !matches!(claims.provider_type, ProviderType::App) {
            bail!("Only apps can renew tokens");
        }

        // Issue new token with same permissions
        self.issue_token(TokenRequest {
            app_id: claims.sub,
            provider_type: claims.provider_type,
            permissions: claims.permissions,
            duration_seconds: Some(86400), // 24 hours
        })
        .await
    }

    /// Revoke a token
    pub async fn revoke_token(&self, token_id: &str, reason: String) -> Result<()> {
        let mut revoked = self.revoked_tokens.write().await;
        revoked.insert(token_id.to_string(), reason);

        let mut active = self.active_tokens.write().await;
        active.remove(token_id);

        Ok(())
    }

    /// Revoke all tokens for an app/plugin
    pub async fn revoke_all_for_provider(&self, provider_id: &str) -> Result<()> {
        let mut revoked = self.revoked_tokens.write().await;
        let mut active = self.active_tokens.write().await;

        let tokens_to_revoke: Vec<String> = active
            .iter()
            .filter(|(_, claims)| claims.sub == provider_id)
            .map(|(id, _)| id.clone())
            .collect();

        for token_id in tokens_to_revoke {
            revoked.insert(
                token_id.clone(),
                format!("All tokens revoked for {}", provider_id),
            );
            active.remove(&token_id);
        }

        Ok(())
    }

    /// Check rate limit for app
    pub async fn check_rate_limit(&self, app_id: &str) -> Result<()> {
        let now = chrono::Utc::now().timestamp();
        let mut limits = self.rate_limits.write().await;

        let counters = limits
            .entry(app_id.to_string())
            .or_insert_with(|| RateLimitCounters {
                last_minute: 0,
                last_hour: 0,
                last_day: 0,
                minute_reset: now + 60,
                hour_reset: now + 3600,
                day_reset: now + 86400,
            });

        // Reset counters if needed
        if now >= counters.minute_reset {
            counters.last_minute = 0;
            counters.minute_reset = now + 60;
        }
        if now >= counters.hour_reset {
            counters.last_hour = 0;
            counters.hour_reset = now + 3600;
        }
        if now >= counters.day_reset {
            counters.last_day = 0;
            counters.day_reset = now + 86400;
        }

        // Check limits
        if counters.last_minute >= 100 {
            bail!("Rate limit exceeded: 100 requests per minute");
        }
        if counters.last_hour >= 1000 {
            bail!("Rate limit exceeded: 1000 requests per hour");
        }
        if counters.last_day >= 10000 {
            bail!("Rate limit exceeded: 10000 requests per day");
        }

        // Increment counters
        counters.last_minute += 1;
        counters.last_hour += 1;
        counters.last_day += 1;

        Ok(())
    }

    /// Get active token count for provider
    pub async fn get_active_token_count(&self, provider_id: &str) -> usize {
        let active = self.active_tokens.read().await;
        active.values().filter(|c| c.sub == provider_id).count()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_issue_and_validate_token() {
        let manager = TokenManager::new(b"test_secret_key_32_bytes_long!");

        let request = TokenRequest {
            app_id: "test.app".to_string(),
            provider_type: ProviderType::App,
            permissions: vec![Permission::ReadEntities],
            duration_seconds: Some(3600),
        };

        let token = manager.issue_token(request).await.unwrap();
        assert!(token.can_renew);

        let claims = manager.validate_token(&token.token).await.unwrap();
        assert_eq!(claims.sub, "test.app");
        assert_eq!(claims.permissions.len(), 1);
        assert!(claims.cannot_escalate);
    }

    #[tokio::test]
    async fn test_plugin_cannot_renew() {
        let manager = TokenManager::new(b"test_secret_key_32_bytes_long!");

        let request = TokenRequest {
            app_id: "test.plugin".to_string(),
            provider_type: ProviderType::Plugin,
            permissions: vec![Permission::ReadEntities],
            duration_seconds: Some(900),
        };

        let token = manager.issue_token(request).await.unwrap();
        assert!(!token.can_renew);

        let result = manager.renew_token(&token.token).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_token_revocation() {
        let manager = TokenManager::new(b"test_secret_key_32_bytes_long!");

        let request = TokenRequest {
            app_id: "test.app".to_string(),
            provider_type: ProviderType::App,
            permissions: vec![Permission::ReadEntities],
            duration_seconds: Some(3600),
        };

        let token = manager.issue_token(request).await.unwrap();
        manager
            .revoke_token(&token.token_id, "Test revocation".to_string())
            .await
            .unwrap();

        let result = manager.validate_token(&token.token).await;
        assert!(result.is_err());
    }
}
