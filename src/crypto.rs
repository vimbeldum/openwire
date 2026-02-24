//! Cryptographic utilities for OpenWire
//!
//! Handles key generation, identity management, message signing,
//! and end-to-end encryption integration.

use anyhow::Result;
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use rand::rngs::OsRng;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use zeroize::ZeroizeOnDrop;

use crate::encryption::SessionManager;

/// Represents a peer's cryptographic identity.
///
/// Contains an Ed25519 key pair used for:
/// - Peer identification
/// - Message signing
/// - Authentication
///
/// Not Clone — private key material must not be duplicated.
/// Use `Arc<Identity>` for shared ownership.
#[derive(ZeroizeOnDrop)]
pub struct Identity {
    /// The signing (private) key — zeroized on drop
    #[zeroize(skip)] // SigningKey handles its own zeroization via ed25519-dalek's zeroize feature
    signing_key: SigningKey,
    /// The verifying (public) key
    #[zeroize(skip)]
    verifying_key: VerifyingKey,
}

impl Identity {
    /// Generate a new random identity
    ///
    /// Uses the operating system's secure random number generator
    /// to create a new Ed25519 key pair.
    pub fn generate() -> Result<Self> {
        let signing_key = SigningKey::generate(&mut OsRng);
        let verifying_key = signing_key.verifying_key();

        Ok(Self {
            signing_key,
            verifying_key,
        })
    }

    /// Get the peer ID derived from the public key
    ///
    /// Returns a hex-encoded representation of the public key
    /// that serves as a unique identifier for this peer.
    pub fn peer_id(&self) -> String {
        hex::encode(self.verifying_key.as_bytes())
    }

    /// Get the public key bytes
    pub fn public_key(&self) -> &[u8] {
        self.verifying_key.as_bytes()
    }

    /// Get the public key as a fixed-size array
    pub fn public_key_bytes(&self) -> [u8; 32] {
        self.verifying_key.to_bytes()
    }

    /// Sign a message with the private key
    pub fn sign(&self, message: &[u8]) -> Result<Signature> {
        Ok(self.signing_key.sign(message))
    }

    /// Verify a signature against a message using this identity's key
    pub fn verify(&self, message: &[u8], signature: &Signature) -> Result<()> {
        self.verifying_key
            .verify_strict(message, signature)
            .map_err(|e| anyhow::anyhow!("Signature verification failed: {}", e))
    }

    /// Serialize the identity for storage
    ///
    /// # Security
    /// The returned bytes contain the private key. Handle with care.
    pub fn to_bytes(&self) -> [u8; 32] {
        self.signing_key.to_bytes()
    }

    /// Deserialize identity from bytes
    pub fn from_bytes(bytes: [u8; 32]) -> Result<Self> {
        let signing_key = SigningKey::from_bytes(&bytes);
        let verifying_key = signing_key.verifying_key();

        Ok(Self {
            signing_key,
            verifying_key,
        })
    }

    /// Get the ed25519 signing key bytes (needed for libp2p identity bridge)
    pub fn signing_key_bytes(&self) -> [u8; 32] {
        self.signing_key.to_bytes()
    }
}

/// A signed message with authentication
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SignedMessage {
    /// The message content (possibly encrypted)
    pub content: Vec<u8>,
    /// The Ed25519 signature
    pub signature: Vec<u8>,
    /// The sender's public key
    pub sender_public_key: Vec<u8>,
    /// Timestamp for replay protection
    pub timestamp: u64,
}

impl SignedMessage {
    /// Create a new signed message
    pub fn new(identity: &Identity, content: Vec<u8>) -> Result<Self> {
        let signature = identity.sign(&content)?;
        Ok(Self {
            content,
            signature: signature.to_bytes().to_vec(),
            sender_public_key: identity.public_key().to_vec(),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        })
    }

    /// Verify the message signature
    ///
    /// Reconstructs the sender's public key and verifies the Ed25519 signature.
    pub fn verify(&self) -> Result<()> {
        if self.sender_public_key.len() != 32 {
            return Err(anyhow::anyhow!("Invalid public key length: expected 32, got {}", self.sender_public_key.len()));
        }
        let mut public_key_bytes = [0u8; 32];
        public_key_bytes.copy_from_slice(&self.sender_public_key);

        let verifying_key = VerifyingKey::from_bytes(&public_key_bytes)
            .map_err(|e| anyhow::anyhow!("Invalid public key: {}", e))?;

        if self.signature.len() != 64 {
            return Err(anyhow::anyhow!("Invalid signature length: expected 64, got {}", self.signature.len()));
        }
        let mut signature_bytes = [0u8; 64];
        signature_bytes.copy_from_slice(&self.signature);
        let signature = Signature::from_bytes(&signature_bytes);

        verifying_key
            .verify_strict(&self.content, &signature)
            .map_err(|e| anyhow::anyhow!("Signature verification failed: {}", e))
    }

    /// Serialize to bytes for transmission
    pub fn to_bytes(&self) -> Result<Vec<u8>> {
        Ok(serde_json::to_vec(self)?)
    }

    /// Deserialize from bytes
    pub fn from_bytes(data: &[u8]) -> Result<Self> {
        Ok(serde_json::from_slice(data)?)
    }
}

/// Verify a signature using an arbitrary public key (not necessarily ours)
pub fn verify_with_key(message: &[u8], signature: &Signature, public_key: &[u8; 32]) -> Result<()> {
    let verifying_key = VerifyingKey::from_bytes(public_key)
        .map_err(|e| anyhow::anyhow!("Invalid public key: {}", e))?;
    verifying_key
        .verify_strict(message, signature)
        .map_err(|e| anyhow::anyhow!("Signature verification failed: {}", e))
}

/// A peer's public information stored locally
#[derive(Debug, Clone)]
pub struct PeerInfo {
    /// The peer's signing public key (Ed25519)
    pub signing_public_key: [u8; 32],
    /// The peer's encryption public key (X25519)
    pub encryption_public_key: [u8; 32],
    /// When we first connected to this peer
    pub first_seen: u64,
    /// Last activity timestamp
    pub last_seen: u64,
}

/// Manages cryptographic state including E2E encryption.
///
/// Uses `Arc<Identity>` internally — safe to share via `Arc<CryptoManager>`.
pub struct CryptoManager {
    /// The local peer's identity (signing) — shared via Arc, never cloned
    identity: Arc<Identity>,
    /// E2E encryption session manager
    session_manager: SessionManager,
    /// Known peers and their public keys
    pub known_peers: Arc<RwLock<HashMap<String, PeerInfo>>>,
}

impl CryptoManager {
    /// Create a new crypto manager
    pub fn new() -> Result<Self> {
        let identity = Arc::new(Identity::generate()?);
        let session_manager = SessionManager::new()?;
        Ok(Self {
            identity,
            session_manager,
            known_peers: Arc::new(RwLock::new(HashMap::new())),
        })
    }

    /// Create from existing identity
    pub fn from_identity(identity: Identity) -> Result<Self> {
        let session_manager = SessionManager::new()?;
        Ok(Self {
            identity: Arc::new(identity),
            session_manager,
            known_peers: Arc::new(RwLock::new(HashMap::new())),
        })
    }

    /// Get a reference to the identity
    pub fn identity(&self) -> &Identity {
        &self.identity
    }

    /// Get the peer ID
    pub fn peer_id(&self) -> String {
        self.identity.peer_id()
    }

    /// Get encryption public key bytes
    pub fn encryption_public_key(&self) -> [u8; 32] {
        self.session_manager.public_key_bytes()
    }

    /// Get signing public key bytes
    pub fn signing_public_key(&self) -> [u8; 32] {
        self.identity.public_key_bytes()
    }

    /// Get the ed25519 signing key bytes (for libp2p bridge)
    pub fn signing_key_bytes(&self) -> [u8; 32] {
        self.identity.signing_key_bytes()
    }

    /// Register a peer's keys
    pub async fn register_peer(
        &self,
        peer_id: String,
        signing_public_key: [u8; 32],
        encryption_public_key: [u8; 32],
    ) -> Result<()> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_secs();

        let peer_info = PeerInfo {
            signing_public_key,
            encryption_public_key,
            first_seen: now,
            last_seen: now,
        };

        // Establish E2E session with this peer
        self.session_manager
            .establish_session(&encryption_public_key)?;

        // Store peer info
        let mut peers = self.known_peers.write().await;
        peers.insert(peer_id, peer_info);

        Ok(())
    }

    /// Get a peer's info
    pub async fn get_peer(&self, peer_id: &str) -> Option<PeerInfo> {
        let peers = self.known_peers.read().await;
        peers.get(peer_id).cloned()
    }

    /// Sign a message
    pub fn sign(&self, message: &[u8]) -> Result<Signature> {
        self.identity.sign(message)
    }

    /// Verify a signature from a peer
    pub fn verify(&self, message: &[u8], signature: &Signature, public_key: &[u8; 32]) -> Result<()> {
        verify_with_key(message, signature, public_key)
    }

    /// Encrypt a message for a specific peer
    pub fn encrypt_for_peer(
        &self,
        peer_encryption_key: &[u8; 32],
        plaintext: &[u8],
    ) -> Result<crate::encryption::EncryptedMessage> {
        self.session_manager
            .encrypt_for_peer(peer_encryption_key, plaintext, None)
    }

    /// Decrypt a message from a peer
    pub fn decrypt_from_peer(
        &self,
        encrypted: &crate::encryption::EncryptedMessage,
        peer_encryption_key: &[u8; 32],
    ) -> Result<Vec<u8>> {
        self.session_manager
            .decrypt_from_peer(encrypted, peer_encryption_key)
    }

    /// Create a signed and encrypted message for a specific peer
    pub async fn create_encrypted_signed_message(
        &self,
        plaintext: &[u8],
        peer_id: &str,
    ) -> Result<Vec<u8>> {
        let peer = self
            .get_peer(peer_id)
            .await
            .ok_or_else(|| anyhow::anyhow!("Peer not found: {}", peer_id))?;

        // Sign the plaintext
        let signed = SignedMessage::new(&self.identity, plaintext.to_vec())?;

        // Encrypt the signed message
        let encrypted = self.encrypt_for_peer(&peer.encryption_public_key, &signed.to_bytes()?)?;

        encrypted.to_bytes()
    }

    /// Decrypt and verify a message from a peer
    pub async fn decrypt_and_verify_message(
        &self,
        encrypted_bytes: &[u8],
        peer_id: &str,
    ) -> Result<Vec<u8>> {
        let peer = self
            .get_peer(peer_id)
            .await
            .ok_or_else(|| anyhow::anyhow!("Peer not found: {}", peer_id))?;

        let encrypted = crate::encryption::EncryptedMessage::from_bytes(encrypted_bytes)?;
        let decrypted = self.decrypt_from_peer(&encrypted, &peer.encryption_public_key)?;

        let signed = SignedMessage::from_bytes(&decrypted)?;
        signed.verify()?;

        // Verify the sender's public key matches the registered peer
        if signed.sender_public_key != peer.signing_public_key.to_vec() {
            return Err(anyhow::anyhow!(
                "Message sender public key doesn't match registered peer"
            ));
        }

        Ok(signed.content)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_identity_generation() {
        let identity = Identity::generate().unwrap();
        assert!(!identity.peer_id().is_empty());
        assert_eq!(identity.public_key().len(), 32);
    }

    #[test]
    fn test_sign_and_verify() {
        let identity = Identity::generate().unwrap();
        let message = b"Hello, OpenWire!";
        let signature = identity.sign(message).unwrap();
        assert!(identity.verify(message, &signature).is_ok());
    }

    #[test]
    fn test_sign_verify_wrong_message() {
        let identity = Identity::generate().unwrap();
        let message = b"Hello, OpenWire!";
        let wrong_message = b"Tampered message!";
        let signature = identity.sign(message).unwrap();
        assert!(identity.verify(wrong_message, &signature).is_err());
    }

    #[test]
    fn test_identity_serialization_roundtrip() {
        let identity = Identity::generate().unwrap();
        let bytes = identity.to_bytes();
        let restored = Identity::from_bytes(bytes).unwrap();
        assert_eq!(identity.peer_id(), restored.peer_id());
    }

    #[test]
    fn test_signed_message_verification() {
        let identity = Identity::generate().unwrap();
        let content = b"Test message content".to_vec();
        let signed = SignedMessage::new(&identity, content).unwrap();

        // Should verify successfully
        assert!(signed.verify().is_ok());

        // Tampered message should fail
        let mut tampered = signed.clone();
        tampered.content[0] ^= 0xFF;
        assert!(tampered.verify().is_err());
    }

    #[test]
    fn test_signed_message_serialization_roundtrip() {
        let identity = Identity::generate().unwrap();
        let content = b"Roundtrip test".to_vec();
        let signed = SignedMessage::new(&identity, content).unwrap();

        let bytes = signed.to_bytes().unwrap();
        let restored = SignedMessage::from_bytes(&bytes).unwrap();
        assert!(restored.verify().is_ok());
        assert_eq!(signed.content, restored.content);
    }

    #[tokio::test]
    async fn test_crypto_manager_encryption() {
        let alice = CryptoManager::new().unwrap();
        let bob = CryptoManager::new().unwrap();

        // Register each other
        alice
            .register_peer(
                bob.peer_id(),
                bob.signing_public_key(),
                bob.encryption_public_key(),
            )
            .await
            .unwrap();

        bob.register_peer(
            alice.peer_id(),
            alice.signing_public_key(),
            alice.encryption_public_key(),
        )
        .await
        .unwrap();

        // Alice sends encrypted message to Bob
        let plaintext = b"Secret message from Alice";
        let encrypted = alice
            .create_encrypted_signed_message(plaintext, &bob.peer_id())
            .await
            .unwrap();

        // Bob decrypts and verifies
        let decrypted = bob
            .decrypt_and_verify_message(&encrypted, &alice.peer_id())
            .await
            .unwrap();

        assert_eq!(plaintext.to_vec(), decrypted);
    }

    #[test]
    fn test_verify_with_key() {
        let identity = Identity::generate().unwrap();
        let message = b"Verify with external key";
        let signature = identity.sign(message).unwrap();

        let pub_key = identity.public_key_bytes();
        assert!(verify_with_key(message, &signature, &pub_key).is_ok());
    }
}
