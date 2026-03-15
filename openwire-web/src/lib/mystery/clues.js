/* ═══════════════════════════════════════════════════════════
   OpenWire — Murder Mystery: Clue Distribution
   Bounded Context: MurderMystery
   Distributes cross-clues from templates into suspect contexts
   and determines clue reveals during interrogation.
   ═══════════════════════════════════════════════════════════ */

/**
 * Take crossClues from a template and inject them into each suspect's
 * _crossClues array based on the [clueText, fromIdx, aboutIdx] tuples.
 *
 * Each suspect at index `fromIdx` receives the clue text as something
 * they know about the suspect at index `aboutIdx`.
 *
 * @param {object} template  A mystery template with `suspects` and `crossClues`
 * @returns {object[]}       Suspects array with _crossClues populated
 */
export function distributeClues(template) {
    const suspects = template.suspects.map(s => ({
        ...s,
        _crossClues: [...(s._crossClues || [])],
    }));

    for (const [clueText, fromIdx, aboutIdx] of (template.crossClues || [])) {
        if (fromIdx >= 0 && fromIdx < suspects.length && aboutIdx >= 0 && aboutIdx < suspects.length) {
            const aboutName = suspects[aboutIdx].name;
            suspects[fromIdx]._crossClues.push(
                `[About ${aboutName}]: ${clueText}`,
            );
        }
    }

    return suspects;
}

/**
 * Determine whether a question topic should trigger a clue reveal
 * from a suspect. Checks if any of the suspect's cross-clues are
 * relevant to the question by doing a simple keyword overlap.
 *
 * @param {object}  suspect        Suspect object with _crossClues
 * @param {string}  questionTopic  The player's question text
 * @returns {string|null}          The matching clue text, or null if no match
 */
export function getClueForPlayer(suspect, questionTopic) {
    if (!suspect._crossClues || suspect._crossClues.length === 0) return null;
    if (!questionTopic || typeof questionTopic !== 'string') return null;

    const lowerQuestion = questionTopic.toLowerCase();

    for (const clue of suspect._crossClues) {
        // Extract the "About <Name>" target and key terms from the clue
        const nameMatch = clue.match(/\[About (.+?)\]/);
        if (nameMatch) {
            const targetName = nameMatch[1].toLowerCase();
            // If the question mentions the target suspect by name, this clue is relevant
            if (lowerQuestion.includes(targetName)) {
                return clue;
            }
        }

        // Fallback: check for significant keyword overlap (3+ char words)
        const clueWords = clue.toLowerCase().split(/\W+/).filter(w => w.length > 3);
        const matchCount = clueWords.filter(w => lowerQuestion.includes(w)).length;
        if (matchCount >= 2) {
            return clue;
        }
    }

    return null;
}
