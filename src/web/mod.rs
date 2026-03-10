//! Web Interface for OpenWire
//!
//! Provides an optional HTTP interface using Axum.
//! Serves status and peer info via REST API, and a WebSocket bridge
//! at `/ws` that speaks the same JSON protocol as the openwire-relay server.

use anyhow::Result;
use axum::{
    Json, Router,
    extract::{
        State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    routing::get,
};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, net::SocketAddr, sync::Arc};
use tokio::sync::{RwLock, broadcast, mpsc};
use tower_http::cors::{Any, CorsLayer};

use crate::network::{NetworkCommand, NetworkEvent};

// ── Shared app state ────────────────────────────────────────────────────────

/// State shared by all Axum handlers.
#[derive(Clone)]
pub struct WebState {
    /// Local peer ID string (set at startup, read-only afterwards)
    local_peer_id: Arc<String>,
    /// Channel for sending commands to the libp2p network loop
    network_tx: mpsc::Sender<NetworkCommand>,
    /// Broadcast sender — each WS handler subscribes a new receiver
    event_broadcast: broadcast::Sender<NetworkEvent>,
    /// peer_id → nick for every known web client
    connected_peers: Arc<RwLock<HashMap<String, String>>>,
    /// room_id → room_name
    rooms: Arc<RwLock<HashMap<String, String>>>,
}

// ── REST response types ──────────────────────────────────────────────────────

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    version: &'static str,
}

#[derive(Serialize)]
struct StatusResponse {
    status: &'static str,
    version: &'static str,
    description: &'static str,
}

// ── WebSocket message protocol ───────────────────────────────────────────────

/// Messages arriving **from** the web client.
#[derive(Deserialize, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ClientMsg {
    Join {
        nick: String,
    },
    Message {
        data: String,
    },
    RoomCreate {
        name: String,
    },
    RoomJoin {
        room_id: String,
    },
    RoomLeave {
        room_id: String,
    },
    RoomMessage {
        room_id: String,
        data: String,
    },
    RoomInvite {
        room_id: String,
        target_peer_id: String,
    },
    Ping,
}

/// Messages being sent **to** the web client.
#[derive(Serialize, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ServerMsg<'a> {
    Welcome {
        peer_id: &'a str,
        peers: Vec<serde_json::Value>,
        rooms: Vec<serde_json::Value>,
    },
    Message {
        nick: String,
        data: String,
        peer_id: String,
    },
    PeerJoined {
        peer_id: String,
        nick: String,
    },
    PeerLeft {
        peer_id: String,
    },
    RoomCreated {
        room_id: String,
        name: String,
    },
    RoomMessage {
        room_id: String,
        nick: String,
        data: String,
        peer_id: String,
    },
    Pong,
}

// ── Server startup ───────────────────────────────────────────────────────────

/// Start the Axum web server with WebSocket bridge support.
pub async fn start_web_server(
    port: u16,
    local_peer_id: String,
    network_tx: mpsc::Sender<NetworkCommand>,
    event_broadcast: broadcast::Sender<NetworkEvent>,
) -> Result<()> {
    let state = WebState {
        local_peer_id: Arc::new(local_peer_id),
        network_tx,
        event_broadcast,
        connected_peers: Arc::new(RwLock::new(HashMap::new())),
        rooms: Arc::new(RwLock::new(HashMap::new())),
    };

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/", get(index_handler))
        .route("/api/health", get(health_handler))
        .route("/api/status", get(status_handler))
        .route("/ws", get(ws_handler))
        .layer(cors)
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("Web server listening on http://{}", addr);
    tracing::info!("WebSocket bridge available at ws://{}/ws", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

// ── REST handlers ────────────────────────────────────────────────────────────

async fn index_handler() -> &'static str {
    "OpenWire P2P Encrypted Messenger — Web Interface"
}

async fn health_handler() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
    })
}

async fn status_handler() -> Json<StatusResponse> {
    Json(StatusResponse {
        status: "running",
        version: env!("CARGO_PKG_VERSION"),
        description: "OpenWire P2P Encrypted Messenger",
    })
}

// ── WebSocket upgrade handler ────────────────────────────────────────────────

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<WebState>,
) -> impl axum::response::IntoResponse {
    ws.on_upgrade(move |socket| handle_ws_connection(socket, state))
}

/// Drive a single WebSocket connection.
///
/// Spawns two tasks:
/// - one reading from the WS client and forwarding to the network
/// - one reading from the broadcast channel and forwarding to the WS client
///
/// Both tasks share a channel that is closed when either side exits, so the
/// connection is torn down cleanly without leaking tasks.
async fn handle_ws_connection(socket: WebSocket, state: WebState) {
    let peer_id = state.local_peer_id.as_str().to_owned();

    // Subscribe to broadcast events before anything else so we don't miss any
    let mut event_rx = state.event_broadcast.subscribe();

    // Split the socket into send/receive halves via an internal channel
    let (ws_tx, mut ws_rx_inner) = mpsc::channel::<String>(64);
    // The "quit" signal — closing this notifies the network-read task to stop
    let (quit_tx, quit_rx) = tokio::sync::oneshot::channel::<()>();

    // ── Task A: read from network events → send to WS client ────────────────
    let ws_tx_a = ws_tx.clone();
    let state_a = state.clone();
    let peer_id_a = peer_id.clone();
    let network_task = tokio::spawn(async move {
        // Send welcome immediately
        let welcome = build_welcome(&peer_id_a, &state_a).await;
        if ws_tx_a.send(welcome).await.is_err() {
            return;
        }

        loop {
            match event_rx.recv().await {
                Ok(event) => {
                    if let Some(msg) = network_event_to_json(event, &state_a).await {
                        if ws_tx_a.send(msg).await.is_err() {
                            break; // client disconnected
                        }
                    }
                }
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    tracing::warn!("Web bridge dropped {} events (lagged)", n);
                    // Continue — just skip the lost events
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }

        drop(quit_tx); // signal the socket reader to stop
    });

    // ── Actual socket send/receive loop (must drive the WebSocket itself) ────
    let (mut ws_sink, mut ws_stream) = {
        use futures::StreamExt;
        socket.split()
    };

    // Task B: drain ws_tx_a writes to the actual socket
    let send_task = tokio::spawn(async move {
        use futures::SinkExt;
        let mut quit_rx = quit_rx;
        loop {
            tokio::select! {
                biased;
                _ = &mut quit_rx => break,
                msg = ws_rx_inner.recv() => {
                    match msg {
                        Some(text) => {
                            if ws_sink.send(Message::Text(text.into())).await.is_err() {
                                break;
                            }
                        }
                        None => break,
                    }
                }
            }
        }
    });

    // ── Task C: read from WS client → forward to network ────────────────────
    let state_c = state.clone();
    let peer_id_c = peer_id.clone();
    let ws_tx_c = ws_tx;
    while let Some(result) = {
        use futures::StreamExt;
        ws_stream.next().await
    } {
        match result {
            Ok(Message::Text(text)) => {
                handle_client_message(text.as_str(), &peer_id_c, &state_c, &ws_tx_c).await;
            }
            Ok(Message::Close(_)) | Err(_) => break,
            _ => {} // ping/pong/binary — ignore
        }
    }

    // Client disconnected — clean up
    network_task.abort();
    send_task.abort();

    // Remove from known peers
    state.connected_peers.write().await.remove(&peer_id);
    tracing::debug!("WebSocket client disconnected: {}", peer_id);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async fn build_welcome(peer_id: &str, state: &WebState) -> String {
    let peers_map = state.connected_peers.read().await;
    let peers: Vec<serde_json::Value> = peers_map
        .iter()
        .map(|(id, nick)| serde_json::json!({ "peer_id": id, "nick": nick }))
        .collect();

    let rooms_map = state.rooms.read().await;
    let rooms: Vec<serde_json::Value> = rooms_map
        .iter()
        .map(|(id, name)| serde_json::json!({ "room_id": id, "name": name }))
        .collect();

    serde_json::to_string(&ServerMsg::Welcome {
        peer_id,
        peers,
        rooms,
    })
    .unwrap_or_default()
}

/// Convert a `NetworkEvent` to the JSON string to send to the client,
/// or `None` if this event type doesn't need forwarding.
async fn network_event_to_json(event: NetworkEvent, state: &WebState) -> Option<String> {
    match event {
        NetworkEvent::MessageReceived { from, data, .. } => {
            let nick = {
                let peers = state.connected_peers.read().await;
                peers
                    .get(&from.to_string())
                    .cloned()
                    .unwrap_or_else(|| from.to_string())
            };
            let text = String::from_utf8_lossy(&data).into_owned();
            Some(
                serde_json::to_string(&ServerMsg::Message {
                    nick,
                    data: text,
                    peer_id: from.to_string(),
                })
                .unwrap_or_default(),
            )
        }

        NetworkEvent::PeerDiscovered(peer_id) => {
            let nick = {
                let peers = state.connected_peers.read().await;
                peers.get(&peer_id.to_string()).cloned().unwrap_or_default()
            };
            Some(
                serde_json::to_string(&ServerMsg::PeerJoined {
                    peer_id: peer_id.to_string(),
                    nick,
                })
                .unwrap_or_default(),
            )
        }

        NetworkEvent::PeerDisconnected(peer_id) => Some(
            serde_json::to_string(&ServerMsg::PeerLeft {
                peer_id: peer_id.to_string(),
            })
            .unwrap_or_default(),
        ),

        NetworkEvent::RoomCreated { room_id, room_name } => {
            // Mirror in shared state
            state
                .rooms
                .write()
                .await
                .insert(room_id.clone(), room_name.clone());
            Some(
                serde_json::to_string(&ServerMsg::RoomCreated {
                    room_id,
                    name: room_name,
                })
                .unwrap_or_default(),
            )
        }

        NetworkEvent::RoomMessageReceived {
            from,
            room_id,
            sender_nick,
            content,
        } => {
            let data = String::from_utf8_lossy(&content).into_owned();
            Some(
                serde_json::to_string(&ServerMsg::RoomMessage {
                    room_id,
                    nick: sender_nick,
                    data,
                    peer_id: from.to_string(),
                })
                .unwrap_or_default(),
            )
        }

        // Events the web bridge doesn't need to forward
        _ => None,
    }
}

/// Handle a raw text frame from the client.
async fn handle_client_message(
    text: &str,
    peer_id: &str,
    state: &WebState,
    ws_tx: &mpsc::Sender<String>,
) {
    let msg = match serde_json::from_str::<ClientMsg>(text) {
        Ok(m) => m,
        Err(e) => {
            tracing::debug!("Could not parse client message: {} — {:?}", e, text);
            return;
        }
    };

    match msg {
        ClientMsg::Join { nick } => {
            state
                .connected_peers
                .write()
                .await
                .insert(peer_id.to_owned(), nick.clone());
            tracing::debug!("Web client joined as '{}'", nick);
        }

        ClientMsg::Message { data } => {
            let _ = state
                .network_tx
                .send(NetworkCommand::Broadcast {
                    data: data.into_bytes(),
                })
                .await;
        }

        ClientMsg::RoomCreate { name } => {
            let _ = state
                .network_tx
                .send(NetworkCommand::CreateRoom { name })
                .await;
        }

        ClientMsg::RoomJoin { room_id } => {
            let _ = state
                .network_tx
                .send(NetworkCommand::SubscribeToRoom { room_id })
                .await;
        }

        ClientMsg::RoomLeave { room_id } => {
            let _ = state
                .network_tx
                .send(NetworkCommand::LeaveRoom { room_id })
                .await;
        }

        ClientMsg::RoomMessage { room_id, data } => {
            let _ = state
                .network_tx
                .send(NetworkCommand::SendRoomMessage {
                    room_id,
                    data: data.into_bytes(),
                })
                .await;
        }

        ClientMsg::RoomInvite {
            room_id,
            target_peer_id,
        } => {
            let _ = state
                .network_tx
                .send(NetworkCommand::InviteToRoom {
                    room_id,
                    peer_id: target_peer_id,
                })
                .await;
        }

        ClientMsg::Ping => {
            let pong = serde_json::to_string(&ServerMsg::Pong).unwrap_or_default();
            let _ = ws_tx.send(pong).await;
        }
    }
}
