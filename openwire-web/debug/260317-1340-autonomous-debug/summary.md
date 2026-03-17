# Debug Summary

**Scope:** All 21 lib modules | **Depth:** 17 iterations | **Tests:** 2612/2612 pass

## Results

| Metric | Value |
|--------|-------|
| Bugs found | 9 (3 HIGH, 5 MEDIUM, 1 LOW) |
| Bugs fixed | 8 |
| Bugs logged (design) | 1 |
| Hypotheses disproven | 7 |
| Files investigated | 21 / 21 |
| Tests after fixes | 2612 pass, 0 fail |

## Fixes Applied

| File | Bug | Severity |
|------|-----|----------|
| `blackjack.js:470` | Immutability violation in dealerPlay | HIGH |
| `reputation.js:100` | BANNED event doesn't reset karma | HIGH |
| `reputation.js:54,63` | NaN propagation from missing data | HIGH |
| `casinoState.js:111` | LWW merge drops local game types | HIGH |
| `polymarket.js:162,227` | Rounding leak in multi-outcome AMM | MEDIUM |
| `reputation.js:132` | Cooldown ignores injected timestamp | MEDIUM |
| `vault.js:26` | Negative interest for future timestamps | MEDIUM |
| `bounties.js:130` | Submissions after voting period ends | MEDIUM |

## Debug Score

```
debug_score = 9 * 15 + 17 * 3 + (21/21) * 40 + (5/7) * 10
            = 135 + 51 + 40 + 7.1
            = 233.1
```
