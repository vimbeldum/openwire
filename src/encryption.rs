//! End-to-End Encryption for OpenWire
//!
//! Provides application-layer encryption using:
//! - X25519 for key exchange (Diffie-Hellman)
//! - ChaCha20-Poly1305 for authenticated encryption (AEAD)
//! - HKDF for key derivation with proper salt
//!
//! This ensures messages are encrypted end-to-end, not just at the transport layer.

#![allow(dead_code)] // Some functions are for future use or testing

use anyhow::Result;
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    ChaCha20Poly1305, Nonce,
};
use hkdf::Hkdf;
use rand::TryRng;
use sha2::Sha256;
use x25519_dalek::{EphemeralSecret, PublicKey, StaticSecret};
use zeroize::Zeroize;

/// Nonce size for ChaCha20-Poly1305 (12 bytes)
pub const NONCE_SIZE: usize = 12;

/// Key size for X25519 and ChaCha20-Poly1305 (32 bytes)
pub const KEY_SIZE: usize = 32;

/// Salt size for HKDF (32 bytes)
pub const SALT_SIZE: usize = 32;

/// A nonce used for encryption
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct EncryptionNonce(pub [u8; NONCE_SIZE]);

impl EncryptionNonce {
    /// Generate a random nonce
    pub fn random() -> Self {
        let mut nonce = [0u8; NONCE_SIZE];
        rand::rng()
            .try_fill_bytes(&mut nonce)
            .expect("Failed to generate random nonce");
        Self(nonce)
    }

    /// Get bytes
    pub fn as_bytes(&self) -> &[u8] {
        &self.0
    }
}

/// An encrypted message with all necessary metadata for decryption
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct EncryptedMessage {
    /// The encrypted ciphertext
    pub ciphertext: Vec<u8>,
    /// The nonce used for encryption
    pub nonce: EncryptionNonce,
    /// The sender's ephemeral public key (for forward secrecy)
    pub ephemeral_public_key: Option<Vec<u8>>,
    /// Random salt used for HKDF key derivation
    pub salt: Vec<u8>,
    /// Timestamp for replay protection
    pub timestamp: u64,
    /// Additional authenticated data
    pub aad: Option<Vec<u8>>,
}

impl EncryptedMessage {
    /// Serialize to bytes for transmission
    pub fn to_bytes(&self) -> Result<Vec<u8>> {
        Ok(serde_json::to_vec(self)?)
    }

    /// Deserialize from bytes
    pub fn from_bytes(data: &[u8]) -> Result<Self> {
        Ok(serde_json::from_slice(data)?)
    }
}

/// An X25519 keypair for ECDH key exchange.
///
/// Private key material is zeroized on drop.
pub struct EncryptionKeyPair {
    /// The static secret key (long-term)
    secret: StaticSecret,
    /// The public key
    public: PublicKey,
}

impl Drop for EncryptionKeyPair {
    fn drop(&mut self) {
        // StaticSecret from x25519-dalek with `zeroize` feature handles its own zeroization.
        // This explicit Drop ensures we don't accidentally derive Clone later.
    }
}

impl EncryptionKeyPair {
    /// Generate a new random keypair
    pub fn generate() -> Result<Self> {
        let secret = StaticSecret::random_from_rng(&mut rand::rng());
        let public = PublicKey::from(&secret);
        Ok(Self { secret, public })
    }

    /// Get the public key bytes
    pub fn public_key_bytes(&self) -> [u8; KEY_SIZE] {
        self.public.to_bytes()
    }

    /// Get the public key
    pub fn public_key(&self) -> &PublicKey {
        &self.public
    }

    /// Perform Diffie-Hellman key exchange with another public key
    pub fn diffie_hellman(&self, their_public: &PublicKey) -> [u8; 32] {
        *self.secret.diffie_hellman(their_public).as_bytes()
    }

    /// Create a public key from bytes
    pub fn public_key_from_bytes(bytes: &[u8; KEY_SIZE]) -> PublicKey {
        PublicKey::from(*bytes)
    }

    /// Serialize the secret key for storage
    ///
    /// # Security
    /// The caller is responsible for securely handling the returned bytes.
    pub fn secret_to_bytes(&self) -> [u8; KEY_SIZE] {
        self.secret.to_bytes()
    }

    /// Deserialize from secret key bytes
    pub fn from_secret_bytes(bytes: [u8; KEY_SIZE]) -> Self {
        let secret = StaticSecret::from(bytes);
        let public = PublicKey::from(&secret);
        Self { secret, public }
    }
}

/// Session manager for handling encryption with multiple peers.
///
/// Not Clone — private key material must stay in one place.
pub struct SessionManager {
    /// Our encryption keypair
    keypair: EncryptionKeyPair,
}

impl SessionManager {
    /// Create a new session manager with a fresh keypair
    pub fn new() -> Result<Self> {
        Ok(Self {
            keypair: EncryptionKeyPair::generate()?,
        })
    }

    /// Get our public key bytes to share with peers
    pub fn public_key_bytes(&self) -> [u8; KEY_SIZE] {
        self.keypair.public_key_bytes()
    }

    /// Establish a session with a peer (stores for future use)
    pub fn establish_session(&self, _peer_public_key: &[u8; KEY_SIZE]) -> Result<String> {
        // Session ID is the hex of the peer's public key
        Ok(hex::encode(_peer_public_key))
    }

    /// Encrypt a message for a specific peer
    pub fn encrypt_for_peer(
        &self,
        peer_public_key: &[u8; KEY_SIZE],
        plaintext: &[u8],
        aad: Option<&[u8]>,
    ) -> Result<EncryptedMessage> {
        let their_public = EncryptionKeyPair::public_key_from_bytes(peer_public_key);

        // Generate ephemeral key for forward secrecy
        let mut rng = rand::rng();
        let ephemeral = EphemeralSecret::random_from_rng(&mut rng);
        let ephemeral_public = PublicKey::from(&ephemeral);

        // Perform DH with both static and ephemeral keys
        let static_shared = self.keypair.diffie_hellman(&their_public);
        let ephemeral_shared = *ephemeral.diffie_hellman(&their_public).as_bytes();

        // Combine both shared secrets for stronger security
        let combined_secret = combine_secrets(&static_shared, &ephemeral_shared);

        // Generate random salt for HKDF
        let mut salt = [0u8; SALT_SIZE];
        rng.try_fill_bytes(&mut salt)
            .map_err(|e| anyhow::anyhow!("Failed to generate salt: {}", e))?;

        // Derive encryption key with proper salt and domain-separated info
        // Note: we use a static info string because the DH shared secret already
        // incorporates both parties' keys. Using one party's key here would cause
        // encrypt/decrypt to derive different keys.
        let mut key = derive_key_bytes(&combined_secret, &salt, b"openwire-e2e-v1")?;

        // Generate random nonce
        let nonce = EncryptionNonce::random();

        // Encrypt with ChaCha20-Poly1305
        let cipher = ChaCha20Poly1305::new_from_slice(&key)
            .map_err(|e| anyhow::anyhow!("Failed to create cipher: {}", e))?;

        let payload = match aad {
            Some(aad_data) => Payload {
                msg: plaintext,
                aad: aad_data,
            },
            None => Payload {
                msg: plaintext,
                aad: &[],
            },
        };

        let ciphertext = cipher
            .encrypt(Nonce::from_slice(nonce.as_bytes()), payload)
            .map_err(|e| anyhow::anyhow!("Encryption failed: {}", e))?;

        // Zeroize the derived key
        key.zeroize();

        Ok(EncryptedMessage {
            ciphertext,
            nonce,
            ephemeral_public_key: Some(ephemeral_public.to_bytes().to_vec()),
            salt: salt.to_vec(),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
            aad: aad.map(|a| a.to_vec()),
        })
    }

    /// Decrypt a message from a peer
    pub fn decrypt_from_peer(
        &self,
        encrypted: &EncryptedMessage,
        peer_public_key: &[u8; KEY_SIZE],
    ) -> Result<Vec<u8>> {
        let their_public = EncryptionKeyPair::public_key_from_bytes(peer_public_key);

        // Compute shared secrets
        let static_shared = self.keypair.diffie_hellman(&their_public);

        // If ephemeral key is provided, use it for forward secrecy
        let combined_secret = if let Some(ephemeral_bytes) = &encrypted.ephemeral_public_key {
            if ephemeral_bytes.len() != KEY_SIZE {
                return Err(anyhow::anyhow!("Invalid ephemeral public key length"));
            }
            let mut bytes = [0u8; KEY_SIZE];
            bytes.copy_from_slice(&ephemeral_bytes[..KEY_SIZE]);
            let ephemeral_public = PublicKey::from(bytes);

            // For decryption, we DH our static key with their ephemeral
            let ephemeral_shared = self.keypair.diffie_hellman(&ephemeral_public);
            combine_secrets(&static_shared, &ephemeral_shared)
        } else {
            static_shared.to_vec()
        };

        // Extract salt from the message
        if encrypted.salt.len() != SALT_SIZE {
            return Err(anyhow::anyhow!("Invalid salt length"));
        }
        let mut salt = [0u8; SALT_SIZE];
        salt.copy_from_slice(&encrypted.salt);

        // Derive decryption key with same salt and info
        let mut key = derive_key_bytes(&combined_secret, &salt, b"openwire-e2e-v1")?;

        // Decrypt with ChaCha20-Poly1305
        let cipher = ChaCha20Poly1305::new_from_slice(&key)
            .map_err(|e| anyhow::anyhow!("Failed to create cipher: {}", e))?;

        let payload = match &encrypted.aad {
            Some(aad_data) => Payload {
                msg: &encrypted.ciphertext,
                aad: aad_data.as_slice(),
            },
            None => Payload {
                msg: &encrypted.ciphertext,
                aad: &[],
            },
        };

        let plaintext = cipher
            .decrypt(Nonce::from_slice(encrypted.nonce.as_bytes()), payload)
            .map_err(|e| anyhow::anyhow!("Decryption failed: {}", e))?;

        // Zeroize the derived key
        key.zeroize();

        Ok(plaintext)
    }
}

/// Combine two shared secrets by concatenation (then fed into HKDF)
fn combine_secrets(s1: &[u8; 32], s2: &[u8; 32]) -> Vec<u8> {
    let mut combined = Vec::with_capacity(64);
    combined.extend_from_slice(s1);
    combined.extend_from_slice(s2);
    combined
}

/// Derive a key from raw bytes using HKDF with proper salt and info
fn derive_key_bytes(secret: &[u8], salt: &[u8; SALT_SIZE], info: &[u8]) -> Result<[u8; KEY_SIZE]> {
    let hkdf = Hkdf::<Sha256>::new(Some(salt), secret);
    let mut key = [0u8; KEY_SIZE];
    hkdf.expand(info, &mut key)
        .map_err(|e| anyhow::anyhow!("HKDF expansion failed: {}", e))?;
    Ok(key)
}

/// Simple encrypt function for when you already have a shared key
pub fn encrypt_with_key(
    plaintext: &[u8],
    key: &[u8; KEY_SIZE],
    aad: Option<&[u8]>,
) -> Result<EncryptedMessage> {
    let nonce = EncryptionNonce::random();
    let cipher = ChaCha20Poly1305::new_from_slice(key)
        .map_err(|e| anyhow::anyhow!("Failed to create cipher: {}", e))?;

    let payload = match aad {
        Some(aad_data) => Payload {
            msg: plaintext,
            aad: aad_data,
        },
        None => Payload {
            msg: plaintext,
            aad: &[],
        },
    };

    let ciphertext = cipher
        .encrypt(Nonce::from_slice(nonce.as_bytes()), payload)
        .map_err(|e| anyhow::anyhow!("Encryption failed: {}", e))?;

    Ok(EncryptedMessage {
        ciphertext,
        nonce,
        ephemeral_public_key: None,
        salt: Vec::new(), // No salt needed for direct-key encryption
        timestamp: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_secs(),
        aad: aad.map(|a| a.to_vec()),
    })
}

/// Simple decrypt function for when you already have a shared key
pub fn decrypt_with_key(encrypted: &EncryptedMessage, key: &[u8; KEY_SIZE]) -> Result<Vec<u8>> {
    let cipher = ChaCha20Poly1305::new_from_slice(key)
        .map_err(|e| anyhow::anyhow!("Failed to create cipher: {}", e))?;

    let payload = match &encrypted.aad {
        Some(aad_data) => Payload {
            msg: &encrypted.ciphertext,
            aad: aad_data.as_slice(),
        },
        None => Payload {
            msg: &encrypted.ciphertext,
            aad: &[],
        },
    };

    let plaintext = cipher
        .decrypt(Nonce::from_slice(encrypted.nonce.as_bytes()), payload)
        .map_err(|e| anyhow::anyhow!("Decryption failed: {}", e))?;
    Ok(plaintext)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_keypair_generation() {
        let keypair = EncryptionKeyPair::generate().unwrap();
        assert_eq!(keypair.public_key_bytes().len(), KEY_SIZE);
    }

    #[test]
    fn test_encryption_decryption() {
        let alice = SessionManager::new().unwrap();
        let bob = SessionManager::new().unwrap();

        let alice_public = alice.public_key_bytes();
        let bob_public = bob.public_key_bytes();

        // Alice encrypts for Bob
        let message = b"Hello, Bob! This is a secret message.";
        let encrypted = alice.encrypt_for_peer(&bob_public, message, None).unwrap();

        // Bob decrypts
        let decrypted = bob.decrypt_from_peer(&encrypted, &alice_public).unwrap();

        assert_eq!(message.to_vec(), decrypted);
    }

    #[test]
    fn test_encryption_with_aad() {
        let alice = SessionManager::new().unwrap();
        let bob = SessionManager::new().unwrap();

        let alice_public = alice.public_key_bytes();
        let bob_public = bob.public_key_bytes();

        let message = b"Secret with AAD";
        let aad = b"topic-name";
        let encrypted = alice
            .encrypt_for_peer(&bob_public, message, Some(aad))
            .unwrap();

        let decrypted = bob.decrypt_from_peer(&encrypted, &alice_public).unwrap();
        assert_eq!(message.to_vec(), decrypted);
    }

    #[test]
    fn test_encrypted_message_serialization() {
        let encrypted = EncryptedMessage {
            ciphertext: vec![1, 2, 3, 4],
            nonce: EncryptionNonce([0u8; NONCE_SIZE]),
            ephemeral_public_key: Some(vec![5, 6, 7, 8]),
            salt: vec![0u8; SALT_SIZE],
            timestamp: 1234567890,
            aad: None,
        };

        let bytes = encrypted.to_bytes().unwrap();
        let decoded = EncryptedMessage::from_bytes(&bytes).unwrap();

        assert_eq!(encrypted.ciphertext, decoded.ciphertext);
        assert_eq!(encrypted.timestamp, decoded.timestamp);
    }

    #[test]
    fn test_tampered_ciphertext_fails() {
        let alice = SessionManager::new().unwrap();
        let bob = SessionManager::new().unwrap();

        let alice_public = alice.public_key_bytes();
        let bob_public = bob.public_key_bytes();

        let message = b"Tamper test";
        let mut encrypted = alice.encrypt_for_peer(&bob_public, message, None).unwrap();

        // Tamper with ciphertext
        if let Some(byte) = encrypted.ciphertext.first_mut() {
            *byte ^= 0xFF;
        }

        assert!(bob.decrypt_from_peer(&encrypted, &alice_public).is_err());
    }

    #[test]
    fn test_simple_encrypt_decrypt() {
        let key = [42u8; KEY_SIZE];
        let message = b"Simple encryption test";

        let encrypted = encrypt_with_key(message, &key, None).unwrap();
        let decrypted = decrypt_with_key(&encrypted, &key).unwrap();

        assert_eq!(message.to_vec(), decrypted);
    }
}
