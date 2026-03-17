# Bug Hunt Findings — 2026-03-17

## Summary

| Severity | Count | Fixed |
|----------|-------|-------|
| CRITICAL | 1     | Yes   |
| HIGH     | 4     | Yes   |
| MEDIUM   | 1     | Yes   |
| LOW      | 1     | Yes   |
| **Total**| **7** | **7** |

All 2605 tests pass after fixes. 10 hypotheses tested, 7 confirmed, 2 disproven, 1 noted.

---

## [CRITICAL] Polymarket pricing formula is inverted

**File:** `polymarket.js:28-31` (binary) + `polymarket.js:37-40` (multi-outcome)

**Bug:** `prices[0] = quantities[1] / total` uses the OTHER outcome's quantity. Buying outcome 0 increases `q[0]`, but since the price formula references `q[1]`, the price of outcome 0 DROPS. In a prediction market, buying should increase the price.

**Impact:** Market signals completely backwards. Multi-outcome cost calculations also broken.

**Fix:** Changed binary formula to `prices[i] = quantities[i] / total` and multi-outcome to `prices[i] = (qi / totalPool) * 100`. Updated 4 tests.

---

## [HIGH] Vault stake destroys accrued compound interest

**File:** `vault.js:107`

**Bug:** `stakedAt: Date.now()` unconditionally resets the interest timer on additional deposits. Earned interest is silently destroyed.

**Fix:** Compound accrued interest into the principal before resetting: `staked = currentStaked + accruedInterest + amount`.

---

## [HIGH] Wallet tip() does not persist sender wallet

**File:** `wallet.js:232`

**Bug:** `credit()` and `debit()` both call `saveWalletSync()`. `tip()` does not. Race condition: page reload can revert sender balance while P2P tip message was already sent, duplicating chips.

**Fix:** Added `saveWalletSync(updatedFrom)` before the return.

---

## [HIGH] Bounty voting never expires without a vote trigger

**File:** `bounties.js:190`

**Bug:** `expireBounty()` only handles `status === 'open'`. Bounties stuck in 'voting' status past `votingEndsAt` lock escrowed funds permanently.

**Fix:** Added voting expiry: `if (status === 'voting' && nowMs >= votingEndsAt) → resolveBounty()`.

---

## [HIGH] Cosmetics buyResale() never credits the seller

**File:** `cosmetics.js:192-224`

**Bug:** Buyer pays full `resalePrice`, 10% goes to jackpot, but seller receives 0 chips. 90% of the sale proceeds are destroyed.

**Fix:** Added `sellerProceeds` (resalePrice minus house cut) and `sellerDeviceHash` to the return value so the caller can credit the seller's wallet.

---

## [MEDIUM] Jackpot random trigger uses predictable Math.random()

**File:** `jackpot.js:81`

**Bug:** Every other RNG in the codebase uses `crypto.getRandomValues()`. Jackpot random trigger uses `Math.random()`, which is predictable.

**Fix:** Added `_cryptoRandom()` helper using `crypto.getRandomValues()`. Updated test.

---

## [LOW] Blackjack parseInt missing radix

**File:** `blackjack.js:56`

**Bug:** `parseInt(card.value)` without radix parameter.

**Fix:** Added `, 10` radix.
