# Bounded Context: Andar Bahar

## Classification
Core Domain

## Responsibility
Traditional Indian card game Andar Bahar: joker selection, card dealing to two piles, and bet settlement.

## Key Files
- `openwire-web/src/lib/andarbahar.js`
- `openwire-web/src/components/AndarBaharBoard.jsx`

## Domain Model

### Value Objects
- `Card` — `{ suit, rank }`
- `Joker` — the cut card drawn at game start
- `Pile` — `'andar' | 'bahar'`

### Key Functions
- `pickJoker(deck)` — selects the reference card
- `dealToSide(deck, joker)` — alternates cards between piles until a match is found
- `settleBet(betSide, winningSide, bet)` — returns chip delta (1:0.9 payout to account for house edge)

### Domain Events
- `JokerPicked` — reference card revealed
- `CardDealt` — each card placed to Andar or Bahar
- `MatchFound` — game ends, winner determined
- `BetSettled` — chips distributed

## Ubiquitous Language
| Term | Meaning |
|------|---------|
| **Joker** | The reference/cut card; game ends when its rank appears again |
| **Andar** | Left pile (Inside) |
| **Bahar** | Right pile (Outside) |
| **Match** | A dealt card whose rank equals the Joker's rank |

## Invariants
- Dealing always starts to Andar
- Game ends as soon as a matching rank appears in either pile
- Payout is 0.9:1 (house takes 10% edge)

## Integration Points
- **Outbound → Casino Platform**: `updateHousePnl('andarbahar', payouts)` on settlement

## Known Issues / Risks
- No multi-player simultaneous betting — currently single-player vs house
- RNG uses `Math.random()`, not CSPRNG
