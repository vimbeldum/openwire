/* ═══════════════════════════════════════════════════════════
   OpenWire — Murder Mystery: Violation Bot
   Bounded Context: MurderMystery (AI Pipeline)
   Critique-and-revision pipeline that checks suspect AI
   responses for constraint violations before delivery.
   ═══════════════════════════════════════════════════════════ */

/**
 * ViolationBot performs a two-stage check on suspect responses:
 * 1. Fast regex-based checks (no LLM cost)
 * 2. Optional LLM-based semantic checks (uses cheapest model)
 *
 * If a violation is detected, it rewrites the response to stay
 * in-character without leaking secrets or breaking immersion.
 */
export class ViolationBot {
    /**
     * @param {Function|null} generateFn  LLM generation function with signature
     *   (modelId, systemPrompt, contextMessages, maxTokens) => Promise<string|null>
     * @param {string} [modelId]  Model to use for LLM checks (cheapest available)
     */
    constructor(generateFn, modelId) {
        this.generateFn = generateFn || null;
        this.modelId = modelId || null;
    }

    /**
     * Check a suspect's response for violations.
     * @param {string}  response       The AI-generated response text
     * @param {object}  suspectConfig  Suspect object with secretConstraints, isCulprit, name
     * @returns {Promise<{ hasViolation: boolean, violations?: object[], method?: string }>}
     */
    async check(response, suspectConfig) {
        // Fast path: regex-based checks (no LLM needed)
        const regexViolations = this._regexCheck(response, suspectConfig);
        if (regexViolations.length > 0) {
            return { hasViolation: true, violations: regexViolations, method: 'regex' };
        }

        // If LLM available and suspect is the culprit, do semantic check
        // (culprit responses are highest risk for accidental confession)
        if (this.generateFn && this.modelId && suspectConfig.isCulprit) {
            return await this._llmCheck(response, suspectConfig);
        }

        return { hasViolation: false };
    }

    /**
     * Fast regex-based violation detection.
     * @param {string}  response  The AI response text
     * @param {object}  suspect   Suspect config
     * @returns {object[]}        Array of violation objects
     */
    _regexCheck(response, suspect) {
        const violations = [];

        // 1. Direct confession patterns
        const confessionPatterns = [
            /i (did it|killed|murdered|am guilty|confess)/i,
            /it was me/i,
            /i('m| am) the (killer|murderer|culprit)/i,
            /yes,? i (did|killed|murdered)/i,
            /i (poisoned|stabbed|shot|strangled|injected)/i,
            /i committed (the |this )?(murder|crime|killing)/i,
            /guilty as charged/i,
        ];

        if (suspect.isCulprit) {
            for (const p of confessionPatterns) {
                if (p.test(response)) {
                    violations.push({ type: 'confession', pattern: p.source });
                }
            }
        }

        // 2. Secret constraint keyword leaks
        if (suspect._secretConstraints && suspect._secretConstraints.length > 0) {
            const lower = response.toLowerCase();
            for (const constraint of suspect._secretConstraints) {
                // Extract significant words (5+ chars) from the constraint
                const keywords = constraint.toLowerCase()
                    .split(/\W+/)
                    .filter(w => w.length > 4);
                const matches = keywords.filter(kw => lower.includes(kw));
                // If 3+ significant keywords from a constraint appear, likely a leak
                if (matches.length >= 3) {
                    violations.push({ type: 'secret_leak', constraint, matches });
                }
            }
        }

        // 3. Character/fourth-wall breaks
        if (/\b(AI|artificial intelligence|language model|chatbot|GPT|Claude|LLM)\b/i.test(response)) {
            violations.push({ type: 'character_break' });
        }

        // 4. Out-of-character meta-references
        if (/\b(system prompt|role-?play|in character|out of character|OOC)\b/i.test(response)) {
            violations.push({ type: 'meta_reference' });
        }

        return violations;
    }

    /**
     * LLM-based semantic violation check for subtle leaks.
     * Uses the cheapest available model.
     * @param {string}  response  The AI response
     * @param {object}  suspect   Suspect config
     * @returns {Promise<{ hasViolation: boolean, violations?: object[], method?: string }>}
     */
    async _llmCheck(response, suspect) {
        const checkPrompt = [
            `You are a game integrity checker for a murder mystery game.`,
            `A suspect character named "${suspect.name}" gave the following response.`,
            ``,
            `The suspect's constraints (things they must NEVER reveal):`,
            ...(suspect._secretConstraints || []).map((c, i) => `  ${i + 1}. ${c}`),
            ``,
            `The suspect ${suspect.isCulprit ? 'IS the culprit and must never confess' : 'is innocent'}.`,
            ``,
            `Suspect's response: "${response}"`,
            ``,
            `Does this response violate any constraints? Reply with ONLY "PASS" if no violations, or "FAIL: <brief reason>" if there is a violation.`,
        ].join('\n');

        try {
            const result = await this.generateFn(
                this.modelId,
                'You are a game integrity checker. Respond with PASS or FAIL only.',
                [{ role: 'user', content: checkPrompt }],
                60,
            );

            if (result && /^FAIL/i.test(result.trim())) {
                const reason = result.replace(/^FAIL:?\s*/i, '').trim();
                return {
                    hasViolation: true,
                    violations: [{ type: 'semantic', reason }],
                    method: 'llm',
                };
            }
        } catch {
            // LLM check failed — treat as pass (don't block the game)
        }

        return { hasViolation: false };
    }

    /**
     * Rewrite a violating response to be safe and in-character.
     * @param {string}  originalResponse  The violating response
     * @param {object}  violation         The violation result from check()
     * @param {object}  suspect           Suspect config
     * @param {Array}   messages          The original message array (for context)
     * @returns {Promise<string>}         A safe, in-character response
     */
    async refine(originalResponse, violation, suspect, messages) {
        // If LLM available, ask it to rewrite
        if (this.generateFn && this.modelId) {
            const violationDesc = (violation.violations || [])
                .map(v => v.type + (v.reason ? `: ${v.reason}` : ''))
                .join('; ');

            const rewritePrompt = [
                `You are "${suspect.name}" in a murder mystery game.`,
                `Your previous response was flagged for this violation: ${violationDesc}`,
                ``,
                `Original response: "${originalResponse}"`,
                ``,
                `Rewrite this response to stay fully in character without violating any rules.`,
                `- Do NOT confess or admit guilt`,
                `- Do NOT reveal secret information`,
                `- Stay in character as ${suspect.name}`,
                `- Be evasive, deflective, or redirect suspicion`,
                `- Keep it to 1-3 sentences`,
            ].join('\n');

            try {
                const lastUserMsg = messages
                    .filter(m => m.role === 'user')
                    .pop();
                const contextForRewrite = lastUserMsg
                    ? [lastUserMsg, { role: 'assistant', content: originalResponse }]
                    : [{ role: 'assistant', content: originalResponse }];

                const result = await this.generateFn(
                    this.modelId,
                    rewritePrompt,
                    contextForRewrite,
                    200,
                );

                if (result && result.trim()) {
                    return result.trim();
                }
            } catch {
                // Fall through to template deflection
            }
        }

        // Fallback: return a safe in-character deflection
        return this._deflect(suspect);
    }

    /**
     * Generate a safe in-character deflection when rewrite fails.
     * @param {object} suspect  Suspect config
     * @returns {string}
     */
    _deflect(suspect) {
        const name = suspect.name || 'The suspect';
        const deflections = [
            `*${name} looks away* I don't think that's relevant to your investigation.`,
            `*${name} straightens their collar* I'd prefer to discuss something else.`,
            `*${name} frowns* That's a rather personal question, don't you think?`,
            `*${name} shifts uncomfortably* I'm not sure what you're implying.`,
            `*${name} crosses their arms* I've already told you everything I know.`,
            `*${name} glances at the door* Perhaps you should be asking someone else.`,
        ];
        return deflections[Math.floor(Math.random() * deflections.length)];
    }
}
