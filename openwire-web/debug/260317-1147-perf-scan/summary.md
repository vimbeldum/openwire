# Performance Debug + Fix Session Summary

## Stats
- Session: debug/260317-1147-perf-scan/
- Debug iterations: 7 (2 confirmed, 5 disproven)
- Fix iterations: 2 (all kept)
- Baseline: 0 test errors (2605 passing), 1 build warning
- Final: 0 test errors (2605 passing), 0 build warnings

## Bugs Found & Fixed

| # | Severity | File:Line | Description | Status |
|---|----------|-----------|-------------|--------|
| 1 | MEDIUM | swarm.js:400 | Biased sort-shuffle for AI agent reactive selection — replaced with Fisher-Yates | Fixed |
| 2 | LOW | vite.config.js:23 | Invalid `compact: true` Rollup output option causing build warnings | Fixed |

## Performance Architecture (healthy — no bugs)

| Area | Status | Details |
|------|--------|---------|
| Memoization | Good | 48 useCallback, 6 useMemo in ChatRoom; child components memo-wrapped |
| Timer cleanup | Good | All 5 game hooks + swarm.stop() properly clear timers |
| Message persistence | Good | 5s interval (not per-message), capped at 500 |
| Context buffer | Good | 1000 message cap + AI-powered auto-compaction |
| Bundle splitting | Good | 19 lazy-loaded chunks; only ChatRoom + essentials in main bundle |
| Main bundle | 352KB (109KB gz) | Acceptable for SPA; game engines are small (5-15KB each) |
