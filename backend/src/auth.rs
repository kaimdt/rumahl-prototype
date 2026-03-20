use bcrypt::{hash, verify, DEFAULT_COST};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};
use std::env;

const JWT_SECRET_ENV: &str = "JWT_SECRET";
const DEFAULT_JWT_SECRET: &str = "your-secret-key-change-in-production";

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,      // user_id
    pub username: String,
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
pub fn generate_token(user_id: &str, username: &str) -> Result<String, jsonwebtoken::errors::Error> {
    let secret = env::var(JWT_SECRET_ENV).unwrap_or_else(|_| {
        tracing::warn!("JWT_SECRET not set, using default (INSECURE for production!)");
        DEFAULT_JWT_SECRET.to_string()
    });

    let expiration = chrono::Utc::now()
        .checked_add_signed(chrono::Duration::days(30))
        .expect("valid timestamp")
        .timestamp() as usize;

    let claims = Claims {
        sub: user_id.to_owned(),
        username: username.to_owned(),
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
    let secret = env::var(JWT_SECRET_ENV).unwrap_or_else(|_| {
        tracing::warn!("JWT_SECRET not set, using default (INSECURE for production!)");
        DEFAULT_JWT_SECRET.to_string()
    });

    let token_data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_ref()),
        &Validation::default(),
    )?;

    Ok(token_data.claims)
}
