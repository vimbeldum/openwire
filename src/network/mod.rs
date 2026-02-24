//! Network layer for OpenWire
//!
//! Handles P2P networking using libp2p:
//! - Peer discovery via mDNS
//! - Message broadcasting via Gossipsub
//! - Secure connections via Noise protocol

use anyhow::Result;
use futures::StreamExt;
use libp2p::{
    gossipsub, mdns, noise, swarm::NetworkBehaviour, tcp, yamux, Multiaddr,
    PeerId, SwarmBuilder,
};
use std::time::Duration;
use tokio::sync::mpsc;

use crate::crypto::Identity;

/// Events emitted by the network layer
#[derive(Debug, Clone)]
pub enum NetworkEvent {
    /// A new peer was discovered
    PeerDiscovered(PeerId),
    /// A peer disconnected
    PeerDisconnected(PeerId),
    /// A message was received
    MessageReceived {
        from: PeerId,
        topic: String,
        data: Vec<u8>,
    },
    /// Successfully connected to a peer
    PeerConnected(PeerId),
}

/// Commands to control the network layer
#[derive(Debug, Clone)]
pub enum NetworkCommand {
    /// Broadcast a message to a topic
    Broadcast {
        topic: String,
        data: Vec<u8>,
    },
    /// Connect to a specific peer
    Connect(Multiaddr),
    /// Disconnect from a peer
    Disconnect(PeerId),
    /// Shutdown the network
    Shutdown,
}

/// Combined network behaviour for libp2p
///
/// This struct combines all the protocols we use:
/// - Gossipsub for message broadcasting
/// - mDNS for peer discovery
/// - Ping for keepalive
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

/// The main network manager
///
/// Handles all P2P communication including:
/// - Peer discovery and management
/// - Message routing
/// - Connection lifecycle
pub struct Network {
    /// The libp2p swarm
    swarm: libp2p::Swarm<OpenWireBehaviour>,
    /// Sender for network events
    event_sender: mpsc::Sender<NetworkEvent>,
    /// Receiver for network commands
    command_receiver: mpsc::Receiver<NetworkCommand>,
    /// The local peer's identity
    _identity: Identity,
    /// Local peer ID
    local_peer_id: PeerId,
}

impl Network {
    /// Create a new network instance
    ///
    /// # Arguments
    /// * `identity` - The cryptographic identity for this peer
    /// * `port` - The TCP port to listen on (0 for random)
    pub async fn new(identity: Identity, port: u16) -> Result<Self> {
        // Create keypair from identity
        // TODO: Convert our ed25519 key to libp2p's key format
        let local_key = libp2p::identity::Keypair::generate_ed25519();
        let local_peer_id = PeerId::from(local_key.public());

        // Set up gossipsub with proper message authenticity
        let gossipsub_config = gossipsub::ConfigBuilder::default()
            .heartbeat_interval(Duration::from_secs(10))
            .validation_mode(gossipsub::ValidationMode::Strict)
            .build()?;

        // Use signed message authenticity (author is verified)
        let message_authenticity = gossipsub::MessageAuthenticity::Signed(local_key.clone());

        let gossipsub = gossipsub::Behaviour::new(
            message_authenticity,
            gossipsub_config,
        ).map_err(|e| anyhow::anyhow!("Failed to create gossipsub: {}", e))?;

        // Set up mDNS for peer discovery
        let mdns = mdns::tokio::Behaviour::new(
            mdns::Config::default(),
            local_peer_id,
        )?;

        // Set up ping
        let ping = libp2p::ping::Behaviour::new(libp2p::ping::Config::new());

        // Set up identify
        let identify = libp2p::identify::Behaviour::new(
            libp2p::identify::Config::new("/openwire/0.1.0".to_string(), local_key.public()),
        );

        // Create the combined behaviour
        let behaviour = OpenWireBehaviour {
            gossipsub,
            mdns,
            ping,
            identify,
        };

        // Build the swarm
        let mut swarm = SwarmBuilder::with_existing_identity(local_key.clone())
            .with_tokio()
            .with_tcp(
                tcp::Config::default(),
                noise::Config::new,
                yamux::Config::default,
            )?
            .with_behaviour(|_| behaviour)?
            .with_swarm_config(|cfg| cfg.with_idle_connection_timeout(Duration::from_secs(60)))
            .build();

        // Listen on the specified port
        let listen_addr = Multiaddr::empty()
            .with(libp2p::multiaddr::Protocol::Ip4([127, 0, 0, 1].into()))
            .with(libp2p::multiaddr::Protocol::Tcp(port));
        
        swarm.listen_on(listen_addr)?;

        // Create channels for events and commands
        let (event_sender, _) = mpsc::channel(100);
        let (_command_sender, command_receiver) = mpsc::channel(100);

        Ok(Self {
            swarm,
            event_sender,
            command_receiver,
            _identity: identity,
            local_peer_id,
        })
    }

    /// Start the mDNS peer discovery
    pub fn start_discovery(&self) -> Result<()> {
        tracing::info!("Starting mDNS peer discovery");
        Ok(())
    }

    /// Connect to a bootstrap peer
    ///
    /// # Arguments
    /// * `addr` - The multiaddress of the peer to connect to
    pub async fn connect(&self, addr: &str) -> Result<()> {
        tracing::info!("Connecting to peer: {}", addr);
        // TODO: Implement connection logic
        Ok(())
    }

    /// Subscribe to a topic for receiving messages
    ///
    /// # Arguments
    /// * `topic` - The topic name to subscribe to
    pub fn subscribe(&mut self, topic: &str) -> Result<()> {
        let topic = gossipsub::IdentTopic::new(topic);
        self.swarm
            .behaviour_mut()
            .gossipsub
            .subscribe(&topic)?;
        tracing::info!("Subscribed to topic: {}", topic);
        Ok(())
    }

    /// Broadcast a message to a topic
    ///
    /// # Arguments
    /// * `topic` - The topic to publish to
    /// * `data` - The message data
    pub fn publish(&mut self, topic: &str, data: Vec<u8>) -> Result<()> {
        let topic = gossipsub::IdentTopic::new(topic);
        self.swarm
            .behaviour_mut()
            .gossipsub
            .publish(topic, data)?;
        Ok(())
    }

    /// Get the local peer ID
    pub fn local_peer_id(&self) -> &PeerId {
        &self.local_peer_id
    }

    /// Get list of connected peers
    pub fn connected_peers(&self) -> Vec<PeerId> {
        self.swarm.connected_peers().cloned().collect()
    }
}

/// Run the network event loop
///
/// This function processes incoming network events and commands.
pub async fn run_network(mut network: Network) -> Result<()> {
    loop {
        tokio::select! {
            // Handle swarm events
            event = network.swarm.select_next_some() => {
                match event {
                    // Handle different network events
                    _ => {}
                }
            }

            // Handle commands
            Some(cmd) = network.command_receiver.recv() => {
                match cmd {
                    NetworkCommand::Shutdown => {
                        tracing::info!("Network shutting down");
                        break;
                    }
                    _ => {}
                }
            }
        }
    }

    Ok(())
}
