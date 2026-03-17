# Debug Findings — Autonomous Bug Hunt

**Date:** 2026-03-17
**Scope:** All 21 lib modules in `openwire-web/src/lib/`
**Iterations:** 17
**Bugs found:** 9 confirmed (3 HIGH, 5 MEDIUM, 1 LOW)
**Hypotheses disproven:** 7
**Files investigated:** 21 / 21

---

## Confirmed Bugs (Fixed)

### [HIGH] Bug 1: `blackjack.js:470` — `dealerPlay` mutates input game state
- **Location:** `blackjack.js:470-475`
- **Hypothesis:** Shallow copy of dealer object shares hand array reference
- **Evidence:** `{ ...game.dealer }` doesn't clone `.hand`; `.push()` mutates original
- **Reproduction:** Call `dealerPlay(game)` where dealer hand < 17; original `game.dealer.hand` is now mutated
- **Impact:** React re-renders may not detect dealer hand changes; stale state in P2P sync
- **Root cause:** Missing array clone on `hand` property during shallow copy
- **Fix:** Changed to `{ ...game.dealer, hand: [...game.dealer.hand], revealed: true }`

### [HIGH] Bug 2: `reputation.js:100-115` — BANNED event doesn't reset karma
- **Location:** `reputation.js:100,113-115`
- **Hypothesis:** Tier is forced to 'newcomer' but karma value remains high
- **Evidence:** User with 500 karma gets BANNED → karma = 450, tier = 'newcomer'. Next positive event → `getTier(453)` = 'trusted'
- **Reproduction:** `applyKarma({karma: 500, tier: 'legend'}, 'banned')` → karma 450, tier newcomer. Then any +1 event restores tier to trusted.
- **Impact:** Ban penalty is meaningless for high-karma users — bypassed by a single positive event
- **Root cause:** Only tier was reset, karma was not zeroed
- **Fix:** Added `if (eventType === KARMA_EVENTS.BANNED) { newKarma = 0; }` and corrected delta in history entry

### [HIGH] Bug 3: `reputation.js:54,63` — NaN propagation when event data fields missing
- **Location:** `reputation.js:54,63`
- **Hypothesis:** Missing `data.amount` or `data.upvotes` produces NaN delta
- **Evidence:** `undefined / 100 = NaN` → `Math.floor(NaN) = NaN` → `Math.max(0, karma + NaN) = NaN`
- **Reproduction:** `calculateKarmaChange('tip_received', {})` → `{ delta: NaN }`
- **Impact:** One missing field corrupts the entire reputation object permanently
- **Root cause:** No fallback for missing data fields
- **Fix:** Added `?? 0` fallbacks: `(data.amount ?? 0)` and `(data.upvotes ?? 0)`

### [HIGH] Bug 4: `casinoState.js:111-113` — LWW merge drops local-only game types
- **Location:** `casinoState.js:111-113`
- **Hypothesis:** Wholesale replacement of housePnl loses game types only present in local
- **Evidence:** If remote has newer `_ts` but lacks `tambola` field, `{ ...remote.housePnl }` drops local's tambola P&L
- **Reproduction:** Local has `{roulette: 100, tambola: 50}`, remote has `{roulette: 200}` with newer `_ts`. After merge, tambola data is lost.
- **Impact:** P2P sync with an older peer silently loses P&L tracking for newer game types
- **Root cause:** Should merge per-game-type fields, not replace entire object
- **Fix:** Changed to `{ ...local.housePnl, ...remote.housePnl }` — spread local first to preserve its keys

### [MEDIUM] Bug 5: `polymarket.js:162-168` — Rounding leak in multi-outcome cost distribution
- **Location:** `polymarket.js:162-168` (buy) and `227-235` (sell)
- **Hypothesis:** `Math.round()` on each iteration causes total deductions ≠ cost
- **Evidence:** `remaining` can be > 0 after loop completes
- **Impact:** Over many trades, the AMM pool leaks value (chip inflation)
- **Fix:** Added rounding remainder sweep after both buy and sell distribution loops

### [MEDIUM] Bug 6: `reputation.js:132-134` — `checkCooldown` ignores injected timestamp
- **Location:** `reputation.js:132-134`
- **Hypothesis:** `applyKarma` accepts timestamp but cooldown check uses `Date.now()`
- **Evidence:** `checkCooldown(rep, event, data)` — no timestamp parameter
- **Impact:** Cooldowns fail during event replays or time-injected tests
- **Fix:** Added `nowMs` parameter to `checkCooldown` and pass `timestamp` from `applyKarma`

### [MEDIUM] Bug 7: `vault.js:26-28` — `calculateInterest` returns negative for future timestamps
- **Location:** `vault.js:25-29`
- **Hypothesis:** Negative elapsed time produces negative compound interest
- **Evidence:** `Math.pow(1.02, -0.5) = 0.99` → interest = -1
- **Impact:** Clock manipulation or corrupt data causes interest to go negative
- **Fix:** Added `Math.max(0, ...)` guard on `hoursElapsed`

### [MEDIUM] Bug 8: `bounties.js:130-134` — Submissions accepted after voting period ends
- **Location:** `bounties.js:130-134`
- **Hypothesis:** Only checks `expiresAt`, not `votingEndsAt`
- **Evidence:** Bounty in 'voting' status past `votingEndsAt` still accepts submissions
- **Impact:** Late submissions influence resolution after voting should have closed
- **Fix:** Added `votingEndsAt` check for voting-phase bounties

## Confirmed Bugs (Not Fixed — Design Issues)

### [MEDIUM] Bug 9: `deaddrops.js:106` — Author hash leaks identity in P2P posts
- **Location:** `deaddrops.js:94-107`
- **Hypothesis:** `_authorHash` is a deterministic device fingerprint in broadcast posts
- **Evidence:** Hash is embedded in every post object, which is serialized over P2P
- **Impact:** Peers can correlate anonymous posts to the same author
- **Root cause:** Rate-limiting field shouldn't be in the serialized post
- **Status:** Logged; requires larger refactor to separate rate-limit tracking from post model

### [LOW] Bug 10: `polymarket.js:31-34` — Binary prices don't sum to 100
- **Location:** `polymarket.js:31-34`
- **Evidence:** Independent `Math.round()` on each price: `round(33.33) + round(33.33) + round(33.33) = 99`
- **Impact:** UI display shows prices summing to 99 or 101
- **Status:** Logged; cosmetic issue only — actual trade costs use CPMM formula

---

## Disproven Hypotheses

| # | Hypothesis | Why Disproven |
|---|-----------|---------------|
| 11 | IST streak date diff miscalculates across DST | India has no DST; IST offset is constant |
| 12 | XSS bypass in stripDangerousTags | No `dangerouslySetInnerHTML`; React auto-escapes |
| 13 | Tambola redistributeUnclaimed loses money | Called after fullHouse claim; flow is correct |
| 14 | Andar Bahar accepts invalid bet sides | Invalid sides fall through to guaranteed loss |
| 15 | Polymarket `== null` is loose equality bug | Standard JS idiom for null/undefined check |
| 16 | wallet.debit allows negative amounts | All callers validate amount > 0 |
| 17 | ledger.js push mutates input | Intentional cache mutation, not an input |
