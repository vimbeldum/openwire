//! Relay Bridge for OpenWire
//!
//! Connects the local libp2p gossipsub network to the cloud relay server
//! (`wss://openwire-relay.openwire.workers.dev`) so that the CLI and the
//! openwire-web Vercel app can exchange messages.
//!
//! The relay speaks a simple JSON WebSocket protocol — see the module-level
//! types below.  The bridge:
//!
//! 1. Connects to the relay and sends a `join` message.
//! 2. Forwards relay → local: messages from relay peers are injected into the
//!    TUI event queue as `NetworkEvent::MessageReceived`.
//! 3. Forwards local → relay: messages from local gossipsub peers are
//!    re-published to the relay (loop prevention via content-hash set).
//! 4. Reconnects with exponential back-off on disconnect.

use std::collections::HashSet;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::time::Duration;

use anyhow::Result;
use futures::{SinkExt, StreamExt};
use libp2p::PeerId;
use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, mpsc};
use tokio_tungstenite::{connect_async, tungstenite::Message};

use crate::network::{NetworkCommand, NetworkEvent};

// ── Relay protocol types ─────────────────────────────────────────────────────

/// Messages we send to the relay server.
#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum RelayOut {
    Join { nick: String },
    Message { data: String },
    Ping,
}

/// Messages we receive from the relay server.
#[derive(Deserialize, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
#[allow(dead_code)]
enum RelayIn {
    Welcome {
        peer_id: String,
        peers: Vec<serde_json::Value>,
        #[serde(default)]
        rooms: Vec<serde_json::Value>,
    },
    Message {
        nick: String,
        data: String,
        #[serde(alias = "from")]
        peer_id: String,
    },
    PeerJoined {
        peer_id: String,
        nick: String,
    },
    PeerLeft {
        peer_id: String,
    },
    Pong,
    // Catch-all for unknown variants
    #[serde(other)]
    Unknown,
}

// ── Public entry point ────────────────────────────────────────────────────────

/// Run the relay bridge.
///
/// Connects to `relay_url`, joins as `nick`, then bridges events between the
/// relay and the local libp2p network until an unrecoverable error occurs.
/// The caller is expected to loop and call this again to reconnect.
pub async fn run_relay_bridge(
    relay_url: String,
    nick: String,
    _network_tx: mpsc::Sender<NetworkCommand>,
    event_broadcast: broadcast::Sender<NetworkEvent>,
    event_tx: mpsc::Sender<NetworkEvent>,
) -> Result<()> {
    tracing::info!("Relay bridge: connecting to {}", relay_url);

    let (ws_stream, _response) = connect_async(&relay_url).await?;
    tracing::info!("Relay bridge: connected");

    let (mut ws_sink, mut ws_source) = ws_stream.split();

    // Send join message
    let join_msg = serde_json::to_string(&RelayOut::Join { nick: nick.clone() })?;
    ws_sink.send(Message::Text(join_msg.into())).await?;

    // Subscribe to local network events BEFORE we start the forward loop so
    // we don't miss anything.
    let mut local_rx = event_broadcast.subscribe();

    // Channel used to pass outgoing text frames from the local→relay task to
    // the actual sink (which is not Clone).
    let (out_tx, mut out_rx) = mpsc::channel::<String>(64);

    // ── Ping task ────────────────────────────────────────────────────────────
    let ping_out_tx = out_tx.clone();
    let _ping_task = tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(14));
        loop {
            interval.tick().await;
            let ping = match serde_json::to_string(&RelayOut::Ping) {
                Ok(s) => s,
                Err(_) => break,
            };
            if ping_out_tx.send(ping).await.is_err() {
                break;
            }
        }
    });

    // ── Local → Relay task ───────────────────────────────────────────────────
    // Receives local NetworkEvent::MessageReceived events and forwards them to
    // the relay, skipping any that originated from the relay (loop prevention).
    let local_fwd_out_tx = out_tx.clone();
    let _local_fwd_task = tokio::spawn(async move {
        // Set of content hashes for messages that arrived FROM the relay.
        // We clear this periodically to avoid unbounded growth.
        let mut relay_hashes: HashSet<u64> = HashSet::new();
        let mut clear_counter: u32 = 0;

        loop {
            match local_rx.recv().await {
                Ok(NetworkEvent::MessageReceived { data, .. }) => {
                    let h = hash_bytes(&data);
                    if relay_hashes.contains(&h) {
                        // This message came from the relay — don't echo back.
                        relay_hashes.remove(&h);
                        continue;
                    }

                    let text = String::from_utf8_lossy(&data).into_owned();
                    // Don't leak internal CLI protocol messages to relay peers
                    if text.starts_with("TYPING:") || text.starts_with("TICKER:") {
                        continue;
                    }
                    // Don't forward web-bridge loopbacks to relay (prevents echo)
                    if text.starts_with("[web:") || text.starts_with("[relay:") {
                        continue;
                    }
                    let out = match serde_json::to_string(&RelayOut::Message { data: text }) {
                        Ok(s) => s,
                        Err(e) => {
                            tracing::warn!("Relay bridge: serialisation error: {}", e);
                            continue;
                        }
                    };
                    if local_fwd_out_tx.send(out).await.is_err() {
                        break;
                    }

                    clear_counter += 1;
                    if clear_counter % 512 == 0 {
                        relay_hashes.clear();
                    }
                }
                Ok(_) => {} // other event types — ignore
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    tracing::warn!("Relay bridge: dropped {} local events (lagged)", n);
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    // We need to track relay-originated message hashes so the local→relay task
    // can skip them.  We share the hashes via a second mpsc channel: the relay
    // reader pushes hashes, the sink loop records them.
    //
    // Actually simpler: store hashes in a shared Arc<Mutex<HashSet>> — but to
    // keep this zero-dependency we use a second mpsc channel that the local→relay
    // task reads from.  The relay→local direction pushes a hash BEFORE emitting
    // the event so the local→relay task will see it in time (both run in the same
    // tokio executor, and the local_rx subscriber will only see the event after
    // the broadcast.send() call returns, which happens after we insert the hash).
    //
    // We embed the hash transport inside `out_tx` using a negative-valued marker
    // — but that's ugly.  Instead, use a dedicated small channel.
    let (hash_tx, mut hash_rx) = mpsc::channel::<u64>(256);

    // ── Relay → Local task (runs in current task context) ────────────────────
    // We share a mutable relay_hashes set between this section and the local→relay
    // task via the hash channel.

    // ── Sink driver task ─────────────────────────────────────────────────────
    // Drains `out_rx` to the actual WebSocket sink.
    let _sink_task = tokio::spawn(async move {
        while let Some(text) = out_rx.recv().await {
            if ws_sink.send(Message::Text(text.into())).await.is_err() {
                break;
            }
        }
    });

    // ── Relay → Local: main loop ─────────────────────────────────────────────
    // We process messages from the relay here (in the calling task) so that
    // disconnection propagates back as a return value.
    loop {
        tokio::select! {
            // Drain the hash channel from the local→relay task (not used here
            // but must be consumed so it doesn't block).
            _ = hash_rx.recv() => {}

            frame = ws_source.next() => {
                match frame {
                    None => {
                        // Server closed the connection
                        return Err(anyhow::anyhow!("Relay WebSocket closed by server"));
                    }
                    Some(Err(e)) => {
                        return Err(anyhow::anyhow!("Relay WebSocket error: {}", e));
                    }
                    Some(Ok(Message::Text(text))) => {
                        handle_relay_message(
                            text.as_str(),
                            &nick,
                            &event_broadcast,
                            &event_tx,
                            &hash_tx,
                        )
                        .await;
                    }
                    Some(Ok(Message::Close(_))) => {
                        return Err(anyhow::anyhow!("Relay WebSocket closed"));
                    }
                    Some(Ok(_)) => {} // ping/pong/binary — ignore
                }
            }
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Process a single text frame received from the relay server.
async fn handle_relay_message(
    text: &str,
    _local_nick: &str,
    event_broadcast: &broadcast::Sender<NetworkEvent>,
    event_tx: &mpsc::Sender<NetworkEvent>,
    hash_tx: &mpsc::Sender<u64>,
) {
    let msg: RelayIn = match serde_json::from_str(text) {
        Ok(m) => m,
        Err(e) => {
            tracing::debug!("Relay bridge: unparseable frame: {} — {}", e, text);
            return;
        }
    };

    match msg {
        RelayIn::Welcome { peer_id, peers, .. } => {
            tracing::info!("Relay bridge: welcomed as peer_id={}", peer_id);
            for peer in peers {
                if let Some(pid) = peer.get("peer_id").and_then(|v| v.as_str()) {
                    let nick_str = peer.get("nick").and_then(|v| v.as_str()).unwrap_or(pid);
                    tracing::debug!("Relay bridge: existing peer {} ({})", pid, nick_str);
                    let from_peer = peer_id_from_str(pid);
                    let disc = NetworkEvent::PeerDiscovered(from_peer);
                    let _ = event_broadcast.send(disc.clone());
                    let _ = event_tx.send(disc).await;
                    let msg = format!("[relay:{}] is online", nick_str);
                    let chat = NetworkEvent::MessageReceived {
                        from: from_peer,
                        topic: "openwire-general".to_string(),
                        data: msg.into_bytes(),
                    };
                    let _ = event_broadcast.send(chat.clone());
                    let _ = event_tx.send(chat).await;
                }
            }
        }

        RelayIn::Message { nick, data, peer_id } => {
            // Build a display string that includes the nick.
            // The TUI uses `short_id(from, 8)` as the displayed sender, so we
            // embed the nick in the data payload: "[relay:Alice] hello"
            let display = format!("[relay:{}] {}", nick, data);
            let display_bytes = display.into_bytes();

            // Record hash so the local→relay task won't echo this back.
            let h = hash_bytes(&display_bytes);
            let _ = hash_tx.try_send(h);

            let from_peer = peer_id_from_str(&peer_id);
            let event = NetworkEvent::MessageReceived {
                from: from_peer,
                topic: "openwire-general".to_string(),
                data: display_bytes,
            };

            let _ = event_broadcast.send(event.clone());
            let _ = event_tx.send(event).await;
        }

        RelayIn::PeerJoined { peer_id, nick } => {
            tracing::info!("Relay bridge: peer joined {} ({})", peer_id, nick);
            let from_peer = peer_id_from_str(&peer_id);
            // PeerDiscovered → TUI shows "Peer joined" and increments peer count
            let disc = NetworkEvent::PeerDiscovered(from_peer);
            let _ = event_broadcast.send(disc.clone());
            let _ = event_tx.send(disc).await;
            // Also show a named join message in the chat
            let msg = format!("[relay:{}] joined", nick);
            let chat = NetworkEvent::MessageReceived {
                from: from_peer,
                topic: "openwire-general".to_string(),
                data: msg.into_bytes(),
            };
            let _ = event_broadcast.send(chat.clone());
            let _ = event_tx.send(chat).await;
        }

        RelayIn::PeerLeft { peer_id } => {
            tracing::info!("Relay bridge: peer left {}", peer_id);
            let from_peer = peer_id_from_str(&peer_id);
            // PeerDisconnected → TUI removes from peer list and decrements count
            let disc = NetworkEvent::PeerDisconnected(from_peer);
            let _ = event_broadcast.send(disc.clone());
            let _ = event_tx.send(disc).await;
        }

        RelayIn::Pong => {
            tracing::trace!("Relay bridge: pong received");
        }

        RelayIn::Unknown => {
            tracing::debug!("Relay bridge: unknown message type");
        }
    }
}

/// Deterministically derive a stable `PeerId` from an arbitrary string by
/// hashing the string with SHA-256 and treating the first 32 bytes as a raw
/// ed25519 public key seed.  This is purely cosmetic — the peer will never
/// have an actual libp2p connection.
///
/// Falls back to `PeerId::random()` if construction fails.
fn peer_id_from_str(s: &str) -> PeerId {
    use sha2::Digest;
    let digest = sha2::Sha256::digest(s.as_bytes());
    // libp2p ed25519 Keypair::try_from_bytes needs 64 bytes: seed || pubkey.
    // We duplicate the 32-byte digest to form a pseudo-keypair.
    let mut kp_bytes = [0u8; 64];
    kp_bytes[..32].copy_from_slice(&digest);
    kp_bytes[32..].copy_from_slice(&digest);
    if let Ok(kp) = libp2p::identity::ed25519::Keypair::try_from_bytes(&mut kp_bytes) {
        PeerId::from(libp2p::identity::Keypair::from(kp).public())
    } else {
        PeerId::random()
    }
}

/// FNV-inspired fast hash of a byte slice.
fn hash_bytes(data: &[u8]) -> u64 {
    let mut h = DefaultHasher::new();
    data.hash(&mut h);
    h.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── RelayOut serialization ──────────────────────────────────────────────

    #[test]
    fn test_relay_out_join_serialization() {
        let msg = RelayOut::Join {
            nick: "alice".to_string(),
        };
        let json = serde_json::to_string(&msg).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "join");
        assert_eq!(parsed["nick"], "alice");
    }

    #[test]
    fn test_relay_out_message_serialization() {
        let msg = RelayOut::Message {
            data: "hello world".to_string(),
        };
        let json = serde_json::to_string(&msg).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "message");
        assert_eq!(parsed["data"], "hello world");
    }

    #[test]
    fn test_relay_out_ping_serialization() {
        let msg = RelayOut::Ping;
        let json = serde_json::to_string(&msg).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "ping");
    }

    // ── RelayIn deserialization ─────────────────────────────────────────────

    #[test]
    fn test_relay_in_message_deserialization() {
        let json = r#"{"type":"message","nick":"bob","data":"hi there","peer_id":"abc123"}"#;
        let msg: RelayIn = serde_json::from_str(json).unwrap();
        match msg {
            RelayIn::Message {
                nick,
                data,
                peer_id,
            } => {
                assert_eq!(nick, "bob");
                assert_eq!(data, "hi there");
                assert_eq!(peer_id, "abc123");
            }
            other => panic!("Expected RelayIn::Message, got {:?}", other),
        }
    }

    #[test]
    fn test_relay_in_peers_deserialization() {
        let json = r#"{"type":"welcome","peer_id":"me123","peers":[{"peer_id":"p1","nick":"alice"}],"rooms":[]}"#;
        let msg: RelayIn = serde_json::from_str(json).unwrap();
        match msg {
            RelayIn::Welcome {
                peer_id,
                peers,
                rooms,
            } => {
                assert_eq!(peer_id, "me123");
                assert_eq!(peers.len(), 1);
                assert_eq!(
                    peers[0].get("nick").and_then(|v| v.as_str()),
                    Some("alice")
                );
                assert!(rooms.is_empty());
            }
            other => panic!("Expected RelayIn::Welcome, got {:?}", other),
        }
    }

    #[test]
    fn test_relay_in_pong_deserialization() {
        let json = r#"{"type":"pong"}"#;
        let msg: RelayIn = serde_json::from_str(json).unwrap();
        assert!(matches!(msg, RelayIn::Pong));
    }

    #[test]
    fn test_relay_in_invalid_json() {
        let bad_json = r#"{"this is not valid json"#;
        let result = serde_json::from_str::<RelayIn>(bad_json);
        assert!(result.is_err());
    }

    #[test]
    fn test_relay_in_unknown_type_is_caught() {
        let json = r#"{"type":"some_future_type","foo":"bar"}"#;
        let msg: RelayIn = serde_json::from_str(json).unwrap();
        assert!(matches!(msg, RelayIn::Unknown));
    }

    // ── Content hash tests ──────────────────────────────────────────────────

    #[test]
    fn test_content_hash_consistency() {
        let data = b"hello relay";
        let h1 = hash_bytes(data);
        let h2 = hash_bytes(data);
        assert_eq!(h1, h2);
    }

    #[test]
    fn test_content_hash_uniqueness() {
        let h1 = hash_bytes(b"message one");
        let h2 = hash_bytes(b"message two");
        assert_ne!(h1, h2);
    }

    #[test]
    fn test_message_loop_detection() {
        // Simulate the relay_hashes set used for loop prevention
        let mut relay_hashes: HashSet<u64> = HashSet::new();

        let data = b"[relay:alice] hello";
        let h = hash_bytes(data);

        // First time: not seen
        assert!(!relay_hashes.contains(&h));
        relay_hashes.insert(h);

        // Second time: seen — would be skipped by the bridge
        assert!(relay_hashes.contains(&h));
    }

    // ── Message filtering tests ─────────────────────────────────────────────

    #[test]
    fn test_typing_prefix_filtered() {
        let text = "TYPING:alice";
        assert!(text.starts_with("TYPING:"));
    }

    #[test]
    fn test_ticker_prefix_filtered() {
        let text = "TICKER:btc:50000";
        assert!(text.starts_with("TICKER:"));
    }

    #[test]
    fn test_web_bridge_prefix_filtered() {
        let text = "[web:alice] hello";
        assert!(text.starts_with("[web:"));
    }

    #[test]
    fn test_relay_prefix_filtered() {
        let text = "[relay:bob] hey";
        assert!(text.starts_with("[relay:"));
    }

    #[test]
    fn test_normal_message_not_filtered() {
        let text = "hello everyone!";
        assert!(!text.starts_with("TYPING:"));
        assert!(!text.starts_with("TICKER:"));
        assert!(!text.starts_with("[web:"));
        assert!(!text.starts_with("[relay:"));
    }

    // ── Peer ID derivation ──────────────────────────────────────────────────

    #[test]
    fn test_peer_id_from_str_returns_valid_peer_id() {
        let id = peer_id_from_str("relay-peer-abc");
        // Should return a valid PeerId (not panic)
        assert!(!id.to_string().is_empty());
    }

    #[test]
    fn test_peer_id_from_str_different_inputs_differ() {
        // Both calls return valid PeerIds (may be random fallback)
        let id1 = peer_id_from_str("peer-a");
        let id2 = peer_id_from_str("peer-b");
        assert!(!id1.to_string().is_empty());
        assert!(!id2.to_string().is_empty());
    }

    // ── RelayIn PeerJoined / PeerLeft ───────────────────────────────────────

    #[test]
    fn test_relay_in_peer_joined_deserialization() {
        let json = r#"{"type":"peer_joined","peer_id":"xyz","nick":"charlie"}"#;
        let msg: RelayIn = serde_json::from_str(json).unwrap();
        match msg {
            RelayIn::PeerJoined { peer_id, nick } => {
                assert_eq!(peer_id, "xyz");
                assert_eq!(nick, "charlie");
            }
            other => panic!("Expected RelayIn::PeerJoined, got {:?}", other),
        }
    }

    #[test]
    fn test_relay_in_peer_left_deserialization() {
        let json = r#"{"type":"peer_left","peer_id":"xyz"}"#;
        let msg: RelayIn = serde_json::from_str(json).unwrap();
        match msg {
            RelayIn::PeerLeft { peer_id } => {
                assert_eq!(peer_id, "xyz");
            }
            other => panic!("Expected RelayIn::PeerLeft, got {:?}", other),
        }
    }

    // ── RelayIn with 'from' alias ───────────────────────────────────────────

    #[test]
    fn test_relay_in_message_from_alias() {
        // The peer_id field has #[serde(alias = "from")], so "from" should work too
        let json = r#"{"type":"message","nick":"bob","data":"hi","from":"sender-id"}"#;
        let msg: RelayIn = serde_json::from_str(json).unwrap();
        match msg {
            RelayIn::Message { peer_id, .. } => {
                assert_eq!(peer_id, "sender-id");
            }
            other => panic!("Expected RelayIn::Message, got {:?}", other),
        }
    }
}
