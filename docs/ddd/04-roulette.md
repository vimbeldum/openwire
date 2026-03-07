# Bounded Context: Roulette

## Classification
Core Domain

## Responsibility
European Roulette game: spin lifecycle, bet placement, payout calculation, and real-time animated wheel UI.

## Key Files
- `openwire-web/src/lib/roulette.js`
- `openwire-web/src/components/RouletteBoard.jsx`

## Domain Model

### Entities
| Entity | Identity | Key Attributes |
|--------|----------|----------------|
| `RouletteRound` | round sequence | `bets[]`, `result`, `phase` |

### Value Objects
- `Bet` — `{ type, target, amount, peerId }`
- `SpinResult` — `{ number: 0-36, color: 'red'|'black'|'green' }`

### Aggregates
- `RouletteEngine extends GameEngine`
  - `calculatePayout(bets, result)` → delegates to `getPayout()`
  - `getRules()` → `ROULETTE_RULES`

### Bet Types & Payouts
| Bet | Payout |
|-----|--------|
| Straight (single number) | 35:1 |
| Split (2 numbers) | 17:1 |
| Street (row of 3) | 11:1 |
| Corner (4 numbers) | 8:1 |
| Red/Black | 1:1 |
| Odd/Even | 1:1 |
| Low/High (1-18/19-36) | 1:1 |

### Domain Events
- `BettingOpened` — countdown starts, bets accepted
- `WheelSpun` — RNG determines result, wheel animates
- `RoundSettled` — payouts distributed, housePnl updated

## Ubiquitous Language
| Term | Meaning |
|------|---------|
| **Pocket** | One of 37 numbered slots on the wheel (0-36) |
| **Layout** | The betting grid displayed to players |
| **En Prison** | Not implemented; noted for future |
| **Croupier** | Host peer managing the spin lifecycle |

## Invariants
- Only 37 pockets (0-36), no 00 (European rules)
- Pocket 0 is green; Red/Black determined by standard European layout
- Betting phase closes before wheel animation begins

## Integration Points
- **Inbound ← Casino Platform**: Extends `GameEngine`; calls `registerGame('roulette', RouletteEngine)`
- **Outbound → Casino Platform**: Calls `updateHousePnl` on settlement
- **Outbound → Messaging**: Spin result broadcast to all peers

## Known Issues / Risks
- RNG is `Math.random()` — not cryptographically random; outcomes predictable in theory
- Spin lifecycle managed entirely client-side by host peer
