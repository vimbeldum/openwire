/**
 * ShashnStateSummary — A compact state bar shown in ChatRoom when a SHASN
 * game is active but the board is closed. Lets the user see waiting/active/
 * your-turn cues and re-enter the board.
 *
 * M004/S01/T02: Wire SHASN invite and active-state continuity through ChatRoom
 */

import { memo } from 'react';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Panel from '../ui/Panel';

/**
 * @param {object} props
 * @param {object} props.game - The shashn game state (from useShashnGame)
 * @param {string} props.myId - Current user's peer_id
 * @param {function} props.onOpenBoard - Callback to open the SHASN board
 */
function ShashnStateSummary({ game, myId, onOpenBoard }) {
    if (!game) return null;

    const myPlayerIdx = game.players?.findIndex(p => p.peer_id === myId) ?? -1;
    const otherPlayer = game.players?.find(p => p.peer_id !== null && p.peer_id !== myId) || null;
    const opponentName = otherPlayer?.nick || null;
    const phase = game.phase;
    const totalPlayers = game.players?.filter(p => p.peer_id !== null).length || 0;
    const currentPlayerPeerId = game.players?.[game.currentPlayer]?.peer_id || null;
    const isMyTurn = currentPlayerPeerId === myId;

    let badgeTone = 'neutral';
    let statusLabel = '';
    let summaryIcon = '';

    if (phase === 'deal') {
        // totalPlayers < 2 means at least one slot is still empty
        if (totalPlayers < 2) {
            badgeTone = 'info';
            // If at least me has joined, it's 'waiting for opponent'; if no one, 'waiting for players'
            const iHaveJoined = game.players?.some(p => p.peer_id === myId) || false;
            statusLabel = iHaveJoined ? 'Waiting for opponent to join...' : 'Waiting for players...';
            summaryIcon = '\u23F3';
        } else {
            badgeTone = 'info';
            statusLabel = 'Starting...';
            summaryIcon = '\uD83C\uDCCF';
        }
    } else if (phase === 'play' || phase === 'trick_end') {
        if (isMyTurn && phase === 'play') {
            badgeTone = 'success';
            statusLabel = 'Your turn!';
            summaryIcon = '\uD83C\uDFAF';
        } else if (phase === 'play') {
            badgeTone = 'warning';
            statusLabel = opponentName ? `Waiting for ${opponentName}...` : 'Waiting...';
            summaryIcon = '\u23F3';
        } else {
            badgeTone = 'info';
            statusLabel = 'Trick complete';
            summaryIcon = '\uD83C\uDFC6';
        }
    } else if (phase === 'round_end') {
        badgeTone = 'info';
        statusLabel = game.winner
            ? (game.winner === myId ? 'You won the round!' :
                opponentName ? opponentName + ' won the round' : 'Round over')
            : 'Round complete';
        summaryIcon = '\uD83C\uDFC6';
    } else if (phase === 'game_end') {
        badgeTone = 'success';
        statusLabel = game.winner === myId ? 'You won!' : 'Game Over!';
        summaryIcon = '\uD83C\uDFC1';
    }

    return (
        <Panel tone="subtle" padding="md" className="shashn-state-summary">
            <div className="shashn-state-summary-inner">
                <span className="shashn-state-icon">{summaryIcon}</span>
                <span className="shashn-state-text">
                    <Badge tone={badgeTone} className="shashn-state-badge">{statusLabel}</Badge>
                    {opponentName && phase !== 'deal' && (
                        <span className="shashn-state-opponent">vs {opponentName} &middot; Round {game.round || 1}</span>
                    )}
                </span>
                <span className="shashn-state-actions">
                    <Button variant="primary" size="sm" leadingIcon={'\uD83C\uDCCF'} onClick={onOpenBoard}>
                        Open Board
                    </Button>
                </span>
            </div>
        </Panel>
    );
}

export default memo(ShashnStateSummary);
