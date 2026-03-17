# Claude Code Prompt — OpenWire: Implement Browser Tests + Fix Coverage Gaps

You are working on **OpenWire**, an anonymous P2P/relay chat app. A prior test run completed with 46 todo/skipped tests that require a browser environment and identified 5 coverage gaps in the source code. Your job is to implement everything below, then run tests to verify.

---

## PHASE 1: Setup Browser Test Environment

Before writing any tests, set up the browser testing infrastructure:

1. Ensure `jsdom` is the test environment for all files under `tests/browser/`. In `vitest.config.ts` (or equivalent), add an environment override:
   ```
   test: {
     environmentMatchGlobs: [
       ['tests/browser/**', 'jsdom']
     ]
   }
   ```
2. Install any missing deps:
   ```
   @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
   ```
3. Confirm React Testing Library renders a trivial component before proceeding.

---

## PHASE 2: Implement the 46 Browser/React Tests

Create all test files under `tests/browser/`. Use `@testing-library/react` for rendering, `@testing-library/user-event` for interactions, and `@testing-library/jest-dom` for DOM assertions. Mock all network/socket/API calls — zero live calls.

### 2.1 — Mentions Autocomplete (`tests/browser/mentions.test.tsx`)

```
- Typing "@" in the chat input renders an autocomplete dropdown
- Dropdown lists all online users by nick
- Dropdown also lists available AI agent characters
- Typing "@fo" filters the list to nicks/agents starting with "fo"
- Clicking a dropdown item inserts "@username " into the input field and closes the dropdown
- Pressing Enter on a highlighted dropdown item inserts it
- Pressing Escape closes the dropdown without inserting
- Dropdown does not render when "@" is inside a code block or backtick
- Mentioned user receives a toast notification component (verify toast renders)
- Mentioning a user who has left: dropdown does not show them, or shows a "offline" indicator
```

### 2.2 — GIF Picker & Clipboard (`tests/browser/multimedia.test.tsx`)

```
- GIF picker button opens the picker panel/modal
- Typing a search query in the picker fires a debounced search (mock the GIF API)
- Search results render as clickable thumbnail images
- Clicking a GIF thumbnail sends a message with the GIF URL/embed
- Empty search results state: shows "No GIFs found" placeholder
- Closing the picker without selecting does not send anything
- Clipboard paste of an image (mock ClipboardEvent with image/png blob): image preview renders in compose area
- Confirm/send the pasted image: message with image attachment appears in chat
- Clipboard paste of plain text: no image preview, text goes into input as normal
- Clipboard paste of a very large image (>5MB mock): shows size limit warning, does not send
```

### 2.3 — Whisper Mode UI (`tests/browser/whisper.test.tsx`)

```
- Whisper messages have a distinct visual style (e.g., specific CSS class like ".whisper", different background, or a lock icon)
- Whisper messages show a "Only visible to you and <recipient>" label
- Non-whisper messages do NOT have the whisper styling
- Whisper input mode: activating whisper mode (e.g., "/whisper @user" or a UI toggle) changes the compose bar appearance
- Sending a whisper: message renders in the chat for the sender with whisper styling
- Verify the whisper message component does NOT render in a mocked "other user" context (simulate another peer's message list not containing the whisper)
```

### 2.4 — Admin Portal Components (`tests/browser/admin-portal.test.tsx`)

```
- AdminPortal component renders only when user has admin flag (prop/context)
- Non-admin user: AdminPortal returns null or redirects
- Player list table renders rows for each online player with columns: nick, IP, chips
- Kick button next to a player: clicking it calls the kick handler with correct player ID
- Kick confirmation dialog appears before executing kick
- Ban button: clicking it calls the IP ban handler with the player's IP
- Balance adjustment: admin enters a positive number and clicks "Add" → handler called with (playerId, +amount)
- Balance adjustment: admin enters a number and clicks "Deduct" → handler called with (playerId, -amount)
- Balance adjustment: entering a negative number or non-numeric input → validation error shown, handler NOT called
- Balance adjustment: deducting more than player's balance → handler receives the amount (server-side floors at 0), OR UI shows warning
- House P&L section: renders a table/card per game type with profit/loss values
- Richest player display: shows the nick and balance of the top player
- Swarm debug panel: "Flush Memory" button calls the context-flush handler
- AI stats dashboard: renders TPS, queue length, error rate from mocked data
```

### 2.5 — Accessibility & Responsive (`tests/browser/accessibility.test.tsx`)

```
- Chat input has an accessible label (aria-label or associated <label>)
- Send button has aria-label or accessible text
- All interactive buttons (GIF picker, emoji, whisper toggle, game invite) are keyboard-focusable (tabIndex >= 0 or native <button>)
- Opening a modal (GIF picker, game board, admin dialog) traps focus within it
- Closing a modal returns focus to the trigger element
- New chat message: the message container has aria-live="polite" or role="log" for screen reader announcements
- Emoji reaction buttons have aria-label describing the emoji (e.g., "React with thumbs up")
- Color contrast: verify the chat bubble text color and background color meet 4.5:1 ratio (use a contrast-check utility or snapshot the computed styles)
```

### 2.6 — Viewport / Responsive (`tests/browser/responsive.test.tsx`)

```
- At 375px viewport width: chat container does not overflow horizontally
- At 375px: game board (if rendered) scales down or switches to mobile layout
- At 768px: sidebar (room list or player list) and chat coexist without overlap
- At 1440px: full desktop layout renders with sidebar + chat + optional right panel
- Floating chat window (during game): renders as a minimized overlay at small and large viewports
```

### 2.7 — AI Personality Verification (`tests/browser/ai-personality.test.tsx`)

Since live LLM calls are not available in tests, verify the **prompt construction and character injection** rather than actual model output:

```
- When an agent is triggered, the system prompt sent to the LLM API includes the character's personality description
- The system prompt includes the character's current mood
- The system prompt includes recent chat history (last N messages) as context
- When mood shifts (mock a mood change event), the next prompt reflects the updated mood
- Cross-over: when Agent A is triggered and Agent B recently spoke, Agent B's messages appear in the context passed to Agent A's prompt
- Mention-only mode: agent prompt builder is NOT called unless the message contains @agentName
- Per-character model override: when admin sets character X to use "gpt-4", the API call payload uses model "gpt-4" instead of the default
```

---

## PHASE 3: Fix the 5 Coverage Gaps in Source Code

These are missing features or security issues found in the prior audit. Implement them in the source code.

### Gap 1: Tipping mechanic — `wallet.js`

The wallet module has no `tip()` function. Implement it:

```
- Add: tip(fromId, toId, amount) → transfers chips from one user to another
- Validation: amount must be > 0 and a finite number
- Validation: fromId balance must be >= amount (throw or return error if insufficient)
- Validation: toId must exist (throw or return error if unknown user)
- On success: deduct from sender, add to receiver, log both transactions with type "tip", timestamp, and counterparty
- Return: { success: true, fromBalance: <new>, toBalance: <new> } or { success: false, reason: "..." }
- Write unit tests for all the above in tests/browser/wallet-tip.test.ts (this can be Node — no jsdom needed)
```

### Gap 2: Blackjack host migration — `blackjack.js`

There is no `migrateHost()`. Implement it:

```
- When the current host disconnects (detect via socket close or player-leave event), automatically promote the next player in seat order to host
- New host gets the "host" flag and can control the game (deal, manage turns)
- If no players remain, the game instance is cleaned up / destroyed
- Broadcast the host change to all remaining players
- Write unit tests: host leaves → next player is host; last player leaves → game destroyed; host migration mid-round preserves game state (deck, hands, bets)
```

### Gap 3: Mute state persistence — `setCharacterEnabled`

Currently in-memory only. Persist it:

```
- When a user mutes/unmutes an agent, write the mute state to localStorage under a key like "openwire:muted-agents" (JSON array of muted character IDs)
- On page load, read from localStorage and restore mute states
- Write tests: mute agent → reload (clear and re-init from localStorage mock) → agent is still muted; unmute → reload → agent is unmuted
```

### Gap 4: Admin nick control-char stripping

`handleAdminSuccess` does NOT strip control characters (\x00–\x1F) from the nick, unlike the regular join path. Fix it:

```
- In handleAdminSuccess, apply the same sanitization that the regular join path uses (strip or reject nicks containing \x00–\x1F, \x7F, or other non-printable chars)
- If the sanitization logic is duplicated, extract it to a shared utility: sanitizeNick(raw) → cleaned
- Write tests: admin nick with embedded \x00 → stripped; admin nick with \x1F → stripped; admin nick with normal chars → unchanged; empty nick after stripping → rejected
```

### Gap 5: XSS sanitization at socket/lib layer

Currently handled only in React's render layer (`renderContent`). Add defense-in-depth at the socket/message layer:

```
- In the message-receiving handler (where raw messages arrive from the socket/relay), sanitize the message body BEFORE storing it in state or sessionStorage
- Use a lightweight sanitizer: strip <script>, <iframe>, <object>, <embed>, on* event attributes, and javascript: URIs
- Do NOT use a heavy DOM-based sanitizer (no jsdom at this layer) — use regex or a small lib like DOMPurify-compatible string sanitizer, or write a simple stripDangerousTags(text) utility
- Preserve safe HTML if your chat supports rich text, or escape everything to plain text if it does not
- Write tests: message with <script>alert(1)</script> → script tag removed; message with <img onerror="alert(1)"> → onerror attribute removed; message with normal text → unchanged; message with <b>bold</b> → preserved if rich text supported, or escaped if plain text only
```

---

## PHASE 4: Run All Tests

```
Run the full test suite including the new browser tests and the new unit tests for the 5 gap fixes.
Capture and report:
- Total pass / fail / skip counts
- Any failing test details
```

---

## PHASE 5: Ruflo Swarm — Fix Failures & Re-verify

```
Use Ruflo swarm to fix any failures from Phase 4:

ruflo swarm --test-cmd "npm run test" --fix --rerun --max-iterations 5

Rules for the swarm:
1. Fix source code to make tests pass — do NOT weaken test assertions
2. If a test has a genuine bug (wrong selector, wrong mock setup), fix the test
3. After all iterations, run the full suite one final time
4. Produce a summary:

## Final Results
| Domain                  | Total | Passed | Failed | Skipped |
|-------------------------|-------|--------|--------|---------|
| Browser/React Tests     | 46    | ...    | ...    | ...     |
| Gap Fixes (unit tests)  | ...   | ...    | ...    | ...     |
| Previously Passing      | ...   | ...    | ...    | ...     |
| **TOTAL**               | ...   | ...    | ...    | ...     |

## Fixes Applied
1. [file:line] — one-line description
2. ...

## Remaining Issues
- (if any)
```

---

## Constraints

- **Zero live network calls.** Mock every socket, relay, WebRTC, and LLM API interaction.
- **Do not break existing passing tests.** All previously green tests must stay green.
- **Match existing code style.** Read the codebase conventions before writing anything.
- **Shared utilities over duplication.** If you create a `sanitizeNick()` or `stripDangerousTags()`, put it in a shared utils module and import everywhere.
- **Every gap fix must have corresponding tests.** No source change without a test proving it works.