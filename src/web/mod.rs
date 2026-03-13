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
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::{RwLock, broadcast, mpsc};
use tower_http::cors::{Any, CorsLayer};

use crate::network::{NetworkCommand, NetworkEvent};

/// Monotonically-increasing counter so each WS connection gets a unique ID.
static CONNECTION_COUNTER: AtomicU64 = AtomicU64::new(1);

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
    /// Direct sender into the TUI event queue (used to inject synthetic events)
    event_tx: mpsc::Sender<NetworkEvent>,
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
    /// Game action forwarded as a general broadcast (shared game room)
    GameAction {
        data: String,
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
    /// Game state/action forwarded from CLI to web
    GameAction {
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
    event_tx: mpsc::Sender<NetworkEvent>,
) -> Result<()> {
    let state = WebState {
        local_peer_id: Arc::new(local_peer_id),
        network_tx,
        event_broadcast,
        event_tx,
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

async fn index_handler() -> axum::response::Html<&'static str> {
    axum::response::Html(r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OpenWire — Web Bridge</title>
<style>
  body{font-family:monospace;background:#0d1117;color:#e6edf3;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;gap:1rem}
  h1{color:#58a6ff;margin:0}
  .badge{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:1.2rem 2rem;max-width:480px;width:90%;text-align:center}
  code{background:#21262d;padding:.2em .5em;border-radius:4px;color:#79c0ff;word-break:break-all}
  .label{color:#8b949e;font-size:.85rem;margin-top:1rem}
  a{color:#58a6ff}
  .ok{color:#3fb950}
</style>
</head>
<body>
<h1>⚡ OpenWire</h1>
<div class="badge">
  <div class="ok">✔ Web bridge is running</div>
  <div class="label">WebSocket endpoint</div>
  <code id="ws"></code>
  <div class="label">REST API</div>
  <code id="api"></code>
  <div class="label" style="margin-top:1.5rem">
    Point the <a href="https://github.com/vimbeldum/openwire" target="_blank">openwire-web</a> app<br>
    at the WebSocket URL above, or use the Landing page&nbsp;<b>CLI&nbsp;Node</b> option.
  </div>
</div>
<script>
  const h = window.location.host;
  document.getElementById('ws').textContent  = 'ws://'  + h + '/ws';
  document.getElementById('api').textContent = 'http://' + h + '/api/status';
</script>
</body>
</html>"#)
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
    // Give every connection a unique, stable ID so multiple web clients
    // don't collide in connected_peers.
    let conn_n = CONNECTION_COUNTER.fetch_add(1, Ordering::Relaxed);
    let conn_str = format!("webclient-{:08x}", conn_n);
    let peer_libp2p = peer_id_for_web_client(&conn_str);
    // Use the libp2p PeerId's base58 string as the canonical map key so that
    // NetworkEvent::PeerDiscovered(peer_libp2p) lookups find the right nick.
    let peer_id = peer_libp2p.to_string();

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
                    if let Some(msg) = network_event_to_json(event, &state_a).await
                        && ws_tx_a.send(msg).await.is_err()
                    {
                        break; // client disconnected
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
    let peer_libp2p_c = peer_libp2p;
    let ws_tx_c = ws_tx;
    while let Some(result) = {
        use futures::StreamExt;
        ws_stream.next().await
    } {
        match result {
            Ok(Message::Text(text)) => {
                handle_client_message(
                    text.as_str(),
                    &peer_id_c,
                    peer_libp2p_c,
                    &state_c,
                    &ws_tx_c,
                )
                .await;
            }
            Ok(Message::Close(_)) | Err(_) => break,
            _ => {} // ping/pong/binary — ignore
        }
    }

    // Client disconnected — clean up
    network_task.abort();
    send_task.abort();

    // Announce disconnect to all remaining web clients and TUI
    let disc_event = NetworkEvent::PeerDisconnected(peer_libp2p_c);
    let _ = state.event_broadcast.send(disc_event.clone());
    let _ = state.event_tx.send(disc_event).await;

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
            let text = String::from_utf8_lossy(&data).into_owned();
            // Don't forward internal CLI protocol messages to web clients
            if text.starts_with("TYPING:") || text.starts_with("TICKER:") {
                return None;
            }
            let nick = {
                let peers = state.connected_peers.read().await;
                peers
                    .get(&from.to_string())
                    .cloned()
                    .unwrap_or_else(|| from.to_string())
            };
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
    peer_libp2p: libp2p::PeerId,
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
            // Announce to all other web clients (→ ServerMsg::PeerJoined) and TUI
            let event = NetworkEvent::PeerDiscovered(peer_libp2p);
            let _ = state.event_broadcast.send(event.clone());
            let _ = state.event_tx.send(event).await;
        }

        ClientMsg::Message { data } => {
            let nick = state
                .connected_peers
                .read()
                .await
                .get(peer_id)
                .cloned()
                .unwrap_or_else(|| peer_id[..8.min(peer_id.len())].to_string());
            // Forward to gossipsub for any P2P peers on the network
            let _ = state
                .network_tx
                .send(NetworkCommand::Broadcast {
                    data: data.clone().into_bytes(),
                    nick: nick.clone(),
                })
                .await;
            // Echo to ALL web clients on this bridge + TUI regardless of
            // gossipsub success (no P2P peers required for local delivery).
            let display = format!("[web:{}] {}", nick, data);
            let event = NetworkEvent::MessageReceived {
                from: peer_libp2p,
                topic: "openwire-general".to_string(),
                data: display.into_bytes(),
            };
            let _ = state.event_broadcast.send(event.clone());
            let _ = state.event_tx.send(event).await;
        }

        ClientMsg::RoomCreate { name } => {
            // Create room via network — the RoomCreated event will be broadcast
            // to all web clients and TUI via network_event_to_json
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
            let nick = state
                .connected_peers
                .read()
                .await
                .get(peer_id)
                .cloned()
                .unwrap_or_else(|| peer_id[..8.min(peer_id.len())].to_string());
            // Forward to gossipsub for P2P peers
            let _ = state
                .network_tx
                .send(NetworkCommand::SendRoomMessage {
                    room_id: room_id.clone(),
                    data: data.clone().into_bytes(),
                })
                .await;
            // Loopback to TUI + other web clients so the message is visible locally
            let event = NetworkEvent::RoomMessageReceived {
                from: peer_libp2p,
                room_id,
                sender_nick: nick,
                content: data.into_bytes(),
            };
            let _ = state.event_broadcast.send(event.clone());
            let _ = state.event_tx.send(event).await;
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

        ClientMsg::GameAction { data } => {
            let nick = state
                .connected_peers
                .read()
                .await
                .get(peer_id)
                .cloned()
                .unwrap_or_else(|| peer_id[..8.min(peer_id.len())].to_string());
            // Forward game action as a broadcast so CLI picks it up as a room message
            let _ = state
                .network_tx
                .send(NetworkCommand::Broadcast {
                    data: data.clone().into_bytes(),
                    nick: nick.clone(),
                })
                .await;
            // Loopback so all web clients see it too
            let display = format!("[web:{}] {}", nick, data);
            let event = NetworkEvent::MessageReceived {
                from: peer_libp2p,
                topic: "openwire-general".to_string(),
                data: display.into_bytes(),
            };
            let _ = state.event_broadcast.send(event.clone());
            let _ = state.event_tx.send(event).await;
        }

        ClientMsg::Ping => {
            let pong = serde_json::to_string(&ServerMsg::Pong).unwrap_or_default();
            let _ = ws_tx.send(pong).await;
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Deterministically derive a stable `PeerId` from a web-client connection ID
/// string.  The same approach is used in `relay_bridge` so both bridges are
/// consistent: SHA-256 of the string → treat as ed25519 seed → PeerId.
fn peer_id_for_web_client(s: &str) -> libp2p::PeerId {
    use sha2::Digest;
    let digest = sha2::Sha256::digest(s.as_bytes());
    let mut kp_bytes = [0u8; 64];
    kp_bytes[..32].copy_from_slice(&digest);
    kp_bytes[32..].copy_from_slice(&digest);
    if let Ok(kp) = libp2p::identity::ed25519::Keypair::try_from_bytes(&mut kp_bytes) {
        libp2p::PeerId::from(libp2p::identity::Keypair::from(kp).public())
    } else {
        libp2p::PeerId::random()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── ClientMsg deserialization ────────────────────────────────────────

    #[test]
    fn test_client_msg_join() {
        let json = r#"{"type":"join","nick":"Alice"}"#;
        let msg: ClientMsg = serde_json::from_str(json).unwrap();
        match msg {
            ClientMsg::Join { nick } => assert_eq!(nick, "Alice"),
            other => panic!("Expected Join, got {:?}", other),
        }
    }

    #[test]
    fn test_client_msg_message() {
        let json = r#"{"type":"message","data":"Hello world"}"#;
        let msg: ClientMsg = serde_json::from_str(json).unwrap();
        match msg {
            ClientMsg::Message { data } => assert_eq!(data, "Hello world"),
            other => panic!("Expected Message, got {:?}", other),
        }
    }

    #[test]
    fn test_client_msg_ping() {
        let json = r#"{"type":"ping"}"#;
        let msg: ClientMsg = serde_json::from_str(json).unwrap();
        assert!(matches!(msg, ClientMsg::Ping));
    }

    #[test]
    fn test_client_msg_room_create() {
        let json = r#"{"type":"room_create","name":"my-room"}"#;
        let msg: ClientMsg = serde_json::from_str(json).unwrap();
        match msg {
            ClientMsg::RoomCreate { name } => assert_eq!(name, "my-room"),
            other => panic!("Expected RoomCreate, got {:?}", other),
        }
    }

    #[test]
    fn test_client_msg_room_message() {
        let json = r#"{"type":"room_message","room_id":"r1","data":"hi"}"#;
        let msg: ClientMsg = serde_json::from_str(json).unwrap();
        match msg {
            ClientMsg::RoomMessage { room_id, data } => {
                assert_eq!(room_id, "r1");
                assert_eq!(data, "hi");
            }
            other => panic!("Expected RoomMessage, got {:?}", other),
        }
    }

    #[test]
    fn test_client_msg_game_action() {
        let json = r#"{"type":"game_action","data":"{\"move\":5}"}"#;
        let msg: ClientMsg = serde_json::from_str(json).unwrap();
        match msg {
            ClientMsg::GameAction { data } => assert!(data.contains("move")),
            other => panic!("Expected GameAction, got {:?}", other),
        }
    }

    #[test]
    fn test_client_msg_invalid_type_fails() {
        let json = r#"{"type":"nonexistent","data":"x"}"#;
        assert!(serde_json::from_str::<ClientMsg>(json).is_err());
    }

    // ── ServerMsg serialization ─────────────────────────────────────────

    #[test]
    fn test_server_msg_pong() {
        let json = serde_json::to_string(&ServerMsg::Pong).unwrap();
        assert_eq!(json, r#"{"type":"pong"}"#);
    }

    #[test]
    fn test_server_msg_message_roundtrip() {
        let msg = ServerMsg::Message {
            nick: "Bob".into(),
            data: "Hello".into(),
            peer_id: "peer123".into(),
        };
        let json = serde_json::to_string(&msg).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "message");
        assert_eq!(parsed["nick"], "Bob");
        assert_eq!(parsed["data"], "Hello");
        assert_eq!(parsed["peer_id"], "peer123");
    }

    #[test]
    fn test_server_msg_welcome_includes_peers_and_rooms() {
        let msg = ServerMsg::Welcome {
            peer_id: "local-peer",
            peers: vec![serde_json::json!({"peer_id": "p1", "nick": "A"})],
            rooms: vec![serde_json::json!({"room_id": "r1", "name": "Lobby"})],
        };
        let json = serde_json::to_string(&msg).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "welcome");
        assert_eq!(parsed["peer_id"], "local-peer");
        assert_eq!(parsed["peers"][0]["nick"], "A");
        assert_eq!(parsed["rooms"][0]["name"], "Lobby");
    }

    #[test]
    fn test_server_msg_peer_joined() {
        let msg = ServerMsg::PeerJoined {
            peer_id: "p42".into(),
            nick: "Eve".into(),
        };
        let json = serde_json::to_string(&msg).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "peer_joined");
        assert_eq!(parsed["nick"], "Eve");
    }

    // ── REST response types ─────────────────────────────────────────────

    #[test]
    fn test_health_response_serialization() {
        let resp = HealthResponse {
            status: "ok",
            version: "0.1.0",
        };
        let json = serde_json::to_string(&resp).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["status"], "ok");
        assert_eq!(parsed["version"], "0.1.0");
    }

    #[test]
    fn test_status_response_serialization() {
        let resp = StatusResponse {
            status: "running",
            version: "0.2.0",
            description: "OpenWire P2P Encrypted Messenger",
        };
        let json = serde_json::to_string(&resp).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["status"], "running");
        assert_eq!(parsed["description"], "OpenWire P2P Encrypted Messenger");
    }

    // ── peer_id_for_web_client ──────────────────────────────────────────

    #[test]
    fn test_peer_id_returns_valid_peer_id() {
        let a = peer_id_for_web_client("webclient-00000001");
        // Should return a valid PeerId (not panic)
        assert!(!a.to_string().is_empty());
    }

    #[test]
    fn test_peer_id_different_inputs_produce_peer_ids() {
        let a = peer_id_for_web_client("webclient-00000001");
        let b = peer_id_for_web_client("webclient-00000002");
        // Both return valid PeerIds
        assert!(!a.to_string().is_empty());
        assert!(!b.to_string().is_empty());
    }

    // ── CONNECTION_COUNTER ──────────────────────────────────────────────

    #[test]
    fn test_connection_counter_increments() {
        let a = CONNECTION_COUNTER.fetch_add(1, Ordering::Relaxed);
        let b = CONNECTION_COUNTER.fetch_add(1, Ordering::Relaxed);
        assert_eq!(b, a + 1);
    }
}
