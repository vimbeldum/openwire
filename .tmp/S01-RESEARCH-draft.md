# S01 — Research

**Date:** 2026-04-16

## Summary

S01 already has most of the raw shell structure inside `openwire-web`: the authenticated app mounts a dark-mode chat shell, `ChatRoom.jsx` renders a Bento-style grid (`.chat-layout`), and the UI already exposes the three core context surfaces this slice owns — conversation (`.messages-area`), room context (`current-room-indicator`, rooms list), and peer context (`Online`, peer list, wallet/badges). The slice is not starting from zero layout work; it is primarily a shell-hardening and refinement pass around an oversized component.

The main issue is not missing primitives but drift and consolidation debt. `ChatRoom.jsx` is a very large orchestration component that already renders the shell header, ticker, typing bar, message stream, composer, and sidebar, while tests in `openwire-web/tests/e2e` still expect older selectors like `.global-header` and “CLI Node” badge text. Planning should treat S01 as: stabilize the premium shell contract first, then tighten responsive/accessibility behavior, then update verification to the new contract instead of layering more UI on top of stale assumptions.

## Recommendation

Keep the existing `ChatRoom.jsx` shell and refine it in place rather than introducing a new shell container. The current implementation already expresses the right product structure for R001/R003/R004: dark theme, compartmentalized header/context/sidebar, explicit room and peer context, and mobile sidebar behavior. Rebuilding the shell would create unnecessary risk in a component that also orchestrates sockets, rooms, games, typing, mentions, wallet state, and admin affordances.

For execution, split work into three seams: (1) shell contract cleanup in `ChatRoom.jsx` + `chat.css`, (2) landing/authenticated visual continuity in `Landing.jsx` + `landing.css` + `App.jsx`, and (3) verification refresh in Vitest/Playwright. If the slice needs visible “premium” polish, prefer targeted extraction of header/sidebar/message-shell subcomponents only after the contract is stabilized; doing extraction first inside a 3k+ line stateful component will raise regression risk.

## Implementation Landscape

### Key Files

- `openwire-web/src/App.jsx` — top-level authenticated switch: mounts `Landing` until `openwire_session` exists, then renders `ChatRoom` inside `.app-container`; also computes `isCliMode`/`cliHost` used by the shell header badge.
- `openwire-web/src/components/Landing.jsx` — pre-auth entry form for nickname + connection mode; already supports relay vs local CLI node and admin gate. This is the pre-shell handoff point and should visually align with the premium shell without changing session semantics.
- `openwire-web/src/components/ChatRoom.jsx` — primary authenticated shell and the central file for S01. Relevant shell regions are:
  - header: `.chat-header`, `.header-context`, `.header-status`, `.connection-mode-badge`
  - context indicators: `.current-room-indicator`, `.general-chat-indicator`
  - main conversation: `.messages-area`, empty state, `MessageRow`
  - secondary context: `.sidebar`, Channels / Wallet / Online / Rooms / game-launch groups
  - responsive nav: `.hamburger-btn`, `.sidebar.mobile-open`, `.sidebar-close-btn`
- `openwire-web/src/components/chat/MessageRow.jsx` — leaf renderer for each chat row. If premium-shell work includes message density/readability improvements, this is the correct leaf seam instead of editing message markup inline in `ChatRoom.jsx`.
- `openwire-web/src/components/chat/LiveTicker.jsx` — separate shell strip for casino/game activity; currently rendered above the message area as row 2 of the grid.
- `openwire-web/src/components/chat/TypingBar.jsx` — shell strip for semantic session activity; currently rendered between message area and whisper/composer.
- `openwire-web/src/styles/base.css` — global design tokens and shared mobile rules. Defines the dark palette, glass variables, reduced-motion behavior, touch target rules, and duplicate global mobile adjustments that the shell already depends on.
- `openwire-web/src/styles/chat.css` — primary shell layout stylesheet. Defines the Bento grid, header, messages, sidebar, empty state, mobile sidebar overlay, sticky composer, ticker, typing bar, whisper bar, and many shell-adjacent controls.
- `openwire-web/src/styles/landing.css` — landing-shell visual system and `.connection-mode-badge` styles used by the authenticated header. Important for maintaining consistent branding between pre-auth and post-auth surfaces.
- `openwire-web/src/tests/browser/responsive.test.jsx` — lightweight jsdom coverage for responsive contracts; useful for render/no-overflow assumptions but not a substitute for browser layout checks.
- `openwire-web/src/tests/browser/landing.test.jsx` — RTL coverage for Landing interactions (relay/CLI/admin); stable place to keep auth-entry behavior green while S01 changes visual shell details.
- `openwire-web/tests/e2e/landing.spec.js` — real-browser landing/authenticated transition coverage. Currently expects stale `.global-header` selectors after login.
- `openwire-web/tests/e2e/chatroom.spec.js` — end-to-end shell verification for authenticated chatroom. Also expects `.global-header` even though render now uses `.chat-header`.
- `openwire-web/tests/e2e/sidebar-nav.spec.js` — end-to-end navigation/landing/sidebar coverage. Also contains stale `.global-header` expectations, but otherwise maps the shell contract well: channels, wallet, online peers, responsive sidebar visibility, and CLI badge.

### Build Order

1. **Prove the shell contract currently rendered by `ChatRoom.jsx`.**
   Confirm which selectors/labels are real now (`.chat-header`, Relay badge text, hamburger/sidebar behavior, empty state) and treat that as the authoritative shell baseline.
2. **Stabilize the premium Bento shell markup/CSS without changing chat/game behavior.**
   Focus on header hierarchy, sidebar grouping, room/peer readability, desktop/mobile behavior, and semantic empty/loading states. Avoid touching socket/game logic unless shell changes force it.
3. **Add or refine shell-level accessibility/readability details.**
   This slice supports R007 even though S04 owns it: check keyboard-reachable sidebar toggle/close/logout, reduced-motion inheritance, readable status copy, and contrast-safe indicators.
4. **Refresh verification to match the real shell contract.**
   Update Playwright specs away from stale `.global-header` assumptions and make shell tests assert the authenticated layout that actually exists now.
5. **Only then consider extraction of shell subcomponents.**
   If the shell changes are awkward inside `ChatRoom.jsx`, extract presentational pieces (`ChatHeader`, `ChatSidebar`, maybe `ChatComposer`) after tests protect behavior.

### Verification Approach

- Unit/browser tests:
  - `cd openwire-web && npm test`
- End-to-end shell checks:
  - `cd openwire-web && npm run test:e2e -- tests/e2e/landing.spec.js tests/e2e/chatroom.spec.js tests/e2e/sidebar-nav.spec.js`
- Full regression pass if shell selectors move broadly:
  - `cd openwire-web && npm run test:all`
- Observable behaviors to confirm in browser:
  - landing submits into authenticated shell without layout jump
  - header shows nick, connection badge, status, chips, logout
  - general chat vs current room context is immediately legible
  - sidebar clearly separates Channels / Wallet / Online / Rooms
  - mobile viewport hides sidebar behind hamburger and reopens as overlay
  - empty-state text remains visible/understandable when no messages exist

## Constraints

- `openwire-web/src/components/ChatRoom.jsx` is a large stateful orchestration file (~3k lines) that owns both shell UI and substantial realtime/game logic. Broad refactors here have high regression risk.
- Shell CSS is split across `base.css`, `chat.css`, and `landing.css`, with some overlapping mobile rules. Any responsive change should check for duplicate breakpoint behavior before adding more rules.
- Existing Playwright coverage is partially stale: multiple specs still target `.global-header`, while the actual component renders `.chat-header`. Verification work is part of the slice, not a postscript.
- jsdom tests in `src/tests/browser/responsive.test.jsx` explicitly do not validate computed CSS/media-query layout, so true shell verification must stay in Playwright or browser tools.

## Common Pitfalls

- **Refactoring `ChatRoom.jsx` before pinning selectors** — update or add shell assertions first, otherwise small markup moves will break broad E2E coverage without making it clear whether behavior or selectors regressed.
- **Adding more responsive CSS without checking duplicates** — both `base.css` and `chat.css` define mobile chat/sidebar behavior. Consolidate or adjust carefully to avoid conflicting `display`, `grid`, and sticky input rules.
- **Conflating shell work with game overlay work** — S01 is about the core chat shell/context. Game boards and overlays already consume shell space but should stay out of scope unless they directly break shell responsiveness.

## Open Risks

- Premium-shell expectations may require extraction of header/sidebar/composer subcomponents for maintainability, but that should be deferred until selector/test stabilization shows where the natural seams really are.
- There may be more stale test assumptions beyond `.global-header` once Playwright runs, especially around exact badge copy (`Relay` vs `OpenWire Relay`, `CLI (...)` vs `CLI Node`).

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| React | `vercel-labs/agent-skills@vercel-react-best-practices` | available |
| Vite | `antfu/skills@vite` | available |
| Playwright | `currents-dev/playwright-best-practices-skill@playwright-best-practices` | available |
