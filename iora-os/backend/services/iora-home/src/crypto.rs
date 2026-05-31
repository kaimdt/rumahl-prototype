//! Lightweight at-rest encryption for sensitive values that have to be
//! round-tripped through the database (e.g. MQTT passwords).
//!
//! Encryption: AES-256-GCM. Key: SHA-256 of the runtime JWT secret, which is
//! already random per-installation (see `iora_shared::system_config::jwt_secret`).
//! Blob format (base64-encoded, no padding):
//!
//!   "enc:v1:" || BASE64( nonce(12) || ciphertext+tag )
//!
//! `maybe_decrypt` is tolerant: if the input does not carry the `enc:v1:`
//! prefix, it is returned verbatim. This keeps legacy plaintext values
//! readable until they get re-saved through the API.

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng, generic_array::GenericArray, rand_core::RngCore},
    Aes256Gcm,
};
use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
use sha2::{Digest, Sha256};

const PREFIX: &str = "enc:v1:";

fn cipher() -> Aes256Gcm {
    let secret = iora_shared::system_config::jwt_secret();
    let mut hasher = Sha256::new();
    hasher.update(secret.as_bytes());
    hasher.update(b"|mqtt-password-encryption-key");
    let key = hasher.finalize();
    Aes256Gcm::new(GenericArray::from_slice(&key))
}

/// Encrypts `plaintext` and returns an `enc:v1:<base64>` blob.
/// On unexpected failure the original plaintext is returned so the caller
/// never loses the value silently.
pub fn encrypt_secret(plaintext: &str) -> String {
    if plaintext.is_empty() || plaintext.starts_with(PREFIX) {
        // Don't double-encrypt, don't encrypt nothing.
        return plaintext.to_string();
    }
    let cipher = cipher();
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = GenericArray::from_slice(&nonce_bytes);
    match cipher.encrypt(nonce, plaintext.as_bytes()) {
        Ok(ct) => {
            let mut blob = Vec::with_capacity(12 + ct.len());
            blob.extend_from_slice(&nonce_bytes);
            blob.extend_from_slice(&ct);
            format!("{}{}", PREFIX, STANDARD_NO_PAD.encode(&blob))
        }
        Err(_) => plaintext.to_string(),
    }
}

/// Returns the decrypted plaintext if `blob` is an `enc:v1:` value, otherwise `None`.
pub fn decrypt_secret(blob: &str) -> Option<String> {
    let payload = blob.strip_prefix(PREFIX)?;
    let raw = STANDARD_NO_PAD.decode(payload.as_bytes()).ok()?;
    if raw.len() < 12 {
        return None;
    }
    let (nonce_bytes, ct) = raw.split_at(12);
    let nonce = GenericArray::from_slice(nonce_bytes);
    let cipher = cipher();
    cipher
        .decrypt(nonce, ct)
        .ok()
        .and_then(|pt| String::from_utf8(pt).ok())
}

/// Returns the decrypted value if the input carries the `enc:v1:` prefix,
/// otherwise returns the input unchanged. Convenience for migration code that
/// has to read both legacy plaintext and freshly-encrypted entries.
pub fn maybe_decrypt(value: &str) -> String {
    decrypt_secret(value).unwrap_or_else(|| value.to_string())
}

/// Returns `true` if the value carries the encrypted-blob prefix.
#[allow(dead_code)]
pub fn is_encrypted(value: &str) -> bool {
    value.starts_with(PREFIX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let plain = "super-secret-mqtt-password!";
        let blob = encrypt_secret(plain);
        assert!(blob.starts_with(PREFIX));
        assert_eq!(decrypt_secret(&blob).as_deref(), Some(plain));
        assert_eq!(maybe_decrypt(&blob), plain);
    }

    #[test]
    fn legacy_plaintext_passthrough() {
        assert_eq!(maybe_decrypt("legacy"), "legacy");
        assert_eq!(decrypt_secret("legacy"), None);
        assert!(!is_encrypted("legacy"));
    }

    #[test]
    fn empty_is_not_encrypted() {
        assert_eq!(encrypt_secret(""), "");
    }
}
