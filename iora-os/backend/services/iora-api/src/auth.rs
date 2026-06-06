//! JWT authentication for IORA API.

use jsonwebtoken::{decode, DecodingKey, Validation};
use serde::{Deserialize, Serialize};

#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub username: String,
    pub is_admin: bool,
    pub exp: usize,
}

#[allow(dead_code)]
pub fn verify_token(token: &str, secret: &str) -> Result<Claims, String> {
    let key = DecodingKey::from_secret(secret.as_bytes());
    let mut validation = Validation::default();
    validation.validate_exp = true;

    let data = decode::<Claims>(token, &key, &validation)
        .map_err(|e| format!("Token validation failed: {}", e))?;

    Ok(data.claims)
}
