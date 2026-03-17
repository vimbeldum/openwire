# Debug Findings — Performance Scan

## [MEDIUM] Bug: Biased Shuffle in Agent Reactive Selection

- **Location:** `src/lib/agents/swarm.js:400`
- **Hypothesis:** `sort(() => Math.random() - 0.5)` doesn't produce uniform permutations
- **Evidence:**
  - Well-documented bias: V8's Timsort with random comparator favors elements near their original positions
  - Some agents systematically get more speaking opportunities than others
  - O(n log n) complexity vs O(n) for Fisher-Yates
  - Fisher-Yates is already used correctly in `blackjack.js:shuffleDeck()`
- **Reproduction:** Run 10,000 shuffles of [A,B,C,D], count first-position frequencies — they won't be uniform
- **Impact:** AI agents get unfairly distributed speaking turns; some are over-represented
- **Root cause:** Using sort-based shuffle instead of Fisher-Yates
- **Suggested fix:** Replace with Fisher-Yates shuffle (in-place, O(n), unbiased)

## [LOW] Bug: Invalid `compact` Rollup Option in Vite Config

- **Location:** `vite.config.js:23`
- **Hypothesis:** `compact: true` is an invalid Rollup output option
- **Evidence:**
  - Build output: `Warning: Invalid output options (1 issue found) - For the "compact". Invalid key`
  - Rollup removed `compact` option in recent versions
  - The option is completely ignored — no minification benefit
- **Reproduction:** Run `npm run build`, observe warning
- **Impact:** Noisy build output, developer confusion, no actual minification
- **Root cause:** Outdated config from older Rollup version
- **Suggested fix:** Remove the `compact: true` line from rollupOptions.output

## Disproven Hypotheses

| Hypothesis | Why Disproven |
|------------|---------------|
| Timer leaks in game hooks | All 5 game hooks (BJ, RL, AB, PM, Mystery) have proper clearTimeout/clearInterval cleanup |
| Missing useMemo/useCallback | ChatRoom has 48 useCallback, 6 useMemo; child components are memo-wrapped |
| Session message persistence blocking | saveMessages runs on 5s interval (not on every message), capped at 500 |
| Context buffer memory leak | Capped at 1000 messages, auto-compaction summarizes via AI, facts capped at 50 |
| Swarm timer leak on stop | stop() clears all 5 timer categories: character, stagger, crossover, mood, throttle |
