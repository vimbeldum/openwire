//! OpenWire - P2P Local Network Messenger
//!
//! A decentralized, encrypted messenger for local networks using libp2p.

mod crypto;
mod network;
mod ui;
mod web;

use anyhow::Result;
use clap::Parser;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

/// OpenWire - Decentralized P2P local network messenger
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

    tracing::info!("Starting OpenWire...");

    // Generate or load cryptographic identity
    let identity = crypto::Identity::generate()?;
    tracing::info!("Peer ID: {}", identity.peer_id());

    // Initialize network layer
    let network = network::Network::new(identity.clone(), args.port).await?;
    tracing::info!("Network initialized on port {}", args.port);

    // If bootstrap peer provided, connect to it
    if let Some(bootstrap_addr) = &args.bootstrap {
        network.connect(bootstrap_addr).await?;
        tracing::info!("Connected to bootstrap peer: {}", bootstrap_addr);
    }

    // Start network discovery
    network.start_discovery()?;

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

    tracing::info!("OpenWire is running. Press Ctrl+C to exit.");

    // Wait for shutdown signal
    tokio::signal::ctrl_c().await?;
    tracing::info!("Shutting down OpenWire...");

    Ok(())
}
