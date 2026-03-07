# Bounded Context: Identity & Access

## Classification
Generic Subdomain

## Responsibility
Manages device-level identity, persistent nickname, and chip balance for each player. No server-side authentication — identity is derived from a locally generated UUID stored in `localStorage`.

## Key Files
- `openwire-web/src/lib/wallet.js`

## Domain Model

### Entities
| Entity | Identity | Key Attributes |
|--------|----------|----------------|
| `Wallet` | `peerId` (UUID v4, localStorage) | `nick`, `balance` |

### Value Objects
- `peerId` — immutable UUID, generated once on first visit
- `nick` — mutable display name (user-set)
- `balance` — integer chip count

### Domain Events
- `BalanceChanged` — emitted when house adjusts balance or game settles
- `NickChanged` — when player updates display name

## Ubiquitous Language
| Term | Meaning |
|------|---------|
| **Wallet** | The local player record (id + nick + chips) |
| **Chips** | Integer currency unit, no real-world value |
| **peerId** | Stable device identifier for this session and beyond |

## Invariants
- `peerId` must never change after first generation
- `balance` must be >= 0 (enforced by callers)

## Integration Points
- **Outbound → Messaging**: `peerId` and `nick` embedded in every socket message
- **Inbound ← Administration**: Host can adjust `balance` via `onAdjustBalance` command

## Known Issues / Risks
- Identity is device-local only; no cross-device continuity
- `balance` is client-authoritative — host peer must validate
- No rate limiting on nick changes
