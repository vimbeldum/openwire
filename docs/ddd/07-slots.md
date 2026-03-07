# Bounded Context: Slots

## Classification
Core Domain

## Responsibility
3-reel weighted symbol slot machine: spin, result evaluation, and payout calculation.

## Key Files
- `openwire-web/src/lib/slots.js`

## Domain Model

### Value Objects
- `Symbol` — emoji string (e.g., `'7️⃣'`, `'💎'`, `'🍒'`, `'🍋'`, `'⭐'`, `'🎰'`)
- `Reels` — array of 3 symbols (one per reel)
- `SpinResult` — `{ reels: Symbol[], payout: number }`

### Payout Table
| Combination | Multiplier |
|-------------|-----------|
| `7️⃣7️⃣7️⃣` | 50× |
| `💎💎💎` | 20× |
| `🍒🍒🍒` | 10× |
| `🍒🍒` (any pos) | 2× |
| Any triple | 5× |

### Aggregates
- `SlotsEngine extends GameEngine`
  - `spinReels(count)` — weighted random selection per reel
  - `calculatePayout(bets, result)` — applies multiplier to bet
  - `getRules()` — `SLOTS_RULES` for HowToPlay display

### Domain Events
- `ReelsSpun` — three symbols selected
- `WinEvaluated` — payout multiplier determined
- `BetSettled` — chips transferred

## Ubiquitous Language
| Term | Meaning |
|------|---------|
| **Reel** | One spinning column showing a symbol |
| **Payline** | Winning combination across the 3 reels |
| **Multiplier** | Factor applied to bet on win |
| **Weighted Spin** | Symbol selection where rare symbols appear less often |

## Invariants
- Always exactly 3 reels per spin
- Payout of 0 on no match (bet lost)
- Weights must sum to a positive value

## Integration Points
- **Inbound ← Casino Platform**: Registered via `registerGame('slots', SlotsEngine)`
- **Outbound → Casino Platform**: Calls `updateHousePnl('slots', payouts)` on settlement

## Status
Scaffolded — UI not yet wired to `SlotsEngine`; logic and tests complete.
