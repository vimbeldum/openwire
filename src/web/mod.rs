//! Web Interface for OpenWire
//!
//! Provides an optional HTTP/WebSocket interface using Axum.

use anyhow::Result;
use axum::{routing::get, Router};
use std::net::SocketAddr;

/// Start the Axum web server
pub async fn start_web_server(port: u16) -> Result<()> {
    // Define our routes
    let app = Router::new()
        .route("/", get(index_handler))
        .route("/api/messages", get(get_messages));

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    tracing::info!("Web server listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

async fn index_handler() -> &'static str {
    "Welcome to OpenWire Web Interface (Stub)"
}

async fn get_messages() -> &'static str {
    "[]"
}
