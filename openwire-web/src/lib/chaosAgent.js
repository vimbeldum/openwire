/**
 * Chaos Agent — standalone module (no React, no DOM).
 *
 * Provides personality definitions, template messages, and helpers
 * for the AI Chaos Agent feature that breaks chat silences.
 */

export const CHAOS_PERSONALITIES = {
    instigator: {
        name: 'The Instigator',
        emoji: '\uD83D\uDE08',
        style: 'provocative, roasts silence, asks polarizing questions',
    },
    snoop: {
        name: 'The Snoop',
        emoji: '\uD83D\uDD75\uFE0F',
        style: 'nosy, asks personal questions, reads between the lines',
    },
    hype: {
        name: 'The Hype Beast',
        emoji: '\uD83D\uDD25',
        style: 'overly enthusiastic, turns everything into a competition',
    },
    philosopher: {
        name: 'The Philosopher',
        emoji: '\uD83E\uDD14',
        style: 'deep questions, makes simple things profound',
    },
};

export const PERSONALITY_KEYS = Object.keys(CHAOS_PERSONALITIES);

export const SILENCE_TIMEOUT_MS = 30_000; // 30 seconds

// Template responses when no AI provider is available
export const CHAOS_TEMPLATES = {
    silence_break: [
        'The silence is DEAFENING. Did everyone fall asleep or just forget how to type?',
        '\uD83D\uDC40 30 seconds of silence. I can literally hear the WiFi signals bouncing around.',
        'HELLO?! Is this thing on? *taps microphone*',
        'Plot twist: everyone in this chat is actually a bot pretending to be human. Prove me wrong.',
        'Quick \u2014 everyone type the first word that comes to mind. GO!',
    ],
    challenges: [
        'CHALLENGE: Both of you describe your day using only movie titles. Best one wins respect.',
        'Hot take time: Pineapple on pizza \u2014 yes or no? DEFEND YOUR ANSWER.',
        'Who would survive longer in a zombie apocalypse based on this chat? I have opinions. \uD83D\uDC80',
        'Type your most controversial food opinion. No judgment. (There will be judgment.)',
        'Quick game: I spy something in this chat that\'s sus. First to guess wins.',
        'Rate each other\'s usernames from 1-10. Be honest. Be brutal.',
    ],
    roasts: [
        'This chat has the energy of a waiting room at the dentist. Step it up!',
        'I\'ve seen more excitement in a spreadsheet. Come on people!',
        'If this conversation was a spice, it\'d be flour.',
    ],
};

/**
 * Pick a random chaos message from the template pools.
 * @param {string} personality  — personality key (unused for templates but kept for API parity with LLM path)
 * @param {Array}  context      — recent messages (unused for templates)
 * @returns {string}
 */
export function pickChaosMessage(personality = 'instigator', context = []) {
    const roll = Math.random();
    const pool = roll > 0.5
        ? CHAOS_TEMPLATES.challenges
        : roll > 0.3
            ? CHAOS_TEMPLATES.silence_break
            : CHAOS_TEMPLATES.roasts;
    return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Build an LLM prompt for AI-powered chaos (future use with OpenRouter/Gemini).
 * @param {string} personality      — personality key
 * @param {Array}  recentMessages   — [{ nick, text }]
 * @param {Array}  participants     — [nick1, nick2, ...]
 * @returns {string}
 */
export function buildChaosPrompt(personality, recentMessages, participants) {
    const p = CHAOS_PERSONALITIES[personality] || CHAOS_PERSONALITIES.instigator;
    const messagesBlock = recentMessages && recentMessages.length > 0
        ? recentMessages.map(m => `${m.nick}: ${m.text}`).join('\n')
        : '(empty \u2014 total ghost town)';

    return `You are "${p.name}" ${p.emoji} \u2014 a chaos agent in a group chat.
Your personality: ${p.style}

The chat has been silent for 30+ seconds. Your job is to:
1. Break the silence in a fun, provocative way
2. Reference what people were talking about (if anything)
3. Ask a question or issue a challenge that FORCES responses
4. Keep it to 1-2 sentences max. Be punchy.
5. If they were talking in Hindi/Hinglish, respond in Hinglish

Recent messages:
${messagesBlock}

Participants: ${participants.join(', ')}

Your chaos message:`;
}

/**
 * Cycle to the next personality key.
 * @param {string} current — current personality key
 * @returns {string} — next personality key
 */
export function nextPersonality(current) {
    const idx = PERSONALITY_KEYS.indexOf(current);
    return PERSONALITY_KEYS[(idx + 1) % PERSONALITY_KEYS.length];
}

/**
 * Room constraint types and their display metadata.
 */
export const ROOM_CONSTRAINTS = {
    '5word': { label: '5 Words', badge: '\uD83E\uDD10 5-Word Mode', description: 'Max 5 words per message' },
    'emoji': { label: 'Emoji Only', badge: '\uD83D\uDE00 Emoji Only', description: 'Only emoji characters allowed' },
    'nobackspace': { label: 'No Backspace', badge: '\u26A0\uFE0F No Backspace', description: 'Backspace obliterates your draft' },
};

/**
 * Validate input against room constraint.
 * @param {string} text            — current input text
 * @param {string|null} constraint — active constraint key
 * @returns {{ valid: boolean, wordCount?: number }}
 */
export function validateConstraint(text, constraint) {
    if (!constraint) return { valid: true };
    if (constraint === '5word') {
        const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
        return { valid: wordCount <= 5, wordCount };
    }
    return { valid: true };
}

/**
 * Filter input text for emoji-only constraint.
 * @param {string} value — raw input value
 * @returns {string} — filtered value (emoji + whitespace only)
 */
export function filterEmojiOnly(value) {
    // Keep emoji sequences (including compound emoji with ZWJ, skin tones, etc.) and whitespace
    return value.replace(/[^\p{Emoji_Presentation}\p{Emoji}\uFE0F\u200D\s]/gu, '');
}
