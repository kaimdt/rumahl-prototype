use bcrypt::{hash, verify, DEFAULT_COST};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use rand::Rng;
use rumahl_shared_config::system_config;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

#[cfg(test)]
use std::sync::LazyLock;
#[cfg(test)]
static JWT_TEST_MUTEX: LazyLock<std::sync::Mutex<()>> = LazyLock::new(|| std::sync::Mutex::new(()));

/// How many seconds an access JWT is valid for (default 1 hour).
pub const ACCESS_TOKEN_TTL_SECS: i64 = 3600;
/// How many seconds a refresh token is valid for (default 30 days).
pub const REFRESH_TOKEN_TTL_SECS: i64 = 2_592_000;
/// How many bytes the raw refresh token contains (256 bits).
const REFRESH_TOKEN_BYTES: usize = 32;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: String, // user_id
    pub jti: String, // JWT ID – used for blacklisting
    pub username: String,
    pub is_admin: bool,
    #[serde(default)]
    pub iat: usize, // issued at – used for fresh authorization checks
    pub exp: usize, // expiration time
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
pub fn generate_token(
    user_id: &str,
    username: &str,
    is_admin: bool,
) -> Result<(String, String, i64), jsonwebtoken::errors::Error> {
    let secret = system_config::jwt_secret();
    let jti = Uuid::new_v4().to_string();
    let now = chrono::Utc::now();

    let exp = now.timestamp() + ACCESS_TOKEN_TTL_SECS;

    let claims = Claims {
        sub: user_id.to_owned(),
        jti: jti.clone(),
        username: username.to_owned(),
        is_admin,
        iat: now.timestamp() as usize,
        exp: exp as usize,
    };

    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_ref()),
    )?;

    Ok((token, jti, ACCESS_TOKEN_TTL_SECS))
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
/// Format: rumahl_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX (52 chars total)
pub fn generate_api_key() -> String {
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..24).map(|_| rng.gen::<u8>()).collect();
    let encoded = hex::encode(bytes);
    format!("rumahl_{}", encoded)
}

/// Get the prefix of an API key for identification (first 12 chars)
pub fn api_key_prefix(key: &str) -> String {
    key.chars().take(12).collect()
}

/// Generate a cryptographically random refresh token.
/// Returns `(raw_token, sha256_hash)` — store the hash, give the raw token to the client.
pub fn generate_refresh_token() -> (String, String) {
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..REFRESH_TOKEN_BYTES).map(|_| rng.gen::<u8>()).collect();
    let raw = hex::encode(&bytes);
    let hash = sha256_hex(&raw);
    (raw, hash)
}

/// SHA-256 hex digest of a string.
pub fn sha256_hex(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    hex::encode(hasher.finalize())
}

/// Generate a structured RefreshTokenResponse when a new token pair is issued.
#[allow(dead_code)]
pub fn build_refresh_response(
    access_token: String,
    refresh_token: String,
    expires_in: i64,
) -> serde_json::Value {
    serde_json::json!({
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_in": expires_in,
        "token_type": "Bearer",
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cleanup_test_secret() {
        std::env::remove_var("RUMAHL_JWT_SECRET");
    }

    #[test]
    fn test_hash_password_roundtrip() {
        let password = "mein-sicheres-passwort-123!";
        let hash = hash_password(password).unwrap();
        assert!(hash.starts_with("$2b$") || hash.starts_with("$2a$") || hash.starts_with("$2y$"));
        assert!(verify_password(password, &hash).unwrap());
        assert!(!verify_password("falsches-passwort", &hash).unwrap());
    }

    #[test]
    fn test_generate_and_verify_token() {
        let _lock = JWT_TEST_MUTEX.lock().unwrap();
        std::env::set_var(
            "RUMAHL_JWT_SECRET",
            "test-secret-for-unit-tests-0123456789abcdef",
        );
        let (token, jti, expires_in) = generate_token("user_abc123", "testuser", false).unwrap();
        assert!(!token.is_empty());
        assert!(!jti.is_empty());
        assert_eq!(expires_in, ACCESS_TOKEN_TTL_SECS);

        let claims = verify_token(&token).unwrap();
        assert_eq!(claims.sub, "user_abc123");
        assert_eq!(claims.username, "testuser");
        assert_eq!(claims.jti, jti);
        assert!(!claims.is_admin);
        assert!(claims.exp > 0);
        cleanup_test_secret();
    }

    #[test]
    fn test_generate_token_with_admin() {
        let _lock = JWT_TEST_MUTEX.lock().unwrap();
        std::env::set_var(
            "RUMAHL_JWT_SECRET",
            "test-secret-for-unit-tests-0123456789abcdef",
        );
        let (token, _jti, _) = generate_token("admin_001", "admin", true).unwrap();
        let claims = verify_token(&token).unwrap();
        assert!(claims.is_admin);
        cleanup_test_secret();
    }

    #[test]
    fn test_verify_invalid_token() {
        let result = verify_token("ungültiger.token.hier");
        assert!(result.is_err());
    }

    #[test]
    fn test_verify_token_wrong_secret() {
        let _lock = JWT_TEST_MUTEX.lock().unwrap();
        std::env::set_var(
            "RUMAHL_JWT_SECRET",
            "test-secret-for-unit-tests-0123456789abcdef",
        );
        let (token, _, _) = generate_token("user_1", "user", false).unwrap();
        cleanup_test_secret();

        // Use a different secret to verify — should fail
        std::env::set_var("RUMAHL_JWT_SECRET", "different-secret-for-test");
        let result = verify_token(&token);
        assert!(result.is_err());
        std::env::remove_var("RUMAHL_JWT_SECRET");
    }

    #[test]
    fn test_generate_multiple_tokens_unique() {
        let _lock = JWT_TEST_MUTEX.lock().unwrap();
        std::env::set_var(
            "RUMAHL_JWT_SECRET",
            "test-secret-for-unit-tests-0123456789abcdef",
        );
        let (token1, jti1, _) = generate_token("user_1", "user", false).unwrap();
        let (token2, jti2, _) = generate_token("user_1", "user", false).unwrap();
        assert_ne!(token1, token2);
        assert_ne!(jti1, jti2);
        cleanup_test_secret();
    }

    #[test]
    fn test_generate_api_key_format() {
        let key = generate_api_key();
        assert!(key.starts_with("rumahl_"));
        assert_eq!(key.len(), 52); // "rumahl_" + 48 hex chars (24 bytes encoded)
        assert!(key.chars().skip(4).all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn test_api_key_prefix() {
        let key = generate_api_key();
        let prefix = api_key_prefix(&key);
        assert_eq!(prefix.len(), 12);
        assert_eq!(&key[..12], &prefix);
    }

    #[test]
    fn test_generate_refresh_token() {
        let (raw, hash) = generate_refresh_token();
        assert_eq!(raw.len(), 64);
        assert_eq!(hash.len(), 64);
        assert_ne!(raw, hash);
        assert_eq!(hash, sha256_hex(&raw));
    }

    #[test]
    fn test_sha256_hex_consistency() {
        let hash1 = sha256_hex("hello-world");
        let hash2 = sha256_hex("hello-world");
        assert_eq!(hash1, hash2);
        assert_ne!(hash1, sha256_hex("hello-world!"));
    }

    #[test]
    fn test_sha256_hex_empty() {
        assert_eq!(
            sha256_hex(""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn test_build_refresh_response() {
        let response = build_refresh_response(
            "access-token-123".to_string(),
            "refresh-token-456".to_string(),
            3600,
        );
        assert_eq!(response["access_token"], "access-token-123");
        assert_eq!(response["refresh_token"], "refresh-token-456");
        assert_eq!(response["expires_in"], 3600);
        assert_eq!(response["token_type"], "Bearer");
    }
}
