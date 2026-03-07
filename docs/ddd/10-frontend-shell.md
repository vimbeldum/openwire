# Bounded Context: Frontend Shell

## Classification
Generic Subdomain

## Responsibility
Application entry point, routing between screens, component mounting, and global state coordination. Acts as the composition root wiring all bounded contexts together.

## Key Files
- `openwire-web/src/App.jsx`
- `openwire-web/src/main.jsx`
- `openwire-web/src/components/Landing.jsx`
- `openwire-web/src/components/HowToPlay.jsx`

## Domain Model

### Application Screens
| Screen | Trigger | Components Mounted |
|--------|---------|-------------------|
| Landing | Initial load | `Landing.jsx` |
| Chat Room | Room joined | `ChatRoom.jsx`, game boards |
| Roulette | Game selection | `RouletteBoard.jsx` |
| Blackjack | Game selection | `BlackjackBoard.jsx` |
| Andar Bahar | Game selection | `AndarBaharBoard.jsx` |
| Classic Games | Game selection | `GameBoard.jsx` |
| How To Play | Help button | `HowToPlay.jsx` (overlay) |
| Admin Portal | Admin unlock | `AdminPortal.jsx` (overlay) |

### Global State (App.jsx)
- `peers` — live peer list from socket
- `casinoState` — unified LWW casino state
- `activityLog` — admin event log
- `bannedIps` — set of banned IP strings
- `activeGame` — currently selected game tab

## Ubiquitous Language
| Term | Meaning |
|------|---------|
| **Shell** | The outer App component that owns routing and global state |
| **Overlay** | Modal panel layered above the game (HowToPlay, AdminPortal) |
| **Active Game** | The currently selected game tab string |

## Integration Points
- **Composes**: All bounded contexts — mounts game boards, passes casino state, wires socket events
- **Reads from**: Identity (wallet), Messaging (socket events), Casino Platform (casinoState)
- **Writes to**: Casino Platform (propagates merged state), Messaging (sends CS: broadcasts)

## Invariants
- Only one game board active at a time
- Admin portal can only be opened by the host peer
- `HowToPlay` defaults to the active game's rules
