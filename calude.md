# Claude Code Prompt — OpenWire Anonymous Chat App: Full Test Suite with Ruflo Swarm

> **Usage:** Paste this entire prompt into Claude Code. It will generate the test suite, execute it, invoke Ruflo swarm to fix failures, and re-run to verify.

---

## Context

You are working on **OpenWire**, an anonymous P2P/relay chat application with the following major feature areas:

1. **Core Messaging** — Encrypted P2P & relay messaging, room-based chat, persistent history (sessionStorage), @mentions with autocomplete, emoji reactions, whisper (private) mode, typing indicators, GIF picker, clipboard image pasting, screenshot detection alerts.
2. **AI Agent Swarm** — Multi-provider LLM agents (OpenRouter, Gemini, Qwen, Haimaker) with pop-culture character personalities, mood shifts, cross-agent interactions, per-user muting, admin chatter-level control, throttling/cooldowns, mention-only mode, provider/model overrides.
3. **Integrated Casino & Gaming** — Multiplayer Blackjack, Roulette, Andar Bahar, Tic-Tac-Toe; floating chat during games, in-chat game invites, ready-up system, live casino ticker, post-session summary, wallet/chip system, tipping, transaction history.
4. **Admin Portal** — Real-time player monitoring (IP, chips), kick/IP-ban, balance adjustment, house P&L tracker, richest player detection, AI swarm debugging (live logs, TPS/queue stats, context flush).
5. **Infrastructure** — Landing page (nick entry + admin toggle), global error boundary, relay/CLI-node mode switching.

---

## Task

### Phase 1: Analyze the codebase

```
Read the project structure, package.json, and key source files to understand:
- The framework and test runner already in use (if any)
- Component structure and file organization
- How messaging, AI agents, casino, and admin features are wired
- Existing test coverage (if any)
```

### Phase 2: Generate comprehensive test suite

Create test files organized by feature domain. Use the project's existing test framework if one is configured; otherwise default to **Vitest + React Testing Library + jsdom** for unit/component tests and **Playwright** for E2E tests.

#### 2.1 — Core Messaging Tests (`tests/messaging/`)

```
messaging.connection.test.ts
- Relay mode: successful connection to relay server
- Relay mode: reconnection on disconnect (exponential backoff)
- P2P/CLI Node mode: direct peer connection establishment
- Mode switching: seamless toggle between relay and P2P without message loss
- Connection timeout handling and user-facing error

messaging.rooms.test.ts
- Create a new room → room appears in room list
- Join an existing room by ID/name
- Leave room → user removed from participant list
- Room participant count updates in real time
- Prevent joining a non-existent room (error handling)
- Multiple rooms: messages in Room A do not leak to Room B

messaging.chat-core.test.ts
- Send a text message → appears in own chat and remote peer's chat
- Message ordering: messages render in chronological order
- Persistent history: reload page → sessionStorage restores messages
- Clear history: sessionStorage is wiped when session ends or user clears
- Long message handling (>5000 chars): no truncation or crash
- Empty message: send button is disabled / no empty bubble rendered
- Special characters and Unicode: emojis, RTL text, code blocks render correctly
- XSS prevention: injected <script> tags are sanitized

messaging.mentions.test.ts
- Typing "@" triggers autocomplete dropdown
- Autocomplete lists online users AND AI agents
- Selecting a mention inserts @username into the input
- Mentioned user receives a toast notification
- Mentioning an offline user: graceful handling (no crash, visual indicator)
- Mention in whisper mode: only the whisper recipient sees the notification

messaging.reactions.test.ts
- Add an emoji reaction to a message → reaction badge appears
- Multiple users react with the same emoji → count increments
- Remove own reaction → count decrements or badge disappears
- Reaction on a whisper message: only visible to whisper participants

messaging.whisper.test.ts
- Send whisper to a specific user → only sender and recipient see it
- Whisper messages are visually distinct (styling/badge)
- Other room participants cannot see whisper content
- Whisper to self: should be prevented or handled gracefully
- Whisper to a user who has left the room: error/notification

messaging.typing.test.ts
- User starts typing → typing indicator appears for other participants
- User stops typing (debounce ~2s) → indicator disappears
- Multiple users typing simultaneously → all indicators shown
- AI agent typing indicator while generating response

messaging.multimedia.test.ts
- GIF picker: search returns results, selecting sends GIF message
- GIF picker: empty search query / no results state
- Clipboard image paste: image appears as message with preview
- Clipboard paste of non-image content: no crash, handled gracefully
- Large image paste: size limit check or compression

messaging.security.test.ts
- Screenshot detection: event fires → room receives alert message
- Screenshot alert includes the username who triggered it
- Message encryption: message payload is not plaintext in transit (mock relay inspection)
```

#### 2.2 — AI Agent Swarm Tests (`tests/ai-swarm/`)

```
swarm.characters.test.ts
- Character store loads all configured characters with name, avatar, personality
- Each character has a valid mood property (happy, angry, chaotic, etc.)
- Character avatars render without broken images

swarm.responses.test.ts
- Agent responds to a direct @mention in chat
- Agent response reflects its assigned personality/character voice
- Context awareness: agent references recent chat history in response
- Mood shift: after negative messages, agent mood changes accordingly
- Cross-over: Agent A references Agent B in a reply

swarm.controls-user.test.ts
- Mute a single agent → that agent's messages are hidden for the muting user
- Mute all agents → no agent messages visible for that user
- Unmute agent → messages reappear
- Mute state persists across page reload (sessionStorage/localStorage)

swarm.controls-admin.test.ts
- Set chatter level to "Quiet" → agents respond less frequently
- Set chatter level to "Chaotic" → agents respond more frequently
- Mention-only mode ON → agents only speak when @mentioned
- Mention-only mode OFF → agents resume autonomous chatter
- Per-character cooldown: agent cannot respond more than once within cooldown window
- Global throttle: total agent messages per minute capped
- Provider/model override: admin assigns GPT-4 to a specific character → that character uses GPT-4
```

#### 2.3 — Casino & Gaming Tests (`tests/casino/`)

```
casino.wallet.test.ts
- New user starts with default chip balance
- Wallet balance persists across sessions (linked to nick)
- Balance cannot go negative (bet exceeding balance is rejected)
- Tipping: send chips to another user → sender decremented, receiver incremented
- Tip to non-existent user: error handling
- Transaction history: every win/loss/tip recorded with timestamp

casino.blackjack.test.ts
- Create a blackjack table → game lobby appears
- Join table → player seat assigned
- Deal cards → each player receives 2 cards, dealer shows 1
- Hit → player receives additional card
- Stand → turn passes to next player / dealer
- Bust (>21) → player loses, chips deducted
- Blackjack (21 on deal) → 3:2 payout
- Multiplayer: 2+ players at same table, turns alternate correctly
- Host migration: if host disconnects, next player becomes host
- Post-session summary: shows wins/losses/payout breakdown

casino.roulette.test.ts
- Betting grid renders all standard roulette positions
- Place bet → chips appear on grid position
- Spin → random number generated, winners paid out
- Multiple bet types: straight, split, red/black, odd/even
- Insufficient balance: bet rejected with notification
- Visual spin animation completes before result shown

casino.andar-bahar.test.ts
- Game starts with joker card drawn
- Players choose Andar or Bahar side
- Cards dealt alternately until match → correct side wins
- Payout calculated correctly for winners

casino.tictactoe.test.ts
- Create game → 3x3 grid renders
- Two players alternate X and O
- Win detection: row, column, diagonal
- Draw detection: all cells filled, no winner
- Rematch option after game ends

casino.ui.test.ts
- Floating chat: chat window minimizes to corner when game board opens
- Floating chat: messages still send/receive while minimized
- In-chat game invite: clickable message renders with "Join Game" button
- Clicking invite joins the correct game instance
- Ready-up system: all players must ready before round starts
- Live casino ticker: scrolling ticker shows game events in real time
- Ticker shows major wins with animation/highlight
```

#### 2.4 — Admin Portal Tests (`tests/admin/`)

```
admin.access.test.ts
- Non-admin user cannot access admin portal routes
- Admin user (flagged on landing page) can access admin portal
- Admin session persists until logout

admin.player-management.test.ts
- Online players list shows nick, IP, chip balance in real time
- Player goes offline → removed from online list (or marked offline)
- Kick user → user is disconnected from room with notification
- IP ban → banned user cannot reconnect from same IP
- Balance adjustment: admin adds 500 chips → player balance updates
- Balance adjustment: admin deducts chips → balance decreases (floor at 0)

admin.financials.test.ts
- House P&L tracker: shows profit/loss per game type (Blackjack, Roulette, etc.)
- P&L updates in real time after each game round
- Richest player: displays the user with highest chip balance
- Total chips in circulation: sum matches all player balances

admin.swarm-debug.test.ts
- Live log stream: shows AI agent internal logic and API responses
- AI stats dashboard: displays TPS (tokens per second), queue length, error rate
- Context flush: clicking "flush memory" resets AI conversation context
- Error rate spike: visual alert when error rate exceeds threshold
```

#### 2.5 — Infrastructure & Cross-Cutting Tests (`tests/infrastructure/`)

```
infra.landing.test.ts
- Landing page renders with nick input and join button
- Empty nick: join button disabled or shows validation error
- Duplicate nick: server rejects with appropriate error
- Admin toggle: checking admin box grants admin access after join
- Nick with special characters: sanitized or rejected

infra.error-boundary.test.ts
- Unhandled component error → error boundary catches and shows fallback UI
- Error boundary displays useful debug information
- Recovery: user can retry or navigate away from error state

infra.connection-modes.test.ts
- Default mode is Relay
- Switch to CLI Node mode → connection type changes
- Messages sent in one mode are compatible with the other

infra.performance.test.ts
- 100 messages in rapid succession: no dropped messages, no UI freeze
- 50 concurrent users in a room: participant list renders correctly
- Memory leak check: sessionStorage does not grow unbounded over long sessions

infra.accessibility.test.ts
- All interactive elements are keyboard-navigable
- Chat input has appropriate ARIA labels
- Screen reader announces new messages
- Color contrast meets WCAG 2.1 AA minimum
- Focus management: opening modals traps focus, closing restores it

infra.responsive.test.ts
- Chat UI renders correctly at mobile viewport (375px)
- Chat UI renders correctly at tablet viewport (768px)
- Chat UI renders correctly at desktop viewport (1440px)
- Game boards scale appropriately on small screens
- Admin portal is usable on tablet+
```

### Phase 3: Run the test suite

```
Execute all tests. Capture the full output including:
- Total tests passed / failed / skipped
- Failure details: file, test name, error message, stack trace
- Any setup/teardown issues
```

### Phase 4: Ruflo swarm — fix all failures

```
For each failing test, use Ruflo swarm mode to:
1. Identify the root cause (missing implementation, incorrect logic, broken selector, race condition, etc.)
2. Apply the minimal fix to the source code — do NOT modify test expectations unless the test itself has a bug
3. Prioritize fixes in this order:
   a. Setup/config issues (missing deps, env vars, incorrect imports)
   b. Unit test failures (pure logic bugs)
   c. Component test failures (rendering, state, event handling)
   d. Integration/E2E test failures (multi-component interactions)
4. After fixing a batch of related issues, run just those tests to verify before moving on
5. Document every fix with a one-line summary
```

### Phase 5: Re-run full suite and report

```
Run the complete test suite again. Produce a final report:

## Test Results Summary
| Domain            | Total | Passed | Failed | Skipped |
|-------------------|-------|--------|--------|---------|
| Messaging         | ...   | ...    | ...    | ...     |
| AI Swarm          | ...   | ...    | ...    | ...     |
| Casino & Gaming   | ...   | ...    | ...    | ...     |
| Admin Portal      | ...   | ...    | ...    | ...     |
| Infrastructure    | ...   | ...    | ...    | ...     |
| **TOTAL**         | ...   | ...    | ...    | ...     |

## Fixes Applied
1. [file] — one-line description
2. ...

## Remaining Issues (if any)
- Description and recommended next steps

## Coverage Gaps Identified
- Any untested edge cases or features discovered during analysis
```

---

## Important Notes

- **Do NOT skip any feature area.** Every feature listed above must have corresponding tests.
- **Mock external dependencies** (LLM APIs, relay server, WebRTC) — tests must run without live network calls.
- **Respect the existing code style** — match indentation, naming conventions, and patterns already in the codebase.
- **If a feature is not yet implemented**, write the test anyway and mark it as `.todo()` or `.skip()` with a comment like `// Feature not yet implemented — stub test`.
- **Be aggressive with edge cases** — null inputs, race conditions, disconnections mid-action, concurrent operations.
- **Security tests are mandatory** — XSS, injection, unauthorized access, data leakage between rooms/whispers.

---

## Ruflo Configuration Hint

If using `ruflo` CLI, the swarm can be kicked off with:

```bash
ruflo swarm --test-cmd "npm run test" --fix --rerun --max-iterations 5
```

Adjust `--test-cmd` to match the project's actual test runner command. Set `--max-iterations` to limit fix-rerun cycles and prevent infinite loops on genuinely broken features.
