//! JWT authentication for IORA Connector admin API.

use jsonwebtoken::{decode, DecodingKey, Validation};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub username: String,
    pub is_admin: bool,
    pub exp: usize,
}

/// Verify a JWT token and ensure admin privileges.
pub fn verify_admin_token(token: &str, secret: &str) -> Result<String, String> {
    let key = DecodingKey::from_secret(secret.as_bytes());
    let mut validation = Validation::default();
    validation.validate_exp = true;

    let data = decode::<Claims>(token, &key, &validation)
        .map_err(|e| format!("Token validation failed: {}", e))?;

    if !data.claims.is_admin {
        return Err("Admin access required".to_string());
    }

    Ok(data.claims.sub)
}
