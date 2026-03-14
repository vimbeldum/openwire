# OpenWire Agent Prompt Audit — Combined Report (Phases 2–8)

Generated: 2026-03-14T12:58:13.532Z

## Phase 6: Automated Prompt Effectiveness Audit

### Methodology

- Model: `gemini-2.0-flash-lite` (temperature=0, topP=0.01, topK=1)
- Characters tested: Top 5 by frequencyWeight
- Scenarios: identity, catchphrase, no_break, topic (fidelity) + mood_shift, memory (multi-turn)
- Scoring: Heuristic regex-based, 0–2 per scenario
- Serial API calls, max 3 turns per multi-turn test

### Phase 6 Results

| Character | Score | Max | % |
|-----------|-------|-----|---|
| Jethalal | 16 | 16 | 100% |
| Baburao | 14 | 16 | 88% |
| Raju | 15 | 16 | 94% |
| Amar | 14 | 16 | 88% |
| Prem | 14 | 16 | 88% |

**Overall average fidelity: 92%**

## Phase 7: Targeted Fixes

No fixes required — all characters passed all scenarios.

## Phase 8: Combined Assessment

### Strengths

- Character prompts use structured XML card format optimized for Gemini Flash Lite
- Room rules enforce Hinglish-only, no emoji, 1-2 sentence limits
- Drama engine provides per-character comedy and relationship dynamics
- Mood system allows runtime personality modulation per character

### Recommendations

- Add explicit anti-AI-break instructions to all characters who failed `no_break`
- Ensure all characters have at least 2 distinct mood entries for variety
- Consider adding more catchphrase fragments for better fidelity scoring
- Multi-turn memory could be improved with explicit session fact blocks
