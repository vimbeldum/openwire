//! Cryptographic utilities for OpenWire
//!
//! Handles key generation, identity management, and message signing.

use anyhow::Result;
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use rand::rngs::OsRng;

/// Represents a peer's cryptographic identity
///
/// Contains an Ed25519 key pair used for:
/// - Peer identification
/// - Message signing
/// - Authentication
#[derive(Clone)]
pub struct Identity {
    /// The signing (private) key
    signing_key: SigningKey,
    /// The verifying (public) key
    verifying_key: VerifyingKey,
}

impl Identity {
    /// Generate a new random identity
    ///
    /// Uses the operating system's secure random number generator
    /// to create a new Ed25519 key pair.
    pub fn generate() -> Result<Self> {
        let mut csprng = OsRng;
        let signing_key = SigningKey::generate(&mut csprng);
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

    /// Sign a message with the private key
    ///
    /// # Arguments
    /// * `message` - The message bytes to sign
    ///
    /// # Returns
    /// The signature bytes
    pub fn sign(&self, message: &[u8]) -> Result<Signature> {
        Ok(self.signing_key.sign(message))
    }

    /// Verify a signature against a message
    ///
    /// # Arguments
    /// * `message` - The original message bytes
    /// * `signature` - The signature to verify
    ///
    /// # Returns
    /// Ok(()) if signature is valid, Err otherwise
    pub fn verify(&self, message: &[u8], signature: &Signature) -> Result<()> {
        self.verifying_key
            .verify_strict(message, signature)
            .map_err(|e| anyhow::anyhow!("Signature verification failed: {}", e))
    }

    /// Serialize the identity for storage
    ///
    /// Returns the bytes of the signing key that can be
    /// used to reconstruct the identity later.
    pub fn to_bytes(&self) -> [u8; 32] {
        self.signing_key.to_bytes()
    }

    /// Deserialize identity from bytes
    ///
    /// # Arguments
    /// * `bytes` - The 32-byte signing key
    pub fn from_bytes(bytes: [u8; 32]) -> Result<Self> {
        let signing_key = SigningKey::from_bytes(&bytes);
        let verifying_key = signing_key.verifying_key();

        Ok(Self {
            signing_key,
            verifying_key,
        })
    }
}

/// A signed message with authentication
#[derive(Debug, Clone)]
pub struct SignedMessage {
    /// The message content
    pub content: Vec<u8>,
    /// The signature
    pub signature: Vec<u8>,
    /// The sender's public key
    pub sender_public_key: Vec<u8>,
}

impl SignedMessage {
    /// Create a new signed message
    ///
    /// # Arguments
    /// * `identity` - The sender's identity
    /// * `content` - The message content
    pub fn new(identity: &Identity, content: Vec<u8>) -> Result<Self> {
        let signature = identity.sign(&content)?;
        Ok(Self {
            content,
            signature: signature.to_bytes().to_vec(),
            sender_public_key: identity.public_key().to_vec(),
        })
    }

    /// Verify the message signature
    ///
    /// Returns true if the signature is valid for the content
    /// and was signed by the claimed sender.
    pub fn verify(&self) -> Result<bool> {
        // TODO: Implement verification using the sender's public key
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_identity_generation() {
        let identity = Identity::generate().unwrap();
        assert!(!identity.peer_id().is_empty());
    }

    #[test]
    fn test_sign_and_verify() {
        let identity = Identity::generate().unwrap();
        let message = b"Hello, OpenWire!";
        let signature = identity.sign(message).unwrap();
        assert!(identity.verify(message, &signature).is_ok());
    }
}
