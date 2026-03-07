# OpenWire — Domain-Driven Design: Bounded Contexts

## Overview

OpenWire is a serverless, peer-to-peer browser casino built on WebSocket mesh relay. The architecture maps to **10 bounded contexts** organised into 4 strategic domains.

---

## Strategic Domains

```
┌─────────────────────────────────────────────────────────────┐
│  CORE DOMAIN: Casino Platform                               │
│  ┌──────────────┐  ┌───────────┐  ┌──────────┐  ┌───────┐ │
│  │  Roulette    │  │ Blackjack │  │ AndarBahar│  │ Slots │ │
│  └──────────────┘  └───────────┘  └──────────┘  └───────┘ │
│  ┌──────────────┐                                           │
│  │ Classic Games│  (Tic-Tac-Toe)                           │
│  └──────────────┘                                           │
├─────────────────────────────────────────────────────────────┤
│  SUPPORTING DOMAIN: Casino Infrastructure                   │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │  Casino Platform  │  │  Administration  │                │
│  │  (GameEngine +    │  │  (Admin Portal)  │                │
│  │   casinoState)    │  │                  │                │
│  └──────────────────┘  └──────────────────┘                │
├─────────────────────────────────────────────────────────────┤
│  GENERIC SUBDOMAIN: Messaging & Presence                    │
│  ┌─────────────────────────────────────────┐               │
│  │  Messaging (P2P socket, Chat, GIF)      │               │
│  └─────────────────────────────────────────┘               │
├─────────────────────────────────────────────────────────────┤
│  GENERIC SUBDOMAIN: Identity & Access                       │
│  ┌─────────────────────────────────────────┐               │
│  │  Identity (Wallet, Device ID, Balance)  │               │
│  └─────────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────────┘
```

---

## Bounded Context Index

| Context | Type | Key Files | Description |
|---------|------|-----------|-------------|
| [Identity & Access](./01-identity-access.md) | Generic | `wallet.js` | Device identity, balance |
| [Messaging & Presence](./02-messaging-presence.md) | Generic | `socket.js`, `ChatRoom.jsx` | P2P relay, chat |
| [Casino Platform](./03-casino-platform.md) | Supporting | `GameEngine.js`, `casinoState.js` | Engine + LWW state |
| [Roulette](./04-roulette.md) | Core | `roulette.js`, `RouletteBoard.jsx` | European roulette |
| [Blackjack](./05-blackjack.md) | Core | `blackjack.js`, `BlackjackBoard.jsx` | Standard blackjack |
| [Andar Bahar](./06-andar-bahar.md) | Core | `andarbahar.js`, `AndarBaharBoard.jsx` | Indian card game |
| [Slots](./07-slots.md) | Core | `slots.js` | 3-reel weighted slots |
| [Classic Games](./08-classic-games.md) | Core | `game.js`, `GameBoard.jsx` | Tic-Tac-Toe |
| [Administration](./09-administration.md) | Supporting | `AdminPortal.jsx` | Kick, ban, P&L |
| [Frontend Shell](./10-frontend-shell.md) | Generic | `App.jsx`, `Landing.jsx` | Routing, UI orchestration |

---

## Context Map

```
Identity ──────────────────────────────────────────────┐
  (wallet.js provides peerId + balance)                 │
                                                        ▼
Messaging ◄──────────── P2P relay ────────────► Casino Platform
  (socket.js)           (WS relay)               (casinoState LWW)
       │                                                │
       │ peer events                                    │ game results
       ▼                                                ▼
  ChatRoom ◄──────── App.jsx (shell) ──────────► Game Boards
  GifPicker           (routes/mounts)             Roulette / BJ / AB / Slots

Administration reads Casino Platform state (housePnl) via casinoState.js
```

### Relationships
- **Identity → Messaging**: Upstream. Socket uses `peerId` + `nick` from wallet.
- **Messaging → Casino Platform**: Conformist. State diffs broadcast as `CS:` messages over socket.
- **Casino Platform → Game Boards**: Open Host Service. `GameEngine` abstract interface consumed by all game libs.
- **Administration → Casino Platform**: Customer/Supplier. Admin reads `housePnl` from `casinoState`.
