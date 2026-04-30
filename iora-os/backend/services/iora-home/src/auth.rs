use bcrypt::{hash, verify, DEFAULT_COST};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use std::env;
use rand::Rng;
use iora_shared::system_config;

const JWT_SECRET_ENV: &str = "JWT_SECRET";
const DEFAULT_JWT_SECRET: &str = "your-secret-key-change-in-production";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: String,      // user_id
    pub username: String,
    pub is_admin: bool,
    pub exp: usize,       // expiration time
}

/// Hash a password using bcrypt
pub fn hash_password(password: &str) -> Result<String, bcrypt::BcryptError> {
    hash(password, DEFAULT_COST)
}

/// Verify a password against a hash
pub fn verify_password(password: &str, hash: &str) -> Result<bool, bcrypt::BcryptError> {
    verify(password, hash)
}

/// Generate a JWT token for a user
pub fn generate_token(user_id: &str, username: &str, is_admin: bool, expiration_days: i64) -> Result<String, jsonwebtoken::errors::Error> {
    let secret = system_config::jwt_secret();

    let expiration = chrono::Utc::now()
        .checked_add_signed(chrono::Duration::days(expiration_days.clamp(1, 90)))
        .expect("valid timestamp")
        .timestamp() as usize;

    let claims = Claims {
        sub: user_id.to_owned(),
        username: username.to_owned(),
        is_admin,
        exp: expiration,
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_ref()),
    )
}

/// Verify a JWT token and extract claims
pub fn verify_token(token: &str) -> Result<Claims, jsonwebtoken::errors::Error> {
    let secret = system_config::jwt_secret();

    let token_data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_ref()),
        &Validation::default(),
    )?;

    Ok(token_data.claims)
}

/// Generate a cryptographically secure API key
/// Format: mdt_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX (36 chars total)
pub fn generate_api_key() -> String {
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..24).map(|_| rng.gen::<u8>()).collect();
    let encoded = hex::encode(bytes);
    format!("mdt_{}", encoded)
}

/// Get the prefix of an API key for identification (first 12 chars)
pub fn api_key_prefix(key: &str) -> String {
    key.chars().take(12).collect()
}
