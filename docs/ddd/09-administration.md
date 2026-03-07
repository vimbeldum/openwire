# Bounded Context: Administration

## Classification
Supporting Domain

## Responsibility
Host-only administrative control: player management (kick/ban/balance), activity logging, house P&L reporting, and casino stats.

## Key Files
- `openwire-web/src/components/AdminPortal.jsx`

## Domain Model

### Entities
| Entity | Identity | Key Attributes |
|--------|----------|----------------|
| `BannedIp` | IP string | `bannedAt` |
| `ActivityLogEntry` | sequential | `time`, `message` |

### Value Objects
- `HousePnlSnapshot` — per-game chip totals at a point in time
- `PlayerSummary` — `{ peerId, nick, balance, ip }`

### Commands
| Command | Actor | Effect |
|---------|-------|--------|
| `KickPlayer(peerId)` | Host | Forces peer disconnect |
| `BanIp(peerId)` | Host | Adds peer's IP to ban list |
| `UnbanIp(ip)` | Host | Removes IP from ban list |
| `AdjustBalance(peerId, nick, delta)` | Host | Adds/subtracts chips |

### Domain Events
- `PlayerKicked` — logged to activity log
- `IpBanned` / `IpUnbanned` — logged and broadcast
- `BalanceAdjusted` — logged, peer notified via socket

## Ubiquitous Language
| Term | Meaning |
|------|---------|
| **Host** | The peer who created the room; holds admin authority |
| **Ban List** | Set of IP addresses denied entry to the room |
| **House P&L** | Net chip flow: positive = house won, negative = house lost |
| **Activity Log** | Append-only record of admin actions in the session |

## Access Control
- Admin portal protected by `VITE_ADMIN_PASSWORD` environment variable
- Password checked client-side in `AdminPasswordGate`
- No server-side enforcement — any peer can attempt to send admin commands

## Integration Points
- **Inbound ← Casino Platform**: Reads `casinoState.housePnl` and calls `getTotalHousePnl`
- **Inbound ← Messaging**: Peer list with `ip` field populated by relay server
- **Outbound → Messaging**: Kick/ban/adjust commands sent as socket messages

## Known Issues / Risks
- Admin password bundled in client-side JS (visible in Vite build output if `VITE_ADMIN_PASSWORD` is set)
- IP ban is advisory — banned peer can reconnect via VPN or different network
- No audit trail persistence — activity log is session-memory only
