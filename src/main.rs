//! OpenWire - P2P Local Network Messenger with End-to-End Encryption
//!
//! A decentralized, encrypted messenger for local networks using libp2p.
//!
//! # Features
//! - End-to-end encryption using X25519 + ChaCha20-Poly1305
//! - Message signing with Ed25519
//! - Peer discovery via mDNS
//! - Secure transport via Noise protocol
//! - File transfer support
//! - Terminal UI with 3-pane layout
//! - Optional web interface

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
    #[arg(short, long, default_value = "warn")]
    log_level: String,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();

    // Initialize logging — write to file to avoid polluting the TUI
    let log_dir = dirs_next::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join(".openwire");
    std::fs::create_dir_all(&log_dir)?;
    let log_file = std::fs::File::create(log_dir.join("openwire.log"))?;

    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(&args.log_level))
        .with(tracing_subscriber::fmt::layer().with_writer(std::sync::Mutex::new(log_file)))
        .init();

    tracing::info!("Starting OpenWire with End-to-End Encryption...");

    // Initialize cryptographic manager
    let crypto = CryptoManager::new()?;
    let peer_id_display = crypto.peer_id();
    tracing::info!("Peer ID: {}", peer_id_display);

    // Initialize network layer
    let (network, handle) = network::Network::new(crypto, args.port).await?;
    let local_peer_id = network.local_peer_id().to_string();
    tracing::info!("Network initialized: {}", local_peer_id);

    // Save command sender for shutdown
    let shutdown_sender = handle.command_sender.clone();

    // If bootstrap peer provided, send a connect command
    if let Some(bootstrap_addr) = &args.bootstrap {
        handle
            .command_sender
            .send(network::NetworkCommand::Connect(bootstrap_addr.clone()))
            .await?;
    }

    // Spawn the network event loop
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

    // Run the TUI on the main thread (blocking — crossterm needs it)
    let nick = args.nick.clone();
    let mut ui = ui::UiApp::new(
        nick,
        local_peer_id,
        handle.command_sender,
        handle.event_receiver,
    )?;

    // Run UI — blocks until user quits
    if let Err(e) = ui.run().await {
        tracing::error!("UI error: {}", e);
    }

    // UI exited — trigger graceful shutdown
    let _ = shutdown_sender
        .send(network::NetworkCommand::Shutdown)
        .await;

    // Wait for the network task to finish
    tokio::select! {
        _ = network_task => {}
        _ = tokio::time::sleep(std::time::Duration::from_secs(3)) => {}
    }

    Ok(())
}
