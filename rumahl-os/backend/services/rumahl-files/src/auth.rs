//! JWT authentication for rumahl Files.

use jsonwebtoken::{decode, DecodingKey, Validation};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String, // user_id
    pub username: String,
    pub is_admin: bool,
    pub exp: usize,
}

pub fn verify_token(token: &str, secret: &str) -> Result<String, String> {
    Ok(verify_claims(token, secret)?.sub)
}

pub fn verify_claims(token: &str, secret: &str) -> Result<Claims, String> {
    let key = DecodingKey::from_secret(secret.as_bytes());
    let mut validation = Validation::default();
    validation.validate_exp = true;

    let data = decode::<Claims>(token, &key, &validation)
        .map_err(|e| format!("Token validation failed: {}", e))?;

    Ok(data.claims)
}
