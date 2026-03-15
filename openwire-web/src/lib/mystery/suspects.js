/* ═══════════════════════════════════════════════════════════
   OpenWire — Murder Mystery: Suspect Prompt Construction
   Bounded Context: MurderMystery
   Builds LLM system prompts for suspect characters and
   sanitizes suspect data for P2P broadcast.
   ═══════════════════════════════════════════════════════════ */

/**
 * Build the full LLM system prompt for a suspect character.
 * This prompt is used by the MysterySwarm AI pipeline to generate
 * in-character responses during interrogation.
 *
 * @param {object} suspect   Suspect object with personality, backstory, etc.
 * @param {object} mystery   Mystery definition (title, setting, victim, weapon)
 * @returns {string}         Complete system prompt for the LLM
 */
export function buildSuspectPrompt(suspect, mystery) {
    const constraintLines = (suspect.secretConstraints || [])
        .map((c, i) => `  ${i + 1}. ${c}`)
        .join('\n');

    const crossClueLines = (suspect._crossClues || [])
        .map((c, i) => `  ${i + 1}. ${c}`)
        .join('\n');

    return [
        `You are ${suspect.name}, ${suspect.role} in "${mystery.title}".`,
        `Setting: ${mystery.setting}`,
        ``,
        `== YOUR IDENTITY ==`,
        `Personality: ${suspect.personality}`,
        `Backstory: ${suspect.backstory}`,
        `Your relationship to the victim (${mystery.victim.name}): ${suspect.relationshipToVictim}`,
        ``,
        `== YOUR ALIBI ==`,
        `You claim: ${suspect.alibi}`,
        ``,
        `== YOUR SECRET ==`,
        `What you are hiding: ${suspect.secret}`,
        suspect.isCulprit
            ? `You ARE the murderer. The weapon was: ${mystery.weapon}. Your motive: ${mystery.motive}. You must NEVER confess or directly admit guilt.`
            : `You are INNOCENT. You did NOT commit the murder. But you have your own secret to protect.`,
        ``,
        `== ABSOLUTE CONSTRAINTS (NEVER VIOLATE) ==`,
        constraintLines || '  (none)',
        ``,
        `== THINGS YOU HAVE HEARD ABOUT OTHERS ==`,
        crossClueLines || '  (none)',
        ``,
        `== BEHAVIORAL RULES ==`,
        `- Stay fully in character at all times.`,
        `- Respond in 1-3 sentences unless the question demands more detail.`,
        `- You may deflect, lie about your secret, or redirect suspicion to others.`,
        `- If asked about something you have heard about another suspect, you may reveal it partially or use it to deflect.`,
        `- Never break the fourth wall. You do not know you are an AI.`,
        `- Never directly reveal your secret constraints. If pressed, dodge or give a half-truth.`,
        `- Show emotion appropriate to your personality when accused or cornered.`,
        `- If the player asks in Hindi or Hinglish, respond in the same style.`,
        `  You are comfortable with Hindi, English, and Hinglish.`,
        `  Use natural Hindi expressions: "Arrey!", "Kya baat kar rahe ho?",`,
        `  "Main toh wahan tha hi nahi", "Jhooth bol raha hai woh"`,
    ].join('\n');
}

/**
 * Strip AI-only fields from suspects before broadcasting to non-host peers.
 * Prevents players from inspecting DevTools to see system prompts,
 * secret constraints, or cross-clues.
 *
 * @param {object[]} suspects  Array of suspect objects (may include _-prefixed fields)
 * @returns {object[]}         Sanitized suspects safe for broadcast
 */
export function sanitizeSuspects(suspects) {
    return (suspects || []).map(s => {
        const {
            _systemPrompt,
            _secretConstraints,
            _crossClues,
            _conversationHistory,
            ...safe
        } = s;
        return safe;
    });
}
