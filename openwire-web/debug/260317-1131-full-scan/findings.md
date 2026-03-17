# Debug Findings — Full Codebase Scan

## [HIGH] Bug: Dual Device Identity — wallet.js vs profile.js

- **Location:** `src/lib/wallet.js:10` and `src/lib/profile.js:8`
- **Hypothesis:** wallet.js and profile.js use different localStorage keys for device ID
- **Evidence:**
  - `wallet.js:10` → `const DEVICE_KEY = 'openwire_device_id';`
  - `profile.js:8` → `const DEVICE_KEY = 'openwire:device-id';`
  - Each module generates and stores a separate UUID
  - ChatRoom.jsx uses `wallet.getDeviceId()` for ledger, cosmetics, etc.
  - profile.js uses its own `getDeviceId()` internally
- **Reproduction:** Open browser, both systems independently create different UUIDs on first access
- **Impact:** Profile data (vault, reputation, streak) keyed by one device ID; wallet/ledger data keyed by another. Any cross-system correlation by device ID will fail. Anti-gaming checks in bounties may be inconsistent.
- **Root cause:** Two independent `getDeviceId()` implementations with different storage keys
- **Suggested fix:** Make profile.js import and reuse wallet.js's `getDeviceId()`, or unify the DEVICE_KEY constant

## [MEDIUM] Bug: Duplicate Word in Passphrase Wordlist

- **Location:** `src/lib/profile.js:64` (WORDLIST array)
- **Hypothesis:** WORDLIST has duplicates, reducing passphrase entropy
- **Evidence:**
  - 'realm' appears at indices 391 and 398
  - Array has 624 elements, but comment says "256-word wordlist"
  - `exportPassphrase()` does `h0 % size` where size = 624
  - Duplicate gives 'realm' 2x probability of other words
- **Reproduction:** `node -e "..."` counting words and checking duplicates
- **Impact:** Minor passphrase entropy reduction. Comment misleading.
- **Root cause:** Copy-paste error when assembling the wordlist
- **Suggested fix:** Remove the duplicate 'realm' at index 398

## [MEDIUM] Bug: Blackjack settle() Overwrites Sitting-Out Player Status

- **Location:** `src/lib/blackjack.js:506`
- **Hypothesis:** settle() processes all players including those sitting out
- **Evidence:**
  - `settle()` maps over ALL players calling `settleHand()`
  - Players with status 'sitting_out' have `hand: []`, `bet: 0`
  - `settleHand([], 'sitting_out', ...)` returns 'lose' (hand total 0 < dealer total)
  - Status overwritten from 'sitting_out' to 'lose'
  - `getPayouts()` correctly skips them (checks `p.bet`), so no chip impact
- **Reproduction:** Join blackjack game, don't place bet, wait for settlement
- **Impact:** Cosmetic — UI may show 'lose' for players who never bet. No financial impact.
- **Root cause:** `settle()` doesn't filter by participation status before settlement
- **Suggested fix:** Skip players with status 'sitting_out' in `settle()`

## [LOW] Bug: Bounty Escrow Missing Wallet History Entry

- **Location:** `src/lib/bounties.js:77-97` (`escrowBounty`)
- **Hypothesis:** escrowBounty deducts chips but doesn't record in wallet history
- **Evidence:**
  - `escrowBounty()` modifies `baseBalance` and `adminBonus` but returns wallet without history update
  - Compare with `vault.js:stake()` which adds `{ reason: 'Vault stake', amount: -amount, ... }` to history
  - The wallet's transaction trail has a gap for bounty escrow deductions
- **Reproduction:** Create a bounty, check wallet history — escrow deduction is invisible
- **Impact:** Wallet history is incomplete; users can't see where their chips went
- **Root cause:** History entry omitted when constructing updated wallet in escrowBounty
- **Suggested fix:** Add history entry to the returned wallet object
