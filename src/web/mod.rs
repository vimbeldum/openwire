//! Web Interface for OpenWire
//!
//! Provides an optional HTTP interface using Axum.
//! Serves status and peer info via REST API.

use anyhow::Result;
use axum::{routing::get, Json, Router};
use serde::Serialize;
use std::net::SocketAddr;
use tower_http::cors::{Any, CorsLayer};

#[derive(Serialize)]
struct HealthResponse {
    status: String,
    version: String,
}

#[derive(Serialize)]
struct StatusResponse {
    status: String,
    version: String,
    description: String,
}

/// Start the Axum web server
///
/// Binds to 0.0.0.0 so the web interface is accessible from the LAN.
pub async fn start_web_server(port: u16) -> Result<()> {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/", get(index_handler))
        .route("/api/health", get(health_handler))
        .route("/api/status", get(status_handler))
        .layer(cors);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("Web server listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

async fn index_handler() -> &'static str {
    "OpenWire P2P Encrypted Messenger — Web Interface"
}

async fn health_handler() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

async fn status_handler() -> Json<StatusResponse> {
    Json(StatusResponse {
        status: "running".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        description: "OpenWire P2P Encrypted Messenger".to_string(),
    })
}
