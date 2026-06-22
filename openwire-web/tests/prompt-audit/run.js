/**
 * Prompt Audit Runner — Phases 6, 7, 8
 *
 * Usage:
 *   OPENWIRE_PROMPT_AUDIT=true node tests/prompt-audit/run.js
 */

import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { callGemini, getApiKey } from './harness.js';
import { FIDELITY_SCENARIOS, MULTITURN_SCENARIOS, scoreFidelity, scoreMultiTurn } from './scenarios.js';
import { generateReport, generateAuditReport } from './reporter.js';
import { buildSystemPrompt } from '../../src/lib/agents/prompt-builder.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = resolve(__dirname, 'results');
const MODEL = 'gemini-2.5-flash-lite';

// ── Guard ─────────────────────────────────────────────────────────────────────

if (process.env.OPENWIRE_PROMPT_AUDIT !== 'true') {
    console.error(
        'ERROR: Set OPENWIRE_PROMPT_AUDIT=true to run the prompt audit.\n' +
        'Example: OPENWIRE_PROMPT_AUDIT=true node tests/prompt-audit/run.js'
    );
    process.exit(1);
}

const apiKey = getApiKey();
if (!apiKey) {
    console.error('ERROR: No Gemini API key found. Expected GEMINI_API_KEY in .env.local');
    process.exit(1);
}

// ── Load characters ───────────────────────────────────────────────────────────

// Import CHARACTERS from the source file using dynamic import
const { CHARACTERS } = await import('../../src/lib/agents/characters.js');

// Test ALL characters (not just top 5) so every card is covered.
// Override with OPENWIRE_PROMPT_AUDIT_TOP_N=<number> to limit for a quick run.
const TOP_N = process.env.OPENWIRE_PROMPT_AUDIT_TOP_N
    ? parseInt(process.env.OPENWIRE_PROMPT_AUDIT_TOP_N, 10)
    : Infinity;
const TOP_CHARS = Object.values(CHARACTERS)
    .sort((a, b) => (b.frequencyWeight || 0) - (a.frequencyWeight || 0))
    .slice(0, TOP_N);

console.log(`\nPhase 6 — Prompt Audit`);
console.log(`Model: ${MODEL}`);
console.log(`Testing ${TOP_CHARS.length} characters: ${TOP_CHARS.map(c => c.name).join(', ')}`);
console.log(`API key present: yes (${apiKey.slice(0, 8)}...)`);
console.log('');

// ── Helper: sleep to avoid rate limits ───────────────────────────────────────

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ── Helper: save result JSON ──────────────────────────────────────────────────

function saveResult(charId, scenarioId, data) {
    const path = resolve(RESULTS_DIR, `${charId}-${scenarioId}.json`);
    writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
}

// ── Phase 6: Run audit for each character ─────────────────────────────────────

const allResults = [];

for (const char of TOP_CHARS) {
    console.log(`\n--- Character: ${char.name} (${char.id}) ---`);
    const charResults = { charId: char.id, charName: char.name, scenarios: [], totalScore: 0, totalMax: 0 };

    // Build the REAL production system prompt (room rules + drama engine +
    // action engine + character card + character_lock) so the audit measures
    // what users actually see, not the bare character card.
    const systemPrompt = buildSystemPrompt(char, { guardrails: true });

    // ── Fidelity scenarios ──
    for (const scenario of FIDELITY_SCENARIOS) {
        const prompt = scenario.prompt.replace('{charName}', char.name);
        console.log(`  [fidelity/${scenario.id}] "${prompt.slice(0, 60)}..."`);

        let response = '';
        let error = null;
        let raw = null;

        try {
            const result = await callGemini(MODEL, systemPrompt, prompt);
            response = result.text;
            raw = result.raw;
        } catch (e) {
            error = e.message;
            console.error(`    ERROR: ${e.message}`);
        }

        const scored = error
            ? { score: 0, maxScore: scenario.maxScore, notes: `API error: ${error}` }
            : scoreFidelity(scenario, response, char);

        console.log(`    Response: "${response.slice(0, 80)}"`);
        console.log(`    Score: ${scored.score}/${scored.maxScore} — ${scored.notes}`);

        const resultData = {
            charId: char.id,
            charName: char.name,
            scenarioId: scenario.id,
            scenarioType: 'fidelity',
            prompt,
            response,
            score: scored.score,
            maxScore: scored.maxScore,
            notes: scored.notes,
            error,
            raw,
            timestamp: new Date().toISOString(),
        };
        saveResult(char.id, scenario.id, resultData);

        charResults.scenarios.push({
            id: scenario.id,
            score: scored.score,
            maxScore: scored.maxScore,
            notes: scored.notes,
            response,
        });
        charResults.totalScore += scored.score;
        charResults.totalMax += scored.maxScore;

        // Pause between API calls to respect rate limits
        await sleep(1200);
    }

    // ── Multi-turn scenarios ──
    for (const scenario of MULTITURN_SCENARIOS) {
        console.log(`  [multiturn/${scenario.id}]`);

        const chatHistory = [];
        let scenarioScore = 0;
        let scenarioMax = 0;
        const turnResults = [];

        for (let i = 0; i < scenario.turns.length; i++) {
            const turn = scenario.turns[i];
            const prompt = turn.user;
            console.log(`    Turn ${i + 1}: "${prompt}"`);

            let response = '';
            let error = null;

            try {
                const result = await callGemini(MODEL, systemPrompt, prompt, chatHistory);
                response = result.text;
            } catch (e) {
                error = e.message;
                console.error(`    ERROR: ${e.message}`);
            }

            const scored = error
                ? { score: 0, maxScore: turn.maxScore, notes: `API error: ${error}` }
                : scoreMultiTurn(scenario.id, i, response, char);

            console.log(`    Response: "${response.slice(0, 80)}"`);
            console.log(`    Score: ${scored.score}/${scored.maxScore} — ${scored.notes}`);

            turnResults.push({ turn: i + 1, prompt, response, score: scored.score, maxScore: scored.maxScore, notes: scored.notes });
            scenarioScore += scored.score;
            scenarioMax += scored.maxScore;

            // Add this turn to history for next turn
            chatHistory.push({ role: 'user', text: prompt });
            chatHistory.push({ role: 'model', text: response });

            await sleep(1200);
        }

        const resultData = {
            charId: char.id,
            charName: char.name,
            scenarioId: scenario.id,
            scenarioType: 'multiturn',
            turns: turnResults,
            score: scenarioScore,
            maxScore: scenarioMax,
            timestamp: new Date().toISOString(),
        };
        saveResult(char.id, scenario.id, resultData);

        charResults.scenarios.push({
            id: scenario.id,
            score: scenarioScore,
            maxScore: scenarioMax,
            notes: `${scenario.turns.length} turns`,
            response: turnResults.map(t => t.response).join(' | '),
        });
        charResults.totalScore += scenarioScore;
        charResults.totalMax += scenarioMax;
    }

    allResults.push(charResults);
    console.log(`  Total: ${charResults.totalScore}/${charResults.totalMax} (${Math.round(charResults.totalScore / charResults.totalMax * 100)}%)`);
}

// ── Generate Phase 6 report ───────────────────────────────────────────────────

console.log('\n--- Generating Phase 6 Report ---');
const { reportPath, scoresPath, scores, avgPct } = generateReport(allResults);
console.log(`Report: ${reportPath}`);
console.log(`Scores: ${scoresPath}`);
console.log(`Average fidelity: ${avgPct}%`);

// ── Phase 7: Targeted fixes ──────────────────────────────────────────────────
// Note: <character_lock> is now applied universally by buildSystemPrompt()
// (see src/lib/agents/prompt-builder.js), so per-card patching of
// characters.js is no longer necessary. Phase 7 now only re-tests any
// character that scored 0 on no_break, using the real assembled prompt.

console.log('\n--- Phase 7: Applying fixes ---');

const fixes = [];

// Find characters with no_break score = 0 (genuine AI-break, not a refusal
// that merely quotes the word "AI" — the scorer now distinguishes these).
const noBreakFailures = allResults.filter(r =>
    r.scenarios.some(s => s.id === 'no_break' && s.score === 0)
);

if (noBreakFailures.length > 0) {
    console.log(`  ${noBreakFailures.length} character(s) scored 0 on no_break.`);
    console.log('  character_lock is now centralized in prompt-builder.js — no per-card edit needed.');
    for (const failed of noBreakFailures) {
        fixes.push({
            charName: failed.charName,
            charId: failed.charId,
            scenario: 'no_break',
            description: 'Flagged for review — character_lock is universal via prompt-builder.js; re-test below',
        });
    }
} else {
    console.log('  No no_break failures — no fixes needed');
}

// ── Phase 7: Re-run only failing scenarios ────────────────────────────────────

if (fixes.length > 0) {
    console.log('\n--- Phase 7: Re-running no_break scenarios after fix ---');

    for (const fix of fixes.filter(f => f.scenario === 'no_break')) {
        const char = CHARACTERS[fix.charId];
        if (!char) continue;

        const scenario = FIDELITY_SCENARIOS.find(s => s.id === 'no_break');
        const prompt = scenario.prompt.replace('{charName}', char.name);
        console.log(`  Re-testing ${char.name} no_break...`);

        await sleep(1200);
        try {
            // Re-test with the REAL assembled prompt (includes universal character_lock).
            const retestSystemPrompt = buildSystemPrompt(char, { guardrails: true });
            const result = await callGemini(MODEL, retestSystemPrompt, prompt);
            const scored = scoreFidelity(scenario, result.text, char);
            console.log(`    Response: "${result.text.slice(0, 80)}"`);
            console.log(`    Score after fix: ${scored.score}/${scored.maxScore} — ${scored.notes}`);

            saveResult(char.id, 'no_break_retest', {
                charId: char.id,
                charName: char.name,
                scenarioId: 'no_break_retest',
                prompt,
                response: result.text,
                score: scored.score,
                maxScore: scored.maxScore,
                notes: scored.notes,
                timestamp: new Date().toISOString(),
            });
        } catch (e) {
            console.error(`    ERROR: ${e.message}`);
        }
    }
}

// ── Phase 8: Generate combined AUDIT-REPORT.md ───────────────────────────────

console.log('\n--- Phase 8: Generating AUDIT-REPORT.md ---');
const auditPath = generateAuditReport(scores, fixes, MODEL);
console.log(`Audit report: ${auditPath}`);

// ── Final summary ─────────────────────────────────────────────────────────────

console.log('\n=== AUDIT COMPLETE ===');
console.log(`Characters tested: ${TOP_CHARS.map(c => c.name).join(', ')}`);
console.log(`Average fidelity: ${avgPct}%`);
console.log(`Phase 7 fixes applied: ${fixes.length}`);
for (const f of fixes) {
    console.log(`  - ${f.charName}: ${f.description}`);
}
console.log(`\nAudit report: ${auditPath}`);
console.log(`Results dir: ${RESULTS_DIR}`);
