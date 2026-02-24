//! OpenWire - P2P Local Network Messenger with End-to-End Encryption
//!
//! A decentralized, encrypted messenger for local networks using libp2p.
//!
//! # Features
//! - End-to-end encryption using X25519 + ChaCha20-Poly1305
//! - Message signing with Ed25519
//! - Peer discovery via mDNS
//! - Secure transport via Noise protocol
//!
//! # Encryption
//! All messages are encrypted end-to-end using:
//! - X25519 for Diffie-Hellman key exchange
//! - ChaCha20-Poly1305 for authenticated encryption (AEAD)
//! - HKDF for key derivation
//! - Ephemeral keys for forward secrecy

mod crypto;
mod encryption;
mod network;
mod ui;
mod web;

use anyhow::Result;
use clap::Parser;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crypto::CryptoManager;

/// OpenWire - Decentralized P2P local network messenger with E2E encryption
#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// TCP port for P2P listening (0 = random)
    #[arg(short, long, default_value = "0")]
    port: u16,

    /// Enable web interface
    #[arg(long)]
    web: bool,

    /// Port for web interface
    #[arg(long, default_value = "3000")]
    web_port: u16,

    /// Bootstrap peer multiaddress
    #[arg(short, long)]
    bootstrap: Option<String>,

    /// Display nickname
    #[arg(short = 'n', long, default_value = "Anonymous")]
    nick: String,

    /// Log level (trace, debug, info, warn, error)
    #[arg(short, long, default_value = "info")]
    log_level: String,
}

#[tokio::main]
async fn main() -> Result<()> {
    // Parse command line arguments
    let args = Args::parse();

    // Initialize logging
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(&args.log_level))
        .with(tracing_subscriber::fmt::layer())
        .init();

    tracing::info!("Starting OpenWire with End-to-End Encryption...");

    // Initialize cryptographic manager
    let crypto = CryptoManager::new()?;
    tracing::info!("Peer ID: {}", crypto.peer_id());
    tracing::info!(
        "Encryption public key: {}",
        hex::encode(crypto.encryption_public_key())
    );

    // Initialize network layer — returns the Network + a handle for communication
    let (network, handle) = network::Network::new(crypto, args.port).await?;
    let local_peer_id = *network.local_peer_id();
    tracing::info!(
        "Network initialized (libp2p peer: {}) with E2E encryption enabled",
        local_peer_id
    );

    // If bootstrap peer provided, send a connect command
    if let Some(bootstrap_addr) = &args.bootstrap {
        handle
            .command_sender
            .send(network::NetworkCommand::Connect(bootstrap_addr.clone()))
            .await?;
        tracing::info!("Queued connection to bootstrap peer: {}", bootstrap_addr);
    }

    // Spawn the network event loop — this drives the swarm
    let network_task = tokio::spawn(async move {
        if let Err(e) = network::run_network(network).await {
            tracing::error!("Network error: {}", e);
        }
    });

    // Start web interface if --web flag is set
    if args.web {
        let web_port = args.web_port;
        tokio::spawn(async move {
            if let Err(e) = web::start_web_server(web_port).await {
                tracing::error!("Web server error: {}", e);
            }
        });
    }

    // Start terminal UI
    let mut ui = ui::UiApp::new()?;
    tokio::spawn(async move {
        if let Err(e) = ui.run().await {
            tracing::error!("UI error: {}", e);
        }
    });

    tracing::info!("OpenWire is running with E2E encryption.");
    tracing::info!("All messages are encrypted using X25519 + ChaCha20-Poly1305");
    tracing::info!("Press Ctrl+C to exit.");

    // Wait for shutdown signal
    tokio::signal::ctrl_c().await?;
    tracing::info!("Shutting down OpenWire...");

    // Send graceful shutdown command to the network
    let _ = handle
        .command_sender
        .send(network::NetworkCommand::Shutdown)
        .await;

    // Wait for the network task to finish (with a timeout)
    tokio::select! {
        _ = network_task => {
            tracing::info!("Network shut down cleanly.");
        }
        _ = tokio::time::sleep(std::time::Duration::from_secs(5)) => {
            tracing::warn!("Network shutdown timed out, forcing exit.");
        }
    }

    Ok(())
}
