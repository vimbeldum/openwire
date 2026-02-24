//! Web Interface for OpenWire
//!
//! Provides an optional HTTP/WebSocket interface using Axum.

use anyhow::Result;
use axum::{routing::get, Router};
use std::net::SocketAddr;
use tower_http::cors::{Any, CorsLayer};

/// Start the Axum web server
///
/// Binds to 0.0.0.0 so the web interface is accessible from the LAN.
pub async fn start_web_server(port: u16) -> Result<()> {
    // CORS layer — permissive for development
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/", get(index_handler))
        .route("/api/messages", get(get_messages))
        .route("/api/health", get(health_handler))
        .layer(cors);

    // Bind to all interfaces for LAN accessibility
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("Web server listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

async fn index_handler() -> &'static str {
    "Welcome to OpenWire Web Interface"
}

async fn get_messages() -> &'static str {
    "[]"
}

async fn health_handler() -> &'static str {
    r#"{"status":"ok"}"#
}
