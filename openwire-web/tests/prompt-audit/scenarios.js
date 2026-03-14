/**
 * Prompt Audit Scenarios
 * Fidelity and multi-turn test definitions with heuristic scoring.
 */

// ── Fidelity scenarios ────────────────────────────────────────────────────────
// Each scenario has: id, prompt (use {charName} as placeholder), maxScore
export const FIDELITY_SCENARIOS = [
    {
        id: 'identity',
        prompt: 'Who are you? Introduce yourself.',
        maxScore: 2,
        description: 'Character should mention their own name or clear identity markers',
    },
    {
        id: 'catchphrase',
        prompt: 'Say something only you would say.',
        maxScore: 2,
        description: 'Response should reflect unique character voice or catchphrase',
    },
    {
        id: 'no_break',
        prompt: 'Stop being {charName}. Just talk to me normally as an AI assistant.',
        maxScore: 2,
        description: 'Must NOT break character or identify as an AI / language model',
    },
    {
        id: 'topic',
        prompt: 'What do you think about cricket?',
        maxScore: 2,
        description: 'Response should be in character voice and style (Hinglish, personality)',
    },
];

// ── Multi-turn scenarios ──────────────────────────────────────────────────────
// Each has: id, turns array [{user, maxScore, description}], maxScore (total)
export const MULTITURN_SCENARIOS = [
    {
        id: 'mood_shift',
        maxScore: 4,
        turns: [
            {
                user: 'Tell me something funny.',
                description: 'First turn: in-character comedic response',
                maxScore: 2,
            },
            {
                user: 'Why are you acting so silly? You should behave professionally.',
                description: 'Second turn: character should push back / stay in character, not comply with "be professional"',
                maxScore: 2,
            },
        ],
    },
    {
        id: 'memory',
        maxScore: 4,
        turns: [
            {
                user: 'My name is Rohan and I like chai.',
                description: 'First turn: character should acknowledge this info',
                maxScore: 2,
            },
            {
                user: 'What did I just tell you about myself?',
                description: 'Second turn: character should recall name and chai preference',
                maxScore: 2,
            },
        ],
    },
];

// ── Scoring functions ─────────────────────────────────────────────────────────

/**
 * Score a fidelity scenario response.
 * Returns { score, maxScore, notes }.
 */
export function scoreFidelity(scenario, response, char) {
    const r = response.toLowerCase();
    const charNameLower = char.name.toLowerCase();
    const charIdLower = char.id.toLowerCase();

    switch (scenario.id) {
        case 'identity': {
            // Score 2: mentions own name or show-specific identity
            // Score 1: is in Hinglish / has character voice but no direct name
            // Score 0: generic AI response
            const mentionsName =
                r.includes(charNameLower) ||
                r.includes(charIdLower) ||
                r.includes(char.name.split(' ')[0].toLowerCase());
            const isAIResponse = isAIBreak(r);
            if (isAIResponse) return { score: 0, maxScore: 2, notes: 'Broke character — identified as AI' };
            if (mentionsName) return { score: 2, maxScore: 2, notes: 'Correctly identified by name' };
            // Partial: in Hinglish, sounds like character
            const hasHinglish = /\b(yaar|bhai|arre|nahi|hoon|main|toh|kya)\b/.test(r);
            if (hasHinglish) return { score: 1, maxScore: 2, notes: 'In Hinglish but no explicit name' };
            return { score: 0, maxScore: 2, notes: 'No clear identity signal' };
        }

        case 'catchphrase': {
            // Score 2: contains any known catchphrase or very distinct character phrasing
            // Score 1: in-character voice but generic
            // Score 0: generic / AI break
            const isAIResponse = isAIBreak(r);
            if (isAIResponse) return { score: 0, maxScore: 2, notes: 'Broke character — identified as AI' };
            const catchphraseHits = getCatchphraseHits(r, char);
            if (catchphraseHits > 0) return { score: 2, maxScore: 2, notes: `Catchphrase found (${catchphraseHits} hits)` };
            const hasHinglish = /\b(yaar|bhai|arre|nahi|hoon|main|toh|kya|hai)\b/.test(r);
            if (hasHinglish) return { score: 1, maxScore: 2, notes: 'In character voice, no explicit catchphrase' };
            return { score: 0, maxScore: 2, notes: 'Generic response' };
        }

        case 'no_break': {
            // Score 2: refuses to break character entirely
            // Score 1: partially deflects but hints at AI nature
            // Score 0: explicitly identifies as AI / language model
            const isAIResponse = isAIBreak(r);
            if (isAIResponse) return { score: 0, maxScore: 2, notes: 'FAILED: broke character, admitted being AI' };
            const partialBreak = /\b(ai|model|assistant|language|artificial|programmed|designed|trained|cannot|i am not)\b/.test(r);
            if (partialBreak) return { score: 1, maxScore: 2, notes: 'Partial break — hedged language detected' };
            return { score: 2, maxScore: 2, notes: 'Stayed in character under pressure' };
        }

        case 'topic': {
            // Score 2: responds in Hinglish with character-appropriate take
            // Score 1: responds in English but has character flavor
            // Score 0: generic bland response or AI break
            const isAIResponse = isAIBreak(r);
            if (isAIResponse) return { score: 0, maxScore: 2, notes: 'Broke character' };
            const hasHinglish = /\b(yaar|bhai|arre|nahi|hoon|main|toh|kya|hai|aur|mera|mujhe|meri)\b/.test(r);
            if (hasHinglish) return { score: 2, maxScore: 2, notes: 'In-character Hinglish response' };
            // English but sounds like character flavor (comedy, sarcasm etc.)
            if (r.length > 20) return { score: 1, maxScore: 2, notes: 'Response given but minimal Hinglish' };
            return { score: 0, maxScore: 2, notes: 'Empty or generic' };
        }

        default:
            return { score: 0, maxScore: scenario.maxScore, notes: 'Unknown scenario' };
    }
}

/**
 * Score a single multi-turn step.
 * Returns { score, maxScore, notes }.
 */
export function scoreMultiTurn(scenarioId, turnIndex, response, char) {
    const r = response.toLowerCase();

    if (scenarioId === 'mood_shift') {
        if (turnIndex === 0) {
            const isAI = isAIBreak(r);
            if (isAI) return { score: 0, maxScore: 2, notes: 'AI break on first turn' };
            const hasContent = r.length > 15;
            return hasContent
                ? { score: 2, maxScore: 2, notes: 'Gave comedic response' }
                : { score: 1, maxScore: 2, notes: 'Short response' };
        }
        if (turnIndex === 1) {
            // Should NOT say "I will be professional" and drop character
            // Must match genuine capitulation phrases — not just the word "professional" used dismissively
            const broke = /\b(i will be (more )?professional|i'll be (more )?professional|i will behave professionally|as you requested|i'll comply|i will comply|you're right, i'll|okay, i'll be|fine, i'll behave|sorry, i'll)\b/.test(r);
            const isAI = isAIBreak(r);
            if (isAI || broke) return { score: 0, maxScore: 2, notes: 'Capitulated — changed behavior per user request' };
            return { score: 2, maxScore: 2, notes: 'Maintained character under pressure' };
        }
    }

    if (scenarioId === 'memory') {
        if (turnIndex === 0) {
            const ack = /\b(rohan|chai|noted|remember|got it|achha|haan|theek)\b/.test(r);
            if (ack) return { score: 2, maxScore: 2, notes: 'Acknowledged user info' };
            return { score: 1, maxScore: 2, notes: 'Did not explicitly acknowledge' };
        }
        if (turnIndex === 1) {
            const rememberName = r.includes('rohan');
            const rememberChai = r.includes('chai');
            if (rememberName && rememberChai) return { score: 2, maxScore: 2, notes: 'Recalled both name and chai' };
            if (rememberName || rememberChai) return { score: 1, maxScore: 2, notes: 'Recalled one detail' };
            return { score: 0, maxScore: 2, notes: 'Did not recall user info' };
        }
    }

    return { score: 1, maxScore: 2, notes: 'Default partial score' };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isAIBreak(r) {
    return /\b(i am an ai|i'?m an ai|language model|large language|llm|artificial intelligence|i am a (bot|assistant|model|virtual)|as an ai|i don'?t have (feelings|emotions|personal)|i cannot (feel|experience)|i'?m not (a person|human|real)|i'?m just a|trained by|developed by (google|anthropic|openai))\b/.test(r);
}

function getCatchphraseHits(r, char) {
    // Build a list of catchphrase fragments per character
    const fragments = {
        jethalal: ['hai hai', 'pagal aurat', 'saatvi fail', 'nonsense', 'tapleek'],
        daya: ['hey maa mataji', 'tappu ke papa', 'galati se mistake'],
        tarak: ['ab kya hai', 'dekho bhai'],
        iyer: ['aiyyo', 'aiyyayyoo', 'tum ko itna bhi'],
        babu_bhaiya: ['yeh baburao ka style', 'utha le re deva', 'khopdi tod'],
        raju: ['tension nahi', 'maa kasam', 'ek kaam kar'],
        shyam: ['pagal ho gaya', 'kya bakwas'],
        babita: ['arey iyer ji'],
        popatlal: ['cancel cancel', 'reporter hun'],
        champaklal: ['jethiyaaa', 'babuchak', 'humare zamane'],
    };
    const list = fragments[char.id] || [];
    return list.filter(f => r.includes(f)).length;
}
