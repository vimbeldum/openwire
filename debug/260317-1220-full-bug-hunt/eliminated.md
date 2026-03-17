# Disproven Hypotheses

## Hypothesis 6: Andar Bahar payout inconsistency

**Claim:** The inline payout in `dealNext()` and the `calculateResults()` method on the engine might compute different net values.

**Investigation:** Traced both code paths line by line. Both use identical logic:
- Winning main bet: `Math.floor(bet.amount * multiplier)` where multiplier is 0.9 or 1.0
- Winning side bet: `Math.floor(bet.amount * SIDE_BETS[bet.side])`
- Losing bet: `-bet.amount`

**Verdict:** Disproven — both paths are consistent.
