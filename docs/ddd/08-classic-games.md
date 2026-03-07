# Bounded Context: Classic Games

## Classification
Core Domain

## Responsibility
Non-casino peer-to-peer games (no house edge). Currently: Tic-Tac-Toe with multiplayer via socket.

## Key Files
- `openwire-web/src/lib/game.js`
- `openwire-web/src/components/GameBoard.jsx`

## Domain Model

### Entities
| Entity | Identity | Key Attributes |
|--------|----------|----------------|
| `TicTacToeGame` | room-scoped | `board[9]`, `currentTurn`, `winner` |

### Value Objects
- `Board` — 9-cell array (`null | 'X' | 'O'`)
- `Move` — `{ cellIndex, player }`
- `GameResult` — `'X' | 'O' | 'draw' | null`

### Key Functions
- `initBoard()` — returns empty 9-cell array
- `applyMove(board, cellIndex, player)` — returns new board
- `checkWinner(board)` — returns winner string or null
- `isDraw(board)` — all cells filled, no winner

### Win Conditions
All 8 lines: 3 rows, 3 columns, 2 diagonals.

### Domain Events
- `MoveMade` — cell claimed, broadcast to opponent
- `GameWon` — winner determined
- `GameDraw` — board full, no winner
- `GameReset` — new round started

## Ubiquitous Language
| Term | Meaning |
|------|---------|
| **X / O** | Player markers; host is always X |
| **Board** | 3×3 grid of 9 cells |
| **Line** | Any row, column, or diagonal of 3 cells |

## Invariants
- Only 2 players per game (host = X, guest = O)
- A player cannot move out of turn
- Occupied cells cannot be overwritten

## Integration Points
- **Outbound → Messaging**: Move broadcast as socket message
- **No house P&L**: Classic games have no chip wagering
