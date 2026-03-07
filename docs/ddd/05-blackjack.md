# Bounded Context: Blackjack

## Classification
Core Domain

## Responsibility
Standard Blackjack game: deck management, deal/hit/stand lifecycle, hand evaluation, and settlement.

## Key Files
- `openwire-web/src/lib/blackjack.js`
- `openwire-web/src/components/BlackjackBoard.jsx`

## Domain Model

### Value Objects
- `Card` — `{ suit, rank, value }`
- `Hand` — ordered array of `Card`
- `HandResult` — `'bust' | 'blackjack' | 'stand' | number`

### Key Functions
- `calcHand(cards)` — computes hand value; Ace can be 1 or 11
- `dealCard(deck)` — pops from shuffled deck
- `settleBets(playerHand, dealerHand, bet)` — returns chip delta

### Settlement Logic
| Outcome | Player Return |
|---------|--------------|
| Blackjack (natural) | 2.5× bet |
| Win | 2× bet |
| Push | 1× bet (refund) |
| Loss / Bust | 0 |

### Domain Events
- `HandDealt` — initial 2 cards dealt to player and dealer
- `PlayerHit` — player draws a card
- `PlayerStood` — dealer reveals and plays out
- `HandSettled` — chips distributed

## Ubiquitous Language
| Term | Meaning |
|------|---------|
| **Natural** | Blackjack dealt on first 2 cards |
| **Bust** | Hand value exceeds 21 |
| **Push** | Tie between player and dealer |
| **Soft Hand** | Hand containing Ace counted as 11 |

## Invariants
- Dealer hits on 16 or below, stands on 17+
- Ace value switches from 11 to 1 when total would exceed 21
- Blackjack only applies to initial 2-card deal

## Integration Points
- **Outbound → Casino Platform**: `updateHousePnl('blackjack', payouts)` on settlement

## Known Issues / Risks
- No split or double-down support yet
- Deck not reshuffled between rounds (shoe management not implemented)
