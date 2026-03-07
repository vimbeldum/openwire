# Bounded Context: Messaging & Presence

## Classification
Generic Subdomain

## Responsibility
Handles all real-time peer-to-peer communication: room management, peer discovery, chat messages, GIF sharing, and casino state broadcasts over a shared WebSocket relay.

## Key Files
- `openwire-web/src/lib/socket.js`
- `openwire-web/src/components/ChatRoom.jsx`
- `openwire-web/src/components/GifPicker.jsx`

## Domain Model

### Entities
| Entity | Identity | Key Attributes |
|--------|----------|----------------|
| `Room` | 6-char alphanumeric code | `hostId`, `peers[]` |
| `Peer` | `peerId` | `nick`, `balance`, `ip` |

### Value Objects
- `ChatMessage` — `{ from, nick, text, ts }`
- `GifMessage` — `{ from, nick, gifUrl, ts }`
- `CasinoStateDiff` — serialised as `CS:` prefixed JSON string

### Domain Events (wire messages)
| Message Type | Direction | Purpose |
|-------------|-----------|---------|
| `JOIN` | peer → relay | Announce presence in room |
| `LEAVE` | peer → relay | Disconnect notification |
| `CHAT` | peer → peers | Text chat |
| `GIF` | peer → peers | GIF share |
| `CS:` prefix | peer → peers | Casino state sync (LWW) |
| `KICK` | host → peer | Force disconnect |
| `BAN` | host → peer | IP ban |
| `BALANCE_ADJUST` | host → peer | Chip adjustment |

## Ubiquitous Language
| Term | Meaning |
|------|---------|
| **Room** | Shared session identified by 6-char code |
| **Host** | First peer to create the room; has admin privileges |
| **Relay** | Central WebSocket server forwarding messages between peers |
| **Broadcast** | Message sent to all peers in the room |

## Invariants
- Room codes are case-insensitive alphanumeric, 6 characters
- Only the host peer can send KICK, BAN, BALANCE_ADJUST

## Integration Points
- **Inbound ← Identity**: Uses `peerId` and `nick` from wallet
- **Inbound ← Casino Platform**: Serialises `casinoState` as `CS:` broadcast
- **Outbound → Casino Platform**: Deserialises incoming `CS:` messages and calls `mergeCasinoStates`

## Known Issues / Risks
- WebSocket relay uses plaintext `ws://` — no TLS encryption in transit
- No peer authentication; any client can spoof any `peerId` or `nick`
- `KICK`/`BAN` enforcement is client-side; banned peers can reconnect with new identity
- Chat messages not sanitised — potential XSS if rendered via `innerHTML`
