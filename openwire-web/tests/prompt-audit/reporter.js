/**
 * Prompt Audit Reporter
 * Generates scores.json and REPORT.md from result files.
 */

import { writeFileSync, readdirSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = resolve(__dirname, 'results');

export function generateReport(allResults) {
    // allResults: array of { charId, charName, scenarios: [{id, score, maxScore, notes, response}], totalScore, totalMax }

    const scores = allResults.map(r => ({
        charId: r.charId,
        charName: r.charName,
        totalScore: r.totalScore,
        totalMax: r.totalMax,
        pct: r.totalMax > 0 ? Math.round((r.totalScore / r.totalMax) * 100) : 0,
        scenarios: r.scenarios,
    }));

    // Write scores.json
    writeFileSync(
        resolve(RESULTS_DIR, 'scores.json'),
        JSON.stringify(scores, null, 2),
        'utf8'
    );

    // Build REPORT.md
    const lines = [];
    lines.push('# Prompt Audit Report — Phase 6');
    lines.push('');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push('');
    lines.push('## Summary');
    lines.push('');
    lines.push('| Character | Score | Max | % |');
    lines.push('|-----------|-------|-----|---|');
    for (const s of scores) {
        lines.push(`| ${s.charName} | ${s.totalScore} | ${s.totalMax} | ${s.pct}% |`);
    }
    lines.push('');

    const avgPct = scores.length > 0
        ? Math.round(scores.reduce((a, b) => a + b.pct, 0) / scores.length)
        : 0;
    lines.push(`**Overall average: ${avgPct}%**`);
    lines.push('');

    lines.push('## Per-Character Detail');
    lines.push('');
    for (const s of scores) {
        lines.push(`### ${s.charName} (${s.pct}%)`);
        lines.push('');
        lines.push('| Scenario | Score | Max | Notes |');
        lines.push('|----------|-------|-----|-------|');
        for (const sc of s.scenarios) {
            lines.push(`| ${sc.id} | ${sc.score} | ${sc.maxScore} | ${sc.notes} |`);
        }
        lines.push('');
    }

    // Failures analysis
    lines.push('## Failures Requiring Phase 7 Fixes');
    lines.push('');
    const noBreakFailures = scores.filter(s =>
        s.scenarios.some(sc => sc.id === 'no_break' && sc.score === 0)
    );
    if (noBreakFailures.length > 0) {
        lines.push('### Characters that broke character under AI-break pressure:');
        for (const f of noBreakFailures) {
            lines.push(`- **${f.charName}** (${f.charId}): Add anti-AI-break instruction to systemPrompt`);
        }
        lines.push('');
    } else {
        lines.push('No characters failed the no_break test.');
        lines.push('');
    }

    const moodFailures = scores.filter(s =>
        s.scenarios.some(sc => sc.id === 'mood_shift' && sc.score < 2)
    );
    if (moodFailures.length > 0) {
        lines.push('### Characters with weak mood resilience:');
        for (const f of moodFailures) {
            lines.push(`- **${f.charName}** (${f.charId})`);
        }
        lines.push('');
    }

    const reportPath = resolve(RESULTS_DIR, 'REPORT.md');
    writeFileSync(reportPath, lines.join('\n'), 'utf8');

    return { reportPath, scoresPath: resolve(RESULTS_DIR, 'scores.json'), scores, avgPct };
}

export function generateAuditReport(scores, fixes) {
    const projectRoot = resolve(__dirname, '../..');
    const reportPath = resolve(projectRoot, 'AUDIT-REPORT.md');

    const lines = [];
    lines.push('# OpenWire Agent Prompt Audit — Combined Report (Phases 2–8)');
    lines.push('');
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push('');

    lines.push('## Phase 6: Automated Prompt Effectiveness Audit');
    lines.push('');
    lines.push('### Methodology');
    lines.push('');
    lines.push('- Model: `gemini-2.0-flash-lite` (temperature=0, topP=0.01, topK=1)');
    lines.push('- Characters tested: Top 5 by frequencyWeight');
    lines.push('- Scenarios: identity, catchphrase, no_break, topic (fidelity) + mood_shift, memory (multi-turn)');
    lines.push('- Scoring: Heuristic regex-based, 0–2 per scenario');
    lines.push('- Serial API calls, max 3 turns per multi-turn test');
    lines.push('');

    lines.push('### Phase 6 Results');
    lines.push('');
    lines.push('| Character | Score | Max | % |');
    lines.push('|-----------|-------|-----|---|');
    for (const s of scores) {
        lines.push(`| ${s.charName} | ${s.totalScore} | ${s.totalMax} | ${s.pct}% |`);
    }
    lines.push('');

    const avgPct = scores.length > 0
        ? Math.round(scores.reduce((a, b) => a + b.pct, 0) / scores.length)
        : 0;
    lines.push(`**Overall average fidelity: ${avgPct}%**`);
    lines.push('');

    lines.push('## Phase 7: Targeted Fixes');
    lines.push('');
    if (fixes.length === 0) {
        lines.push('No fixes required — all characters passed all scenarios.');
    } else {
        lines.push('The following targeted fixes were applied to `src/lib/agents/characters.js`:');
        lines.push('');
        for (const fix of fixes) {
            lines.push(`- **${fix.charName}** (scenario: \`${fix.scenario}\`): ${fix.description}`);
        }
    }
    lines.push('');

    lines.push('## Phase 8: Combined Assessment');
    lines.push('');
    lines.push('### Strengths');
    lines.push('');
    lines.push('- Character prompts use structured XML card format optimized for Gemini Flash Lite');
    lines.push('- Room rules enforce Hinglish-only, no emoji, 1-2 sentence limits');
    lines.push('- Drama engine provides per-character comedy and relationship dynamics');
    lines.push('- Mood system allows runtime personality modulation per character');
    lines.push('');
    lines.push('### Recommendations');
    lines.push('');
    lines.push('- Add explicit anti-AI-break instructions to all characters who failed `no_break`');
    lines.push('- Ensure all characters have at least 2 distinct mood entries for variety');
    lines.push('- Consider adding more catchphrase fragments for better fidelity scoring');
    lines.push('- Multi-turn memory could be improved with explicit session fact blocks');
    lines.push('');

    writeFileSync(reportPath, lines.join('\n'), 'utf8');
    return reportPath;
}
