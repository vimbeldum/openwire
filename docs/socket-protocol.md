# OpenWire Socket Protocol

WebSocket relay at `VITE_RELAY_URL` (default `ws://localhost:8787`).
All messages are UTF-8 JSON text frames. Binary frames are rejected.
Max message size: **50 KB** (relay drops silently above this).

---

## 1. Client → Server Messages

| `type` | Description |
|---|---|
| `join` | First message after connect. Establishes identity. |
| `ping` | Keep-alive sent every ~14-16 s. Server ignores (no pong). |
| `message` | Broadcast text/JSON to all connected peers. |
| `balance_update` | Publish updated chip balance so peer list stays fresh. |
| `room_create` | Create a named room; sender becomes host. |
| `room_join` | Join an existing room by ID. |
| `room_leave` | Leave a room. |
| `room_message` | Send a message to a specific room. |
| `room_invite` | Invite another peer into a room. |
| `room_list` | Ask relay for current room list. |
| `room_state_snapshot` | Host pushes latest game state for migration. |
| `admin_kick` | (admin) Kick a peer by `peer_id`. |
| `admin_ban_ip` | (admin) Ban peer IP + disconnect. |
| `admin_unban_ip` | (admin) Remove an IP from the ban list. |
| `admin_adjust_balance` | (admin) Relay a balance delta to a peer. |
| `admin_get_bans` | (admin) Fetch the current ban list. |

### join
```json
{ "type": "join", "nick": "Alice", "admin_secret": "(optional)", "is_bridge": false }
```
- `nick` truncated to 24 chars; relay deduplicates with a numeric suffix.
- `admin_secret` enables admin privileges via constant-time comparison.
- `is_bridge` (optional, default `false`) marks this peer as a CLI bridge node.

### message
```json
{ "type": "message", "data": "hello" }
```
`data` may also be a JSON string carrying an embedded sub-action (see §4).

### balance_update
```json
{ "type": "balance_update", "balance": 1000 }
```

### room_create
```json
{ "type": "room_create", "name": "My Room" }
```

### room_join / room_leave
```json
{ "type": "room_join",  "room_id": "room-<uuid>" }
{ "type": "room_leave", "room_id": "room-<uuid>" }
```

### room_message
```json
{ "type": "room_message", "room_id": "room-<uuid>", "data": "<payload>" }
```
`data` may be: plain text, game action (prefixed), or embedded JSON sub-action.

### room_invite
```json
{ "type": "room_invite", "room_id": "room-<uuid>", "peer_id": "<target-peer-id>" }
```

### room_state_snapshot
```json
{ "type": "room_state_snapshot", "room_id": "room-<uuid>", "state": "<json-string>" }
```
Host-only; max 100 KB. Stored in relay for host-migration recovery.

---

## 2. Server → Client Messages

| `type` | Description |
|---|---|
| `welcome` | Sent immediately after `join` succeeds. |
| `peers` | Full peer list refresh (after kick/ban). |
| `peer_joined` | A new peer connected. |
| `peer_left` | A peer disconnected. |
| `peer_balance_update` | Single-peer balance diff. |
| `message` | A broadcast message from another peer. |
| `room_created` | Confirmation that a room was created. |
| `room_joined` | Confirmation that you joined a room. |
| `room_peer_joined` | Another peer joined your current room. |
| `room_peer_left` | A peer left your current room. |
| `room_invite` | You received an invite to a room. |
| `room_message` | A message inside a room you are in. |
| `room_list` | Response to `room_list` request. |
| `host_left` | Former host disconnected; new host elected. |
| `kicked` | You were kicked by an admin. |
| `banned` | You are banned from this server. |
| `banned_ips` | (admin) Current list of banned IPs. |
| `admin_adjust_balance` | (admin-initiated) Balance adjustment for you. |
| `error` | Generic error with `message` field. |
| `rate_limited` | Client is sending too fast; message was dropped. |

### welcome
```json
{
  "type": "welcome",
  "peer_id": "abc123",
  "nick": "Alice",
  "peers": [{ "peer_id": "...", "nick": "...", "balance": 0 }],
  "rooms": [{ "room_id": "...", "name": "...", "members": 1, "hostPeerId": "..." }]
}
```

### peer_joined
```json
{ "type": "peer_joined", "peer_id": "abc123", "nick": "Alice", "is_admin": false, "is_bridge": false }
```

### peer_left
```json
{ "type": "peer_left", "peer_id": "abc123", "nick": "Alice" }
```

### message (server → client)
```json
{ "type": "message", "from": "abc123", "nick": "Alice", "data": "hello" }
```

### room_message (server → client)
```json
{ "type": "room_message", "room_id": "room-<uuid>", "from": "abc123", "nick": "Alice", "data": "<payload>" }
```

### host_left
```json
{
  "type": "host_left",
  "old_host": "abc123",
  "new_host": "def456",
  "room_id": "room-<uuid>",
  "gameSnapshots": "{ \"roulette\": {...}, \"blackjack\": {...} }"
}
```

---

## 3. Embedded Sub-Actions in `data` Field

Both `message` and `room_message` carry a `data` string. When `data` starts with `{`, the client
attempts to parse it as one of these sub-action types:

| Sub-type | Channel | Description |
|---|---|---|
| `typing` | both | Typing indicator: `{ type, nick }` |
| `react` | both | Emoji reaction: `{ type, msgId, emoji, nick }` |
| `tip` | both | Tip chips: `{ type, to, nick, amount }` |
| `screenshot_alert` | both | Screenshot notification: `{ type, nick }` |
| `casino_ticker` | both | Casino result broadcast: `{ type, game, result, ... }` |
| `whisper` | both | Private message visible only to recipient: `{ type, to, nick, text }` |
| `agent_message` | both | AI agent reply: `{ type, agentName, text, ... }` |
| `mention_notify` | both | @mention alert: `{ type, from, to, text }` |
| `swarm_config` | both | Swarm agent configuration update |
| `context_summary` | both | Agent context summary broadcast |
| `admin_announce` | both | Admin peer-ID broadcast for swarm dedup |
| `ready_up` | room | Ready-up for next round: `{ type, gameType, peer_id }` |
| `game_new_round` | room | New-round trigger: `{ type, gameType, peer_id }` |

Game-specific payloads use prefixed serialization (handled by game engine libs):
- `BJ:` — Blackjack action
- `RL:` — Roulette action
- `AB:` — Andar Bahar action
- `PM:` — Polymarket action
- `CS:` — Casino state (LWW P2P merge)

---

## 4. CLI Gossipsub → WebSocket Mapping

| CLI Gossipsub Topic | CLI Payload Type | WebSocket Equivalent |
|---|---|---|
| `openwire-general` | `SignedMessage` (Ed25519-signed bytes) | `{ type: "message", data: "<text>" }` |
| `openwire-key-exchange` | `KeyExchangeMessage` (signed JSON) | No direct WS equivalent (internal P2P only) |
| `openwire-file-transfer` | `FileTransferMessage` (signed JSON) | No direct WS equivalent (CLI-only) |
| `openwire-room-invite` | `RoomInvite` (encrypted, signed) | `{ type: "room_invite", room_id, room_name, from, from_nick }` |
| `openwire-room-<id>` | `EncryptedRoomMessage` | `{ type: "room_message", room_id, data }` |
| `openwire-peer-<id>` | Encrypted direct message | No direct WS equivalent |

A CLI bridge node connecting to the relay uses the same WebSocket protocol as a web client.
It identifies itself with `is_bridge: true` in the `join` message. The relay marks it as a bridge
peer and includes `is_bridge: true` in the `peer_joined` broadcast so web clients can show a
visual badge.

---

## 5. Key Flows

### Connect & Join
```
Client                        Relay
  |--- WS upgrade ----------->|
  |--- { type: join, nick } ->|
  |<-- { type: welcome, ... } |
  |<-- { type: peer_joined }  | (broadcast to all others)
```

### Send General Message
```
Alice                         Relay                         Bob
  |--- { type: message } ---->|
  |                           |--- { type: message, from, nick, data } --> Bob
```

### Create and Join Room
```
Alice                         Relay                         Bob
  |--- { type: room_create } ->|
  |<-- { type: room_created }  |
  |                            |<-- { type: room_join, room_id } -- Bob
  |                            |--> { type: room_joined }        -> Bob
  |<-- { type: room_peer_joined, nick: Bob }
```

### Game Start (via Room)
```
Host (Alice)                  Relay                         Player (Bob)
  |--- room_message(BJ:start)->|
  |                            |--- room_message(BJ:start) ------> Bob
  |--- room_message(BJ:state)->|
  |                            |--- room_message(BJ:state) ------> Bob
```

### CLI Bridge Connect
```
CLI Bridge                    Relay                         Web Client
  |--- { type: join, nick: "cli-node", is_bridge: true } -->|
  |<-- { type: welcome }                                     |
  |                           |-- { type: peer_joined, is_bridge: true } --> Web
  |<-- room_message(forward) --| (relay forwards room msgs to bridge)
  |--- room_message(gossipsub payload) -> Relay -> Web
```

---

## 6. Security Notes

- All messages are plain JSON text; no binary frames.
- `peer_id` is always server-generated (UUID-based); client-supplied IDs are ignored.
- Rate limit: 30 messages/s refill, 40 burst cap. Exceeding drops messages with `rate_limited`.
- Per-IP connection limit: 5 concurrent connections.
- IP bans are persisted in Durable Object storage across restarts.
- Admin secret uses constant-time comparison to prevent timing attacks.
- Message size hard limit: 50 KB (relay silently drops oversized messages).
- Room state snapshots: 100 KB max, host-only writes.
