//! Private Group Chat Rooms for OpenWire
//!
//! Provides room-based encrypted group messaging:
//! - Room creation with unique IDs and shared group keys
//! - Peer invitation system
//! - Room-specific message encryption using the group key
//! - Room management (create, join, leave, invite)

#![allow(dead_code)] // Some functions are for future use or testing

use anyhow::Result;
use chacha20poly1305::{
    aead::{Aead, KeyInit},
    ChaCha20Poly1305, Nonce,
};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::crypto::Identity;

/// Size of the group encryption key (ChaCha20-Poly1305)
pub const GROUP_KEY_SIZE: usize = 32;

/// Size of the nonce for encryption
pub const NONCE_SIZE: usize = 12;

/// A unique room identifier (human-readable)
pub type RoomId = String;

// ============================================================================
// Helper functions for encrypting invites (must be defined before use)
// ============================================================================

/// Encrypt data for a peer using their X25519 public key
fn invite_key_encrypt(plaintext: &[u8], their_public: &[u8; 32]) -> Result<Vec<u8>> {
    use hkdf::Hkdf;
    use sha2::Sha256;
    use x25519_dalek::{EphemeralSecret, PublicKey};

    let their_public = PublicKey::from(*their_public);

    // Generate ephemeral key for forward secrecy
    let ephemeral = EphemeralSecret::random_from_rng(OsRng);
    let ephemeral_public = PublicKey::from(&ephemeral);

    // Perform DH
    let shared = *ephemeral.diffie_hellman(&their_public).as_bytes();

    // Derive key with HKDF
    let mut salt = [0u8; 32];
    OsRng.fill_bytes(&mut salt);
    let hkdf = Hkdf::<Sha256>::new(Some(&salt), &shared);
    let mut key = [0u8; 32];
    hkdf.expand(b"openwire-room-invite", &mut key)
        .map_err(|e| anyhow::anyhow!("HKDF failed: {}", e))?;

    // Encrypt
    let mut nonce = [0u8; 12];
    OsRng.fill_bytes(&mut nonce);

    let cipher = ChaCha20Poly1305::new_from_slice(&key)
        .map_err(|e| anyhow::anyhow!("Cipher creation failed: {}", e))?;

    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce), plaintext)
        .map_err(|e| anyhow::anyhow!("Encryption failed: {}", e))?;

    // Format: ephemeral_pubkey (32) || salt (32) || nonce (12) || ciphertext
    let mut result = Vec::with_capacity(32 + 32 + 12 + ciphertext.len());
    result.extend_from_slice(ephemeral_public.as_bytes());
    result.extend_from_slice(&salt);
    result.extend_from_slice(&nonce);
    result.extend_from_slice(&ciphertext);

    key.zeroize();
    Ok(result)
}

/// Decrypt data encrypted with our X25519 public key
fn invite_key_decrypt(encrypted: &[u8], private_key: &[u8; 32]) -> Result<Vec<u8>> {
    use hkdf::Hkdf;
    use sha2::Sha256;
    use x25519_dalek::{PublicKey, StaticSecret};

    if encrypted.len() < 32 + 32 + 12 + 16 {
        return Err(anyhow::anyhow!("Encrypted data too short"));
    }

    let ephemeral_public = PublicKey::from(<[u8; 32]>::try_from(&encrypted[..32]).unwrap());
    let salt = &encrypted[32..64];
    let nonce = &encrypted[64..76];
    let ciphertext = &encrypted[76..];

    // Perform DH with our private key
    let secret = StaticSecret::from(*private_key);
    let shared = *secret.diffie_hellman(&ephemeral_public).as_bytes();

    // Derive key
    let hkdf = Hkdf::<Sha256>::new(Some(salt), &shared);
    let mut key = [0u8; 32];
    hkdf.expand(b"openwire-room-invite", &mut key)
        .map_err(|e| anyhow::anyhow!("HKDF failed: {}", e))?;

    // Decrypt
    let cipher = ChaCha20Poly1305::new_from_slice(&key)
        .map_err(|e| anyhow::anyhow!("Cipher creation failed: {}", e))?;

    let plaintext = cipher
        .decrypt(Nonce::from_slice(nonce), ciphertext)
        .map_err(|e| anyhow::anyhow!("Decryption failed: {}", e))?;

    key.zeroize();
    Ok(plaintext)
}

// ============================================================================
// Core types
// ============================================================================

/// A shared group key for room encryption.
///
/// This key is used to encrypt all messages within a room.
/// It's distributed to invited peers via encrypted key exchange.
#[derive(ZeroizeOnDrop)]
pub struct GroupKey(pub [u8; GROUP_KEY_SIZE]);

impl std::fmt::Debug for GroupKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("GroupKey([REDACTED])")
    }
}

impl GroupKey {
    /// Generate a new random group key
    pub fn generate() -> Self {
        let mut key = [0u8; GROUP_KEY_SIZE];
        OsRng.fill_bytes(&mut key);
        Self(key)
    }

    /// Create from bytes
    pub fn from_bytes(bytes: [u8; GROUP_KEY_SIZE]) -> Self {
        Self(bytes)
    }

    /// Get the key bytes
    pub fn as_bytes(&self) -> &[u8; GROUP_KEY_SIZE] {
        &self.0
    }

    /// Encrypt a message for the room
    pub fn encrypt(&self, plaintext: &[u8]) -> Result<EncryptedRoomMessage> {
        let mut nonce_bytes = [0u8; NONCE_SIZE];
        OsRng.fill_bytes(&mut nonce_bytes);

        let cipher = ChaCha20Poly1305::new_from_slice(&self.0)
            .map_err(|e| anyhow::anyhow!("Failed to create cipher: {}", e))?;

        let ciphertext = cipher
            .encrypt(Nonce::from_slice(&nonce_bytes), plaintext)
            .map_err(|e| anyhow::anyhow!("Encryption failed: {}", e))?;

        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_secs();

        Ok(EncryptedRoomMessage {
            nonce: nonce_bytes,
            ciphertext,
            timestamp,
        })
    }

    /// Decrypt a room message
    pub fn decrypt(&self, encrypted: &EncryptedRoomMessage) -> Result<Vec<u8>> {
        let cipher = ChaCha20Poly1305::new_from_slice(&self.0)
            .map_err(|e| anyhow::anyhow!("Failed to create cipher: {}", e))?;

        let plaintext = cipher
            .decrypt(
                Nonce::from_slice(&encrypted.nonce),
                encrypted.ciphertext.as_slice(),
            )
            .map_err(|e| anyhow::anyhow!("Decryption failed: {}", e))?;

        Ok(plaintext)
    }
}

impl Clone for GroupKey {
    fn clone(&self) -> Self {
        let mut key = [0u8; GROUP_KEY_SIZE];
        key.copy_from_slice(&self.0);
        Self(key)
    }
}

/// An encrypted message for a room
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedRoomMessage {
    /// The nonce used for encryption
    pub nonce: [u8; NONCE_SIZE],
    /// The encrypted ciphertext
    pub ciphertext: Vec<u8>,
    /// Timestamp for ordering
    pub timestamp: u64,
}

impl EncryptedRoomMessage {
    /// Serialize to bytes
    pub fn to_bytes(&self) -> Result<Vec<u8>> {
        Ok(serde_json::to_vec(self)?)
    }

    /// Deserialize from bytes
    pub fn from_bytes(data: &[u8]) -> Result<Self> {
        Ok(serde_json::from_slice(data)?)
    }
}

/// A message inviting a peer to a room
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoomInvite {
    /// The room ID
    pub room_id: RoomId,
    /// The room name (human readable)
    pub room_name: String,
    /// The target peer ID (only this peer can accept the invite)
    pub target_peer_id: String,
    /// The encrypted group key (encrypted for the invitee)
    pub encrypted_key: Vec<u8>,
    /// The inviter's public key
    pub inviter_public_key: Vec<u8>,
    /// Timestamp
    pub timestamp: u64,
    /// Signature
    pub signature: Vec<u8>,
}

impl RoomInvite {
    /// Create a new room invite
    pub fn new(
        identity: &Identity,
        room_id: RoomId,
        room_name: String,
        target_peer_id: String,
        group_key: &GroupKey,
        invitee_encryption_key: &[u8; 32],
    ) -> Result<Self> {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_secs();

        // Encrypt the group key for the invitee
        let encrypted_key = invite_key_encrypt(group_key.as_bytes(), invitee_encryption_key)?;

        // Sign the invite data (includes target_peer_id for access control)
        let mut sign_data = Vec::new();
        sign_data.extend_from_slice(room_id.as_bytes());
        sign_data.extend_from_slice(room_name.as_bytes());
        sign_data.extend_from_slice(target_peer_id.as_bytes());
        sign_data.extend_from_slice(&encrypted_key);
        sign_data.extend_from_slice(&timestamp.to_le_bytes());

        let signature = identity.sign(&sign_data)?;

        Ok(Self {
            room_id,
            room_name,
            target_peer_id,
            encrypted_key,
            inviter_public_key: identity.public_key().to_vec(),
            timestamp,
            signature: signature.to_bytes().to_vec(),
        })
    }

    /// Verify the invite signature
    pub fn verify(&self) -> Result<()> {
        if self.inviter_public_key.len() != 32 {
            return Err(anyhow::anyhow!("Invalid inviter public key length"));
        }

        let mut pub_key_bytes = [0u8; 32];
        pub_key_bytes.copy_from_slice(&self.inviter_public_key);

        if self.signature.len() != 64 {
            return Err(anyhow::anyhow!("Invalid signature length"));
        }

        let mut sig_bytes = [0u8; 64];
        sig_bytes.copy_from_slice(&self.signature);

        let mut sign_data = Vec::new();
        sign_data.extend_from_slice(self.room_id.as_bytes());
        sign_data.extend_from_slice(self.room_name.as_bytes());
        sign_data.extend_from_slice(self.target_peer_id.as_bytes());
        sign_data.extend_from_slice(&self.encrypted_key);
        sign_data.extend_from_slice(&self.timestamp.to_le_bytes());

        crate::crypto::verify_with_key(
            &sign_data,
            &ed25519_dalek::Signature::from_bytes(&sig_bytes),
            &pub_key_bytes,
        )
    }

    /// Check if this invite is for a specific peer
    pub fn is_for_peer(&self, peer_id: &str) -> bool {
        self.target_peer_id == peer_id
    }

    /// Decrypt and extract the group key
    pub fn decrypt_key(&self, private_key: &[u8; 32]) -> Result<GroupKey> {
        let decrypted = invite_key_decrypt(&self.encrypted_key, private_key)?;
        if decrypted.len() != GROUP_KEY_SIZE {
            return Err(anyhow::anyhow!("Invalid decrypted key length"));
        }
        let mut key = [0u8; GROUP_KEY_SIZE];
        key.copy_from_slice(&decrypted);
        Ok(GroupKey(key))
    }

    /// Serialize to bytes
    pub fn to_bytes(&self) -> Result<Vec<u8>> {
        Ok(serde_json::to_vec(self)?)
    }

    /// Deserialize from bytes
    pub fn from_bytes(data: &[u8]) -> Result<Self> {
        Ok(serde_json::from_slice(data)?)
    }
}

/// A room message (after decryption)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoomMessage {
    /// The room ID this message belongs to
    pub room_id: RoomId,
    /// The sender's public key
    pub sender_public_key: Vec<u8>,
    /// The sender's nickname
    pub sender_nick: String,
    /// The message content
    pub content: Vec<u8>,
    /// Timestamp
    pub timestamp: u64,
    /// Signature over content
    pub signature: Vec<u8>,
}

impl RoomMessage {
    /// Create a new room message
    pub fn new(
        identity: &Identity,
        room_id: RoomId,
        sender_nick: String,
        content: Vec<u8>,
    ) -> Result<Self> {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_secs();

        // Sign: room_id || content || timestamp
        let mut sign_data = Vec::new();
        sign_data.extend_from_slice(room_id.as_bytes());
        sign_data.extend_from_slice(&content);
        sign_data.extend_from_slice(&timestamp.to_le_bytes());

        let signature = identity.sign(&sign_data)?;

        Ok(Self {
            room_id,
            sender_public_key: identity.public_key().to_vec(),
            sender_nick,
            content,
            timestamp,
            signature: signature.to_bytes().to_vec(),
        })
    }

    /// Verify the message signature
    pub fn verify(&self) -> Result<()> {
        if self.sender_public_key.len() != 32 {
            return Err(anyhow::anyhow!("Invalid sender public key length"));
        }

        let mut pub_key_bytes = [0u8; 32];
        pub_key_bytes.copy_from_slice(&self.sender_public_key);

        if self.signature.len() != 64 {
            return Err(anyhow::anyhow!("Invalid signature length"));
        }

        let mut sig_bytes = [0u8; 64];
        sig_bytes.copy_from_slice(&self.signature);

        let mut sign_data = Vec::new();
        sign_data.extend_from_slice(self.room_id.as_bytes());
        sign_data.extend_from_slice(&self.content);
        sign_data.extend_from_slice(&self.timestamp.to_le_bytes());

        crate::crypto::verify_with_key(
            &sign_data,
            &ed25519_dalek::Signature::from_bytes(&sig_bytes),
            &pub_key_bytes,
        )
    }

    /// Serialize to bytes
    pub fn to_bytes(&self) -> Result<Vec<u8>> {
        Ok(serde_json::to_vec(self)?)
    }

    /// Deserialize from bytes
    pub fn from_bytes(data: &[u8]) -> Result<Self> {
        Ok(serde_json::from_slice(data)?)
    }
}

/// A chat room
#[derive(Debug, Clone)]
pub struct Room {
    /// Unique room identifier
    pub id: RoomId,
    /// Human-readable room name
    pub name: String,
    /// The shared group key
    pub group_key: GroupKey,
    /// Set of peer IDs that are members
    pub members: HashSet<String>,
    /// Whether we created this room
    pub is_owner: bool,
    /// When we joined the room
    pub joined_at: u64,
}

impl Room {
    /// Create a new room
    pub fn new(name: String) -> Result<Self> {
        let id = Self::generate_room_id();
        let group_key = GroupKey::generate();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_secs();

        Ok(Self {
            id,
            name,
            group_key,
            members: HashSet::new(),
            is_owner: true,
            joined_at: now,
        })
    }

    /// Create a room from an invite
    pub fn from_invite(invite: RoomInvite, group_key: GroupKey) -> Result<Self> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_secs();

        Ok(Self {
            id: invite.room_id,
            name: invite.room_name,
            group_key,
            members: HashSet::new(),
            is_owner: false,
            joined_at: now,
        })
    }

    /// Generate a unique room ID
    fn generate_room_id() -> String {
        let mut bytes = [0u8; 8];
        OsRng.fill_bytes(&mut bytes);
        format!("room-{}", hex::encode(bytes))
    }

    /// Add a member to the room
    pub fn add_member(&mut self, peer_id: String) {
        self.members.insert(peer_id);
    }

    /// Remove a member from the room
    pub fn remove_member(&mut self, peer_id: &str) {
        self.members.remove(peer_id);
    }

    /// Check if a peer is a member
    pub fn is_member(&self, peer_id: &str) -> bool {
        self.members.contains(peer_id)
    }

    /// Get the gossipsub topic for this room
    pub fn topic(&self) -> String {
        format!("openwire-room-{}", self.id)
    }
}

/// Manages all rooms for the local peer
pub struct RoomManager {
    /// All rooms we're a member of
    rooms: HashMap<RoomId, Room>,
    /// Our encryption private key (for decrypting invites)
    encryption_private_key: [u8; 32],
}

impl RoomManager {
    /// Create a new room manager
    pub fn new(encryption_private_key: [u8; 32]) -> Self {
        Self {
            rooms: HashMap::new(),
            encryption_private_key,
        }
    }

    /// Create a new room
    pub fn create_room(&mut self, name: String) -> Result<&Room> {
        let room = Room::new(name)?;
        let id = room.id.clone();
        self.rooms.insert(id.clone(), room);
        Ok(self.rooms.get(&id).unwrap())
    }

    /// Join a room from an invite
    pub fn join_room(&mut self, invite: RoomInvite) -> Result<&Room> {
        invite.verify()?;
        let group_key = invite.decrypt_key(&self.encryption_private_key)?;
        let room = Room::from_invite(invite, group_key)?;
        let id = room.id.clone();
        self.rooms.insert(id.clone(), room);
        Ok(self.rooms.get(&id).unwrap())
    }

    /// Leave a room
    pub fn leave_room(&mut self, room_id: &str) -> Option<Room> {
        self.rooms.remove(room_id)
    }

    /// Get a room by ID
    pub fn get_room(&self, room_id: &str) -> Option<&Room> {
        self.rooms.get(room_id)
    }

    /// Get a mutable room by ID
    pub fn get_room_mut(&mut self, room_id: &str) -> Option<&mut Room> {
        self.rooms.get_mut(room_id)
    }

    /// Get all rooms
    pub fn get_all_rooms(&self) -> Vec<&Room> {
        self.rooms.values().collect()
    }

    /// Check if we're in a room
    pub fn in_room(&self, room_id: &str) -> bool {
        self.rooms.contains_key(room_id)
    }

    /// Get count of rooms
    pub fn room_count(&self) -> usize {
        self.rooms.len()
    }

    /// Create an invite for a peer (only room members can invite)
    pub fn create_invite(
        &self,
        room_id: &str,
        identity: &Identity,
        invitee_peer_id: &str,
        invitee_encryption_key: &[u8; 32],
    ) -> Result<RoomInvite> {
        let room = self
            .rooms
            .get(room_id)
            .ok_or_else(|| anyhow::anyhow!("Room not found: {}", room_id))?;

        // Note: We implicitly allow invite creation since we're in the room
        // (if we weren't, we wouldn't have the room in our rooms map)

        RoomInvite::new(
            identity,
            room.id.clone(),
            room.name.clone(),
            invitee_peer_id.to_string(),
            &room.group_key,
            invitee_encryption_key,
        )
    }

    /// Check if we can invite to a room (must be a member)
    pub fn can_invite_to_room(&self, room_id: &str) -> bool {
        self.rooms.contains_key(room_id)
    }

    /// Encrypt a message for a room
    pub fn encrypt_message(
        &self,
        room_id: &str,
        message: &RoomMessage,
    ) -> Result<EncryptedRoomMessage> {
        let room = self
            .rooms
            .get(room_id)
            .ok_or_else(|| anyhow::anyhow!("Room not found: {}", room_id))?;

        let plaintext = message.to_bytes()?;
        room.group_key.encrypt(&plaintext)
    }

    /// Decrypt a message from a room
    pub fn decrypt_message(
        &self,
        room_id: &str,
        encrypted: &EncryptedRoomMessage,
    ) -> Result<RoomMessage> {
        let room = self
            .rooms
            .get(room_id)
            .ok_or_else(|| anyhow::anyhow!("Room not found: {}", room_id))?;

        let plaintext = room.group_key.decrypt(encrypted)?;
        RoomMessage::from_bytes(&plaintext)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_group_key_encrypt_decrypt() {
        let key = GroupKey::generate();
        let plaintext = b"Hello, secret room!";

        let encrypted = key.encrypt(plaintext).unwrap();
        let decrypted = key.decrypt(&encrypted).unwrap();

        assert_eq!(plaintext.to_vec(), decrypted);
    }

    #[test]
    fn test_room_creation() {
        let room = Room::new("Test Room".to_string()).unwrap();

        assert!(room.id.starts_with("room-"));
        assert_eq!(room.name, "Test Room");
        assert!(room.is_owner);
        assert!(room.members.is_empty());
    }

    #[test]
    fn test_room_invite_roundtrip() {
        use x25519_dalek::{PublicKey, StaticSecret};

        let inviter = Identity::generate().unwrap();

        // Generate a proper X25519 keypair for the invitee
        let invitee_secret = StaticSecret::random_from_rng(OsRng);
        let invitee_public = PublicKey::from(&invitee_secret);
        let invitee_public_bytes = *invitee_public.as_bytes();
        let invitee_private_bytes = *invitee_secret.as_bytes();

        let room = Room::new("Secret Room".to_string()).unwrap();
        let target_peer_id = "12D3KooWTestPeerId".to_string();
        let invite = RoomInvite::new(
            &inviter,
            room.id.clone(),
            room.name.clone(),
            target_peer_id.clone(),
            &room.group_key,
            &invitee_public_bytes,
        )
        .unwrap();

        assert!(invite.verify().is_ok());
        assert!(invite.is_for_peer(&target_peer_id));
        assert!(!invite.is_for_peer("other-peer-id"));

        let decrypted_key = invite.decrypt_key(&invitee_private_bytes).unwrap();
        assert_eq!(room.group_key.as_bytes(), decrypted_key.as_bytes());
    }

    #[test]
    fn test_room_manager() {
        let mut manager = RoomManager::new([0u8; 32]);

        let room = manager.create_room("Test".to_string()).unwrap();
        let room_id = room.id.clone();
        assert!(room_id.starts_with("room-"));

        assert_eq!(manager.room_count(), 1);
        assert!(manager.in_room(&room_id));
    }

    #[test]
    fn test_room_message_signing() {
        let identity = Identity::generate().unwrap();
        let room_id = "room-test123".to_string();

        let msg = RoomMessage::new(
            &identity,
            room_id,
            "Alice".to_string(),
            b"Hello everyone!".to_vec(),
        )
        .unwrap();

        assert!(msg.verify().is_ok());
    }

    #[test]
    fn test_encrypted_room_message_roundtrip() {
        let identity = Identity::generate().unwrap();
        let mut manager = RoomManager::new([0u8; 32]);

        let room = manager.create_room("Test".to_string()).unwrap();
        let room_id = room.id.clone();

        let msg = RoomMessage::new(
            &identity,
            room_id.clone(),
            "Alice".to_string(),
            b"Secret message!".to_vec(),
        )
        .unwrap();

        let encrypted = manager.encrypt_message(&room_id, &msg).unwrap();
        let decrypted = manager.decrypt_message(&room_id, &encrypted).unwrap();

        assert_eq!(msg.content, decrypted.content);
        assert_eq!(msg.sender_nick, decrypted.sender_nick);
    }
}
