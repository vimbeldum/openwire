# Bounded Context: Casino Platform

## Classification
Supporting Domain

## Responsibility
Provides the abstract `GameEngine` interface consumed by all game implementations, unified LWW (Last-Write-Wins) P2P state management for house P&L across games, and localStorage persistence.

## Key Files
- `openwire-web/src/lib/GameEngine.js`
- `openwire-web/src/lib/casinoState.js`

## Domain Model

### Aggregate: CasinoState
```
CasinoState {
  housePnl: {
    roulette: number,
    blackjack: number,
    andarbahar: number,
    slots: number,
    _ts: number        // LWW timestamp
  },
  _ts: number          // aggregate timestamp
}
```

### Abstract Base: GameEngine
```
GameEngine (abstract) {
  getGameState()           // → current game state snapshot
  calculatePayout(bets, result)  // → { peerId: chipDelta }
  getRules()               // → rules object for HowToPlay
}
```

### Game Registry
- `registerGame(gameType, EngineClass)` — maps type string to engine
- `createGameEngine(gameType, gameState)` — factory
- `getRegisteredGames()` — list registered types

### Domain Events
- `HousePnlUpdated` — after any game settles; triggers localStorage save
- `StateMerged` — when remote `CS:` message is processed via LWW

## Ubiquitous Language
| Term | Meaning |
|------|---------|
| **House P&L** | Net chip gain/loss across all games from the house perspective |
| **LWW** | Last-Write-Wins — conflict resolution using `_ts` timestamps |
| **Engine** | Registered game class implementing `GameEngine` interface |
| **Settlement** | Resolving bets after a game round; updating balances and housePnl |

## Invariants
- Remote state wins only when `remote.housePnl._ts > local.housePnl._ts`
- `updateHousePnl` must atomically update both `housePnl[gameType]` and `_ts`
- `GameEngine` subclasses must implement all three abstract methods

## Integration Points
- **Inbound ← Game Contexts**: Each game calls `updateHousePnl` on settlement
- **Outbound → Messaging**: Serialised state broadcast as `CS:` over socket
- **Outbound → Administration**: `getTotalHousePnl(casinoState)` consumed by Stats tab

## Registered Engines
| Type | Engine Class | File |
|------|-------------|------|
| `roulette` | `RouletteEngine` | `roulette.js` |
| `slots` | `SlotsEngine` | `slots.js` |

## Known Issues / Risks
- LWW can lose P&L data if two hosts settle simultaneously with same timestamp
- `localStorage` unavailable in private mode degrades to in-memory only
- No server-side authoritative state — all P&L is peer-reported
