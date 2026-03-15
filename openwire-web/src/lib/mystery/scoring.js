/* ═══════════════════════════════════════════════════════════
   OpenWire — Murder Mystery: Scoring
   Bounded Context: MurderMystery
   Pure scoring calculations for the reveal phase.
   ═══════════════════════════════════════════════════════════ */

/**
 * Scoring constants.
 * Values match the architecture spec (Section 5.4).
 */
export const SCORING = {
    correctAccusation: 100,
    wrongAccusation: 0,
    questionsAskedBonus: 2,
    uniqueSuspectsBonus: 10,
    earlyVoteBonus: 25,
    cluesDiscoveredBonus: 5,
};

/**
 * Calculate scores for every player after the reveal.
 *
 * @param {object} game  Game state with phase === 'reveal' or 'ended'
 * @returns {{ correctVoters: string[], scores: {[peer_id]: number}, totalQuestions: {[peer_id]: number} }}
 */
export function calculateScores(game) {
    const culpritId = game.mystery?.culpritId ?? null;
    const correctVoters = [];
    const scores = {};
    const totalQuestions = {};

    for (const player of game.players) {
        const pid = player.peer_id;
        let score = 0;

        // --- Accusation ---
        if (player.vote && player.vote === culpritId) {
            score += SCORING.correctAccusation;
            correctVoters.push(pid);
        }

        // --- Questions asked ---
        const playerQuestions = (game.interrogations || []).filter(
            m => m.senderType === 'player' && m.sender === player.nick,
        );
        const questionCount = playerQuestions.length;
        totalQuestions[pid] = questionCount;
        score += questionCount * SCORING.questionsAskedBonus;

        // --- Unique suspects interrogated ---
        const uniqueSuspects = new Set(
            playerQuestions.map(m => m.suspectId).filter(Boolean),
        );
        score += uniqueSuspects.size * SCORING.uniqueSuspectsBonus;

        // --- Early vote bonus ---
        if (player.vote === culpritId && game.accusationDurationMs && game.phaseStartedAt) {
            const elapsed = (player.votedAt || Date.now()) - game.phaseStartedAt;
            const halfDuration = game.accusationDurationMs / 2;
            if (elapsed < halfDuration) {
                score += SCORING.earlyVoteBonus;
            }
        }

        scores[pid] = score;
    }

    return { correctVoters, scores, totalQuestions };
}
