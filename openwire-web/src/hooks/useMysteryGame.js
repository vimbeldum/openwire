import { useState, useRef, useEffect, useCallback } from 'react';
import * as mystery from '../lib/mystery';
import * as socket from '../lib/socket';
import { generateSuspectResponse } from '../lib/agents/mysterySwarm';

/**
 * Custom hook encapsulating all Murder Mystery game state, refs, and handlers.
 * Follows the same P2P host-authority pattern as useBlackjackGame / useAndarBaharGame.
 *
 * @param {Object} deps - shared dependencies from ChatRoom
 * @param {React.MutableRefObject} deps.myIdRef
 * @param {React.MutableRefObject} deps.nickRef
 * @param {Function} deps.addMsg
 * @param {Function} deps.amIHost
 * @param {Function} deps.addActivityLog
 */
export default function useMysteryGame(deps) {
    const {
        myIdRef, nickRef,
        addMsg, amIHost, addActivityLog,
    } = deps;

    /* ── State & Refs ──────────────────────────────────────── */

    const [mysteryGame, setMysteryGame] = useState(null);
    const mysteryRef = useRef(null);
    const mysteryHostRef = useRef(null);
    const hasJoinedMystery = useRef(false);

    useEffect(() => { mysteryRef.current = mysteryGame; }, [mysteryGame]);

    /* ── Helper: broadcast state to room ───────────────────── */

    const broadcastState = useCallback((game) => {
        socket.sendRoomMessage(
            game.roomId,
            mystery.serializeMysteryAction({ type: 'mm_state', state: mystery.serializeGame(game) }),
        );
    }, []);

    /* ── Helper: generate AI suspect response (async) ───────── */

    const generateAIResponse = useCallback(async (suspect, question, playerNick) => {
        try {
            const currentGame = mysteryRef.current;
            if (!currentGame) return null;
            const result = await generateSuspectResponse(
                suspect, question, currentGame,
                {
                    swarm: deps.swarmRef?.current,
                    playerNick,
                    provider: currentGame._aiProvider || undefined,
                    model: currentGame._aiModel || undefined,
                },
            );
            return result;
        } catch (err) {
            console.warn('[Mystery] AI generation failed:', err?.message);
            // Use template system instead of hardcoded fallback
            return null;
        }
    }, [deps.swarmRef]);

    /* ── Message Handler: process MM: prefixed relay messages ─ */

    const handleMysteryAction = useCallback((msg, action) => {
        const myId = myIdRef.current;
        const myNick = nickRef.current;

        switch (action.type) {
            case 'mm_start': {
                // Another player started a mystery game — show invite (skip if I'm the host)
                if (action.host === myId) return;
                addMsg('\u2605', `\uD83D\uDD0D ${action.host_nick} started a Murder Mystery!`, 'game_invite', {
                    gameType: 'mystery',
                    inviteData: { room_id: action.room_id, host: action.host, host_nick: action.host_nick },
                    roomId: msg.room_id,
                });
                break;
            }

            case 'mm_state': {
                // Skip own state echo (host already has authoritative state)
                if (msg.peer_id === myIdRef.current) break;
                const gameState = mystery.deserializeGame(action.state);
                if (gameState) {
                    // Only accept state if we have joined or we are the host
                    if (!hasJoinedMystery.current && mysteryHostRef.current !== myIdRef.current) break;
                    setMysteryGame(prev => {
                        // Log phase transitions for activity feed
                        if (gameState.phase !== prev?.phase && gameState.phase === 'reveal') {
                            const culprit = gameState.suspects?.find(s => s.isCulprit);
                            if (culprit) {
                                setTimeout(() => addActivityLog(`Mystery: ${culprit.name} was the culprit!`), 0);
                            }
                        }
                        return gameState;
                    });
                }
                break;
            }

            case 'mm_join': {
                // A peer wants to join — host adds them, broadcasts updated state
                addMsg('\u2605', `\uD83D\uDD0D ${action.nick} joined the Mystery!`, 'system');
                setMysteryGame(prev => {
                    if (!prev) return prev;
                    if (prev.players.some(p => p.peer_id === action.peer_id)) return prev;
                    const updated = mystery.addPlayer(prev, action.peer_id, action.nick);
                    setTimeout(() => {
                        if (mysteryHostRef.current === myIdRef.current) {
                            broadcastState(updated);
                        }
                    }, 0);
                    return updated;
                });
                break;
            }

            case 'mm_player_action': {
                // Non-host player sent an action — only the host processes it
                if (!amIHost(mysteryHostRef.current)) break;

                if (action.action === 'interrogate') {
                    // Step 1: Add player question immediately
                    setMysteryGame(prev => {
                        if (!prev) return prev;
                        const updated = mystery.addInterrogation(
                            prev, action.nick, action.suspectId, action.content, 'player',
                        );
                        setTimeout(() => broadcastState(updated), 0);
                        return updated;
                    });
                    // Step 2: Generate AI response asynchronously
                    (async () => {
                        const currentGame = mysteryRef.current;
                        const suspect = currentGame?.suspects?.find(s => s.id === action.suspectId);
                        if (!suspect) return;
                        const result = await generateAIResponse(suspect, action.content, action.nick);
                        if (!result) return;
                        setMysteryGame(prev => {
                            if (!prev) return prev;
                            const updated = mystery.addInterrogation(
                                prev, suspect.name, action.suspectId, result.text, 'suspect', result.isRevised,
                            );
                            setTimeout(() => broadcastState(updated), 0);
                            return updated;
                        });
                    })();
                } else {
                    setMysteryGame(prev => {
                        if (!prev) return prev;
                        let updated = prev;

                        if (action.action === 'deliberate') {
                            updated = mystery.addInterrogation(
                                updated, action.nick, null, action.content, 'player',
                            );
                        } else if (action.action === 'vote') {
                            updated = mystery.castVote(updated, action.peer_id, action.suspectId);
                        } else if (action.action === 'advancePhase') {
                            if (updated.phase === 'investigation') {
                                updated = mystery.advanceToDeliberation(updated);
                            } else if (updated.phase === 'deliberation') {
                                updated = mystery.advanceToAccusation(updated);
                            }
                        } else {
                            return prev;
                        }

                        setTimeout(() => broadcastState(updated), 0);
                        return updated;
                    });
                }
                break;
            }
        }
    }, [addMsg, addActivityLog, amIHost, broadcastState, generateAIResponse]);

    /* ── Start Mystery: host creates and broadcasts ────────── */

    const startMystery = useCallback((roomId) => {
        const myId = myIdRef.current;
        const myNick = nickRef.current;

        const newGame = mystery.createMystery(roomId, myId);
        const withPlayer = mystery.addPlayer(newGame, myId, myNick);

        setMysteryGame(withPlayer);
        mysteryHostRef.current = myId;
        hasJoinedMystery.current = true;

        addMsg('\u2605', '\uD83D\uDD0D Murder Mystery lobby created!', 'system');

        socket.sendRoomMessage(
            roomId,
            mystery.serializeMysteryAction({ type: 'mm_start', room_id: roomId, host: myId, host_nick: myNick }),
        );
        broadcastState(withPlayer);
    }, [addMsg, broadcastState]);

    /* ── Local Action Handler: dispatched from MysteryBoard ── */

    const handleMysteryLocalAction = useCallback((action) => {
        if (!mysteryRef.current) return;
        const game = mysteryRef.current;
        const myId = myIdRef.current;
        const myNick = nickRef.current;

        /* ── Non-host: proxy actions to host ── */
        if (!amIHost(mysteryHostRef.current)) {
            if (action.type === 'join') {
                socket.sendRoomMessage(
                    game.roomId,
                    mystery.serializeMysteryAction({ type: 'mm_join', peer_id: myId, nick: myNick }),
                );
                return;
            }
            if (action.type === 'interrogate') {
                socket.sendRoomMessage(
                    game.roomId,
                    mystery.serializeMysteryAction({
                        type: 'mm_player_action', peer_id: myId, nick: myNick,
                        action: 'interrogate', suspectId: action.suspectId, content: action.content,
                    }),
                );
                return;
            }
            if (action.type === 'deliberate') {
                socket.sendRoomMessage(
                    game.roomId,
                    mystery.serializeMysteryAction({
                        type: 'mm_player_action', peer_id: myId, nick: myNick,
                        action: 'deliberate', content: action.content,
                    }),
                );
                return;
            }
            if (action.type === 'vote') {
                socket.sendRoomMessage(
                    game.roomId,
                    mystery.serializeMysteryAction({
                        type: 'mm_player_action', peer_id: myId, nick: myNick,
                        action: 'vote', suspectId: action.suspectId,
                    }),
                );
                return;
            }
            if (action.type === 'advancePhase') {
                socket.sendRoomMessage(
                    game.roomId,
                    mystery.serializeMysteryAction({
                        type: 'mm_player_action', peer_id: myId, nick: myNick,
                        action: 'advancePhase',
                    }),
                );
                return;
            }
            return; // non-host ignores start/reveal/newRound
        }

        /* ── Host processes locally ── */
        let newGame = game;

        switch (action.type) {
            case 'join':
                newGame = mystery.addPlayer(game, myId, myNick);
                socket.sendRoomMessage(
                    game.roomId,
                    mystery.serializeMysteryAction({ type: 'mm_join', peer_id: myId, nick: myNick }),
                );
                break;

            case 'start': {
                // Generate the mystery from templates
                const generated = mystery.generateMystery(game, action.templateId);
                // Store AI config so generateAIResponse can use it
                generated._aiProvider = action.aiProvider || '';
                generated._aiModel = action.aiModel || '';
                newGame = generated;
                addActivityLog(`Mystery started: ${generated.mystery?.title || 'Unknown'}`);
                break;
            }

            case 'interrogate': {
                // Add player question immediately and broadcast
                newGame = mystery.addInterrogation(
                    game, myNick, action.suspectId, action.content, 'player',
                );
                setMysteryGame(newGame);
                broadcastState(newGame);
                // Generate AI response asynchronously
                const interrogateSuspect = newGame.suspects?.find(s => s.id === action.suspectId);
                if (interrogateSuspect) {
                    (async () => {
                        let result = await generateAIResponse(interrogateSuspect, action.content, myNick);
                        // If AI failed, use template system directly
                        if (!result || !result.text) {
                            const { MysterySwarm } = await import('../lib/agents/mysterySwarm.js');
                            const ms = new MysterySwarm();
                            ms.init(newGame, null, null);
                            const tmpl = await ms.generateResponse(interrogateSuspect.id, action.content, myNick);
                            ms.destroy();
                            result = { text: tmpl?.text || `*${interrogateSuspect.name} shakes their head* I have nothing more to say.`, isRevised: false, clue: null };
                        }
                        setMysteryGame(prev => {
                            if (!prev) return prev;
                            const updated = mystery.addInterrogation(
                                prev, interrogateSuspect.name, action.suspectId,
                                result.text, 'suspect', result.isRevised,
                            );
                            setTimeout(() => broadcastState(updated), 0);
                            return updated;
                        });
                    })();
                }
                return; // skip the setMysteryGame/broadcastState at the end (already done above)
            }

            case 'deliberate':
                newGame = mystery.addInterrogation(
                    game, myNick, null, action.content, 'player',
                );
                break;

            case 'advancePhase':
                if (game.phase === 'investigation') {
                    newGame = mystery.advanceToDeliberation(game);
                } else if (game.phase === 'deliberation') {
                    newGame = mystery.advanceToAccusation(game);
                }
                break;

            case 'vote':
                newGame = mystery.castVote(game, myId, action.suspectId);
                // Auto-reveal if all players voted
                if (mystery.allPlayersVoted(newGame)) {
                    newGame = mystery.reveal(newGame);
                    const culprit = newGame.suspects?.find(s => s.isCulprit);
                    addActivityLog(`Mystery revealed: ${culprit?.name || 'Unknown'} was the culprit!`);
                }
                break;

            case 'reveal':
                newGame = mystery.reveal(game);
                break;

            case 'newRound':
                newGame = mystery.newRound(game);
                break;
        }

        setMysteryGame(newGame);
        broadcastState(newGame);
    }, [amIHost, addMsg, addActivityLog, broadcastState, generateAIResponse]);

    // ── Auto-advance phases when timer expires (host only) ──
    const mysteryPhaseTimerRef = useRef(null);
    useEffect(() => {
        if (mysteryPhaseTimerRef.current) { clearTimeout(mysteryPhaseTimerRef.current); mysteryPhaseTimerRef.current = null; }
        const game = mysteryGame;
        if (!game || !amIHost(mysteryHostRef.current)) return;

        const { phase, phaseStartedAt, phaseDuration } = game;
        if (!phaseStartedAt || !phaseDuration) return;
        if (!['investigation', 'deliberation', 'accusation'].includes(phase)) return;

        const elapsed = Date.now() - phaseStartedAt;
        const remaining = Math.max(0, phaseDuration - elapsed);

        mysteryPhaseTimerRef.current = setTimeout(() => {
            const current = mysteryRef.current;
            if (!current || !amIHost(mysteryHostRef.current)) return;

            let next = current;
            if (current.phase === 'investigation') {
                next = mystery.advanceToDeliberation(current);
            } else if (current.phase === 'deliberation') {
                next = mystery.advanceToAccusation(current);
            } else if (current.phase === 'accusation') {
                next = mystery.reveal(current);
            }
            setMysteryGame(next);
            broadcastState(next);
        }, remaining);

        return () => { if (mysteryPhaseTimerRef.current) clearTimeout(mysteryPhaseTimerRef.current); };
    }, [mysteryGame?.phase, mysteryGame?.phaseStartedAt, amIHost, broadcastState]);

    return {
        mysteryGame, setMysteryGame,
        mysteryRef, mysteryHostRef, hasJoinedMystery,
        handleMysteryAction, startMystery, handleMysteryLocalAction,
    };
}
