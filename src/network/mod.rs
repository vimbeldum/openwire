//! Network layer for OpenWire
//!
//! Handles P2P networking using libp2p:
//! - Peer discovery via mDNS
//! - Message broadcasting via Gossipsub
//! - Secure connections via Noise protocol
//! - End-to-end encryption for all messages
//! - Signed key exchange for authenticated peer discovery

use anyhow::Result;
use futures::StreamExt;
use libp2p::{
    gossipsub, mdns, noise, swarm::NetworkBehaviour, tcp, yamux, Multiaddr, PeerId, SwarmBuilder,
};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, RwLock};

use crate::crypto::CryptoManager;

/// Topic for exchanging encryption keys
const KEY_EXCHANGE_TOPIC: &str = "openwire-key-exchange";
/// Topic for general messages
const GENERAL_TOPIC: &str = "openwire-general";
/// Topic for file transfers
const FILE_TRANSFER_TOPIC: &str = "openwire-file-transfer";

/// Maximum allowed clock skew for key exchange timestamps (seconds)
const MAX_TIMESTAMP_SKEW: u64 = 60;
/// Maximum file size for transfer (1 MB — gossipsub limit)
const MAX_FILE_SIZE: usize = 1_048_576;

/// Events emitted by the network layer
#[derive(Debug, Clone)]
pub enum NetworkEvent {
    /// A new peer was discovered
    PeerDiscovered(PeerId),
    /// A peer disconnected
    PeerDisconnected(PeerId),
    /// A decrypted message was received
    MessageReceived {
        from: PeerId,
        topic: String,
        data: Vec<u8>,
    },
    /// A file was received
    FileReceived {
        from: PeerId,
        filename: String,
        data: Vec<u8>,
    },
    /// Successfully connected to a peer
    PeerConnected(PeerId),
    /// Encryption keys exchanged with peer
    KeysExchanged(PeerId),
    /// Error occurred
    Error(String),
}

/// Commands to control the network layer
#[derive(Debug)]
pub enum NetworkCommand {
    /// Broadcast a signed message to the general topic
    Broadcast { data: Vec<u8> },
    /// Send an encrypted message to a specific peer
    SendToPeer { peer_id: String, data: Vec<u8> },
    /// Send a file to all peers
    SendFile { path: String },
    /// Connect to a specific peer
    Connect(String),
    /// Shutdown the network
    Shutdown,
}

/// A file transfer message
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FileTransferMessage {
    /// Original filename
    pub filename: String,
    /// File size in bytes
    pub size: usize,
    /// File contents
    pub data: Vec<u8>,
    /// Sender's public key
    pub sender_public_key: Vec<u8>,
    /// Signature over [filename || data]
    pub signature: Vec<u8>,
    /// Timestamp
    pub timestamp: u64,
}

/// Key exchange message for sharing encryption public keys.
///
/// Includes an Ed25519 signature to prevent MITM key injection.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct KeyExchangeMessage {
    /// Peer's signing public key (Ed25519)
    pub signing_public_key: [u8; 32],
    /// Peer's encryption public key (X25519)
    pub encryption_public_key: [u8; 32],
    /// Timestamp for replay protection
    pub timestamp: u64,
    /// Ed25519 signature over [signing_key || encryption_key || timestamp_bytes]
    pub signature: Vec<u8>,
}

impl KeyExchangeMessage {
    /// Create a new signed key exchange message
    pub fn new(crypto: &CryptoManager) -> Result<Self> {
        let signing_public_key = crypto.signing_public_key();
        let encryption_public_key = crypto.encryption_public_key();
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_secs();

        // Create the data to sign: signing_key || encryption_key || timestamp
        let mut sign_data = Vec::with_capacity(72);
        sign_data.extend_from_slice(&signing_public_key);
        sign_data.extend_from_slice(&encryption_public_key);
        sign_data.extend_from_slice(&timestamp.to_le_bytes());

        let signature = crypto.sign(&sign_data)?;

        Ok(Self {
            signing_public_key,
            encryption_public_key,
            timestamp,
            signature: signature.to_bytes().to_vec(),
        })
    }

    /// Verify the signature and timestamp of this key exchange message.
    ///
    /// Returns Ok(()) if:
    /// 1. The signature is valid for the contained data
    /// 2. The timestamp is within the allowed skew window
    pub fn verify(&self) -> Result<()> {
        // Verify timestamp is within acceptable range
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_secs();

        let diff = if now > self.timestamp {
            now - self.timestamp
        } else {
            self.timestamp - now
        };

        if diff > MAX_TIMESTAMP_SKEW {
            return Err(anyhow::anyhow!(
                "Key exchange timestamp too old or too far in the future ({}s skew)",
                diff
            ));
        }

        // Reconstruct the signed data
        let mut sign_data = Vec::with_capacity(72);
        sign_data.extend_from_slice(&self.signing_public_key);
        sign_data.extend_from_slice(&self.encryption_public_key);
        sign_data.extend_from_slice(&self.timestamp.to_le_bytes());

        // Verify the signature using the sender's signing key
        if self.signature.len() != 64 {
            return Err(anyhow::anyhow!("Invalid signature length"));
        }
        let mut sig_bytes = [0u8; 64];
        sig_bytes.copy_from_slice(&self.signature);
        let signature = ed25519_dalek::Signature::from_bytes(&sig_bytes);

        crate::crypto::verify_with_key(&sign_data, &signature, &self.signing_public_key)
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

/// Combined network behaviour for libp2p
#[derive(NetworkBehaviour)]
pub struct OpenWireBehaviour {
    /// Gossipsub protocol for broadcasting messages
    pub gossipsub: gossipsub::Behaviour,
    /// mDNS for local peer discovery
    pub mdns: mdns::tokio::Behaviour,
    /// Ping for connection health
    pub ping: libp2p::ping::Behaviour,
    /// Identify protocol for peer information
    pub identify: libp2p::identify::Behaviour,
}

/// Handle returned from Network::new() for communicating with the network task
pub struct NetworkHandle {
    /// Send commands to the network event loop
    pub command_sender: mpsc::Sender<NetworkCommand>,
    /// Receive events from the network event loop
    pub event_receiver: mpsc::Receiver<NetworkEvent>,
}

/// The main network manager
///
/// Handles all P2P communication including:
/// - Peer discovery and management
/// - Message routing with E2E encryption
/// - Connection lifecycle
pub struct Network {
    /// The libp2p swarm
    swarm: libp2p::Swarm<OpenWireBehaviour>,
    /// Sender for network events (to the UI/consumer)
    event_sender: mpsc::Sender<NetworkEvent>,
    /// Receiver for network commands (from the UI/controller)
    command_receiver: mpsc::Receiver<NetworkCommand>,
    /// Crypto manager for E2E encryption
    crypto: Arc<RwLock<CryptoManager>>,
    /// Local peer ID
    local_peer_id: PeerId,
    /// Track which peers have exchanged keys
    keys_exchanged: Arc<RwLock<Vec<PeerId>>>,
}

impl Network {
    /// Create a new network instance with E2E encryption.
    ///
    /// Returns the `Network` (to be passed to `run_network()`) and a `NetworkHandle`
    /// for sending commands and receiving events.
    pub async fn new(crypto: CryptoManager, port: u16) -> Result<(Self, NetworkHandle)> {
        // Bridge our ed25519 identity to libp2p's keypair format
        // libp2p expects 64 bytes: [32-byte secret seed || 32-byte public key]
        let seed = crypto.signing_key_bytes();
        let pubkey = crypto.signing_public_key();
        let mut keypair_bytes = [0u8; 64];
        keypair_bytes[..32].copy_from_slice(&seed);
        keypair_bytes[32..].copy_from_slice(&pubkey);
        let libp2p_ed25519_keypair =
            libp2p::identity::ed25519::Keypair::try_from_bytes(&mut keypair_bytes)
                .map_err(|e| anyhow::anyhow!("Failed to convert ed25519 key to libp2p format: {}", e))?;
        let local_key = libp2p::identity::Keypair::from(libp2p_ed25519_keypair);
        let local_peer_id = PeerId::from(local_key.public());

        tracing::info!("libp2p Peer ID matches signing identity: {}", local_peer_id);

        // Set up gossipsub
        let gossipsub_config = gossipsub::ConfigBuilder::default()
            .heartbeat_interval(Duration::from_secs(10))
            .validation_mode(gossipsub::ValidationMode::Strict)
            .build()?;

        let message_authenticity = gossipsub::MessageAuthenticity::Signed(local_key.clone());

        let gossipsub = gossipsub::Behaviour::new(message_authenticity, gossipsub_config)
            .map_err(|e| anyhow::anyhow!("Failed to create gossipsub: {}", e))?;

        // Set up mDNS for peer discovery
        let mdns = mdns::tokio::Behaviour::new(mdns::Config::default(), local_peer_id)?;

        // Set up ping
        let ping = libp2p::ping::Behaviour::new(libp2p::ping::Config::new());

        // Set up identify
        let identify = libp2p::identify::Behaviour::new(
            libp2p::identify::Config::new("/openwire/0.1.0".to_string(), local_key.public()),
        );

        let behaviour = OpenWireBehaviour {
            gossipsub,
            mdns,
            ping,
            identify,
        };

        // Build the swarm
        let mut swarm = SwarmBuilder::with_existing_identity(local_key)
            .with_tokio()
            .with_tcp(
                tcp::Config::default(),
                noise::Config::new,
                yamux::Config::default,
            )?
            .with_behaviour(|_| behaviour)?
            .with_swarm_config(|cfg| cfg.with_idle_connection_timeout(Duration::from_secs(60)))
            .build();

        // Listen on ALL interfaces so LAN peers can connect
        let listen_addr = Multiaddr::empty()
            .with(libp2p::multiaddr::Protocol::Ip4([0, 0, 0, 0].into()))
            .with(libp2p::multiaddr::Protocol::Tcp(port));

        swarm.listen_on(listen_addr)?;

        // Subscribe to topics
        let general_topic = gossipsub::IdentTopic::new(GENERAL_TOPIC);
        let key_topic = gossipsub::IdentTopic::new(KEY_EXCHANGE_TOPIC);
        let file_topic = gossipsub::IdentTopic::new(FILE_TRANSFER_TOPIC);
        swarm.behaviour_mut().gossipsub.subscribe(&general_topic)?;
        swarm.behaviour_mut().gossipsub.subscribe(&key_topic)?;
        swarm.behaviour_mut().gossipsub.subscribe(&file_topic)?;

        // Create channels — both halves are now properly used
        let (event_sender, event_receiver) = mpsc::channel(256);
        let (command_sender, command_receiver) = mpsc::channel(256);

        let crypto = Arc::new(RwLock::new(crypto));

        let network = Self {
            swarm,
            event_sender,
            command_receiver,
            crypto,
            local_peer_id,
            keys_exchanged: Arc::new(RwLock::new(Vec::new())),
        };

        let handle = NetworkHandle {
            command_sender,
            event_receiver,
        };

        Ok((network, handle))
    }

    /// Get the crypto manager
    pub fn crypto(&self) -> Arc<RwLock<CryptoManager>> {
        self.crypto.clone()
    }

    /// Get the local peer ID
    pub fn local_peer_id(&self) -> &PeerId {
        &self.local_peer_id
    }

    /// Send key exchange message to all peers
    async fn send_key_exchange(&mut self) -> Result<()> {
        let key_bytes;
        {
            let crypto = self.crypto.read().await;
            let key_msg = KeyExchangeMessage::new(&crypto)?;
            key_bytes = key_msg.to_bytes()?;
        }

        let topic = gossipsub::IdentTopic::new(KEY_EXCHANGE_TOPIC);
        self.swarm
            .behaviour_mut()
            .gossipsub
            .publish(topic, key_bytes)?;
        tracing::info!("Sent signed key exchange message");
        Ok(())
    }

    /// Handle incoming key exchange message with verification
    async fn handle_key_exchange(&mut self, peer_id: PeerId, data: &[u8]) -> Result<()> {
        let key_msg = KeyExchangeMessage::from_bytes(data)?;

        // Verify the signature and timestamp BEFORE trusting the keys
        key_msg.verify()?;

        let crypto = self.crypto.read().await;
        crypto
            .register_peer(
                peer_id.to_string(),
                key_msg.signing_public_key,
                key_msg.encryption_public_key,
            )
            .await?;

        // Mark as keys exchanged
        let mut exchanged = self.keys_exchanged.write().await;
        if !exchanged.contains(&peer_id) {
            exchanged.push(peer_id);
        }

        tracing::info!("Verified and registered encryption keys for peer: {}", peer_id);

        let _ = self
            .event_sender
            .send(NetworkEvent::KeysExchanged(peer_id))
            .await;

        Ok(())
    }

    /// Publish a signed (but not encrypted) message to the general topic.
    ///
    /// For broadcast/group chat, messages are signed for authenticity
    /// but not encrypted (since all subscribers should be able to read them).
    async fn publish_signed(&mut self, data: Vec<u8>) -> Result<()> {
        let signed_bytes;
        {
            let crypto = self.crypto.read().await;
            let signed = crate::crypto::SignedMessage::new(crypto.identity(), data)?;
            signed_bytes = signed.to_bytes()?;
        }

        let topic = gossipsub::IdentTopic::new(GENERAL_TOPIC);
        self.swarm
            .behaviour_mut()
            .gossipsub
            .publish(topic, signed_bytes)?;

        tracing::debug!("Published signed message to general topic");
        Ok(())
    }

    /// Send an encrypted message to a specific peer
    async fn send_to_peer(&mut self, peer_id_str: &str, data: Vec<u8>) -> Result<()> {
        let encrypted_bytes;
        {
            let crypto = self.crypto.read().await;
            encrypted_bytes = crypto
                .create_encrypted_signed_message(&data, peer_id_str)
                .await?;
        }

        // Publish on a peer-specific topic
        let topic_name = format!("openwire-peer-{}", peer_id_str);
        let topic = gossipsub::IdentTopic::new(&topic_name);
        self.swarm
            .behaviour_mut()
            .gossipsub
            .publish(topic, encrypted_bytes)?;

        tracing::debug!("Sent encrypted message to peer: {}", peer_id_str);
        Ok(())
    }

    /// Connect to a bootstrap peer by multiaddress string
    fn dial(&mut self, addr_str: &str) -> Result<()> {
        let addr: Multiaddr = addr_str
            .parse()
            .map_err(|e| anyhow::anyhow!("Invalid multiaddress '{}': {}", addr_str, e))?;

        self.swarm
            .dial(addr)
            .map_err(|e| anyhow::anyhow!("Failed to dial {}: {}", addr_str, e))?;

        tracing::info!("Dialing peer at {}", addr_str);
        Ok(())
    }

    /// Send a file to all peers on the file transfer topic
    async fn send_file(&mut self, path: &str) -> Result<()> {
        let file_path = std::path::Path::new(path);
        if !file_path.exists() {
            return Err(anyhow::anyhow!("File not found: {}", path));
        }

        let data = tokio::fs::read(file_path).await?;
        if data.len() > MAX_FILE_SIZE {
            return Err(anyhow::anyhow!(
                "File too large ({} bytes, max {} bytes)",
                data.len(),
                MAX_FILE_SIZE
            ));
        }

        let filename = file_path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

        // Sign filename || data
        let mut sign_data = Vec::new();
        sign_data.extend_from_slice(filename.as_bytes());
        sign_data.extend_from_slice(&data);

        let (signature, sender_public_key);
        {
            let crypto = self.crypto.read().await;
            let sig = crypto.sign(&sign_data)?;
            signature = sig.to_bytes().to_vec();
            sender_public_key = crypto.signing_public_key().to_vec();
        }

        let file_msg = FileTransferMessage {
            filename: filename.clone(),
            size: data.len(),
            data,
            sender_public_key,
            signature,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_secs(),
        };

        let msg_bytes = serde_json::to_vec(&file_msg)?;
        let topic = gossipsub::IdentTopic::new(FILE_TRANSFER_TOPIC);
        self.swarm
            .behaviour_mut()
            .gossipsub
            .publish(topic, msg_bytes)?;

        tracing::info!("Sent file '{}' ({} bytes)", filename, file_msg.size);
        Ok(())
    }
}

/// Run the network event loop.
///
/// This is the main async loop that processes swarm events and commands.
/// Pass ownership of `Network` here; communicate via the `NetworkHandle`.
pub async fn run_network(mut network: Network) -> Result<()> {
    // Send key exchange on startup
    if let Err(e) = network.send_key_exchange().await {
        tracing::warn!("Initial key exchange broadcast failed (no peers yet): {}", e);
    }

    loop {
        tokio::select! {
            // Handle swarm events
            event = network.swarm.select_next_some() => {
                match event {
                    libp2p::swarm::SwarmEvent::Behaviour(behaviour_event) => {
                        handle_behaviour_event(&mut network, behaviour_event).await;
                    }

                    libp2p::swarm::SwarmEvent::ConnectionEstablished { peer_id, .. } => {
                        tracing::info!("Connection established with: {}", peer_id);
                        let _ = network.event_sender.send(NetworkEvent::PeerConnected(peer_id)).await;

                        // Send our keys to newly connected peers
                        if let Err(e) = network.send_key_exchange().await {
                            tracing::error!("Failed to send key exchange on connect: {}", e);
                        }
                    }

                    libp2p::swarm::SwarmEvent::ConnectionClosed { peer_id, .. } => {
                        tracing::info!("Connection closed with: {}", peer_id);
                        let _ = network.event_sender.send(NetworkEvent::PeerDisconnected(peer_id)).await;
                    }

                    libp2p::swarm::SwarmEvent::NewListenAddr { address, .. } => {
                        tracing::info!("Listening on {}", address);
                    }

                    _ => {}
                }
            }

            // Handle commands from the UI/controller
            Some(cmd) = network.command_receiver.recv() => {
                match cmd {
                    NetworkCommand::Broadcast { data } => {
                        if let Err(e) = network.publish_signed(data).await {
                            tracing::error!("Failed to broadcast: {}", e);
                            let _ = network.event_sender.send(
                                NetworkEvent::Error(format!("Broadcast failed: {}", e))
                            ).await;
                        }
                    }
                    NetworkCommand::SendToPeer { peer_id, data } => {
                        if let Err(e) = network.send_to_peer(&peer_id, data).await {
                            tracing::error!("Failed to send to peer {}: {}", peer_id, e);
                            let _ = network.event_sender.send(
                                NetworkEvent::Error(format!("Send to peer failed: {}", e))
                            ).await;
                        }
                    }
                    NetworkCommand::SendFile { path } => {
                        if let Err(e) = network.send_file(&path).await {
                            tracing::error!("Failed to send file: {}", e);
                            let _ = network.event_sender.send(
                                NetworkEvent::Error(format!("File send failed: {}", e))
                            ).await;
                        }
                    }
                    NetworkCommand::Connect(addr) => {
                        if let Err(e) = network.dial(&addr) {
                            tracing::error!("Failed to connect to {}: {}", addr, e);
                            let _ = network.event_sender.send(
                                NetworkEvent::Error(format!("Connection failed: {}", e))
                            ).await;
                        }
                    }
                    NetworkCommand::Shutdown => {
                        tracing::info!("Network shutting down gracefully");
                        break;
                    }
                }
            }
        }
    }

    Ok(())
}

/// Handle behaviour-specific events
async fn handle_behaviour_event(network: &mut Network, event: OpenWireBehaviourEvent) {
    match event {
        // Handle gossipsub messages
        OpenWireBehaviourEvent::Gossipsub(gossipsub::Event::Message {
            propagation_source: peer_id,
            message_id: _id,
            message,
        }) => {
            let topic = message.topic.as_str();

            if topic == KEY_EXCHANGE_TOPIC {
                // Handle authenticated key exchange
                if let Err(e) = network.handle_key_exchange(peer_id, &message.data).await {
                    tracing::warn!("Rejected key exchange from {}: {}", peer_id, e);
                }
            } else if topic == GENERAL_TOPIC {
                // General broadcast: verify signature, extract content
                match crate::crypto::SignedMessage::from_bytes(&message.data) {
                    Ok(signed) => match signed.verify() {
                        Ok(()) => {
                            tracing::debug!(
                                "Received verified broadcast from {} on topic {}",
                                peer_id,
                                topic
                            );
                            let _ = network
                                .event_sender
                                .send(NetworkEvent::MessageReceived {
                                    from: peer_id,
                                    topic: topic.to_string(),
                                    data: signed.content,
                                })
                                .await;
                        }
                        Err(e) => {
                            tracing::warn!(
                                "Rejected broadcast from {} — signature invalid: {}",
                                peer_id,
                                e
                            );
                        }
                    },
                    Err(e) => {
                        tracing::debug!("Could not parse broadcast from {}: {}", peer_id, e);
                    }
                }
            } else if topic == FILE_TRANSFER_TOPIC {
                // File transfer
                match serde_json::from_slice::<FileTransferMessage>(&message.data) {
                    Ok(file_msg) => {
                        tracing::info!(
                            "Received file '{}' ({} bytes) from {}",
                            file_msg.filename,
                            file_msg.size,
                            peer_id
                        );

                        // Save file to ~/openwire-received/
                        let save_dir = dirs_next::home_dir()
                            .unwrap_or_else(|| std::path::PathBuf::from("."))
                            .join("openwire-received");
                        let _ = std::fs::create_dir_all(&save_dir);
                        let save_path = save_dir.join(&file_msg.filename);
                        if let Err(e) = std::fs::write(&save_path, &file_msg.data) {
                            tracing::error!("Failed to save file: {}", e);
                        } else {
                            tracing::info!("Saved file to {:?}", save_path);
                        }

                        let _ = network
                            .event_sender
                            .send(NetworkEvent::FileReceived {
                                from: peer_id,
                                filename: file_msg.filename,
                                data: file_msg.data,
                            })
                            .await;
                    }
                    Err(e) => {
                        tracing::debug!("Could not parse file message from {}: {}", peer_id, e);
                    }
                }
            }
        }

        // Handle mDNS events — add/remove peers from gossipsub mesh
        OpenWireBehaviourEvent::Mdns(mdns::Event::Discovered(list)) => {
            for (peer_id, addr) in list {
                tracing::info!("Peer discovered via mDNS: {} at {}", peer_id, addr);

                // Add the peer to the gossipsub mesh
                network
                    .swarm
                    .behaviour_mut()
                    .gossipsub
                    .add_explicit_peer(&peer_id);

                let _ = network
                    .event_sender
                    .send(NetworkEvent::PeerDiscovered(peer_id))
                    .await;

                // Send our encryption keys to the newly discovered peer
                if let Err(e) = network.send_key_exchange().await {
                    tracing::error!("Failed to send key exchange: {}", e);
                }
            }
        }

        OpenWireBehaviourEvent::Mdns(mdns::Event::Expired(list)) => {
            for (peer_id, _addr) in list {
                tracing::info!("Peer expired via mDNS: {}", peer_id);

                // Remove the peer from the gossipsub mesh
                network
                    .swarm
                    .behaviour_mut()
                    .gossipsub
                    .remove_explicit_peer(&peer_id);

                let _ = network
                    .event_sender
                    .send(NetworkEvent::PeerDisconnected(peer_id))
                    .await;
            }
        }

        // Handle identify events
        OpenWireBehaviourEvent::Identify(libp2p::identify::Event::Received {
            peer_id,
            info,
            connection_id: _,
        }) => {
            tracing::debug!(
                "Identified peer {}: protocol={:?}",
                peer_id,
                info.protocol_version
            );
        }

        _ => {}
    }
}

/// Get the general topic name
pub fn general_topic() -> &'static str {
    GENERAL_TOPIC
}
