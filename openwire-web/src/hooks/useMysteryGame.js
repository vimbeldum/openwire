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

    /* ── Helper: mock AI suspect response ──────────────────── */

    const generateMockResponse = useCallback((suspect, _question) => {
        // In future, this calls a real AI endpoint. For now, return in-character mock.
        const deflections = [
            `I assure you, I had nothing to do with it. ${suspect?.alibi || 'I was elsewhere.'}`,
            `How dare you imply such a thing! ${suspect?.alibi || 'I have a perfectly good alibi.'}`,
            `Interesting question... Perhaps you should ask someone else about that.`,
            `I would never! ${suspect?.backstory ? 'I have been loyal for years.' : 'You have no evidence.'}`,
        ];
        return deflections[Math.floor(Math.random() * deflections.length)];
    }, []);

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
                setMysteryGame(prev => {
                    if (!prev) return prev;
                    let updated = prev;

                    if (action.action === 'interrogate') {
                        // Add player question
                        updated = mystery.addInterrogation(
                            updated, action.nick, action.suspectId, action.content, 'player',
                        );
                        // Generate AI response (host-only) and broadcast
                        const suspect = updated.suspects?.find(s => s.id === action.suspectId);
                        if (suspect) {
                            const response = generateMockResponse(suspect, action.content);
                            updated = mystery.addInterrogation(
                                updated, suspect.name, action.suspectId, response, 'suspect',
                            );
                        }
                    } else if (action.action === 'deliberate') {
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
                break;
            }
        }
    }, [addMsg, addActivityLog, amIHost, broadcastState, generateMockResponse]);

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
                newGame = generated;
                addActivityLog(`Mystery started: ${generated.mystery?.title || 'Unknown'}`);
                break;
            }

            case 'interrogate': {
                // Add player question
                newGame = mystery.addInterrogation(
                    game, myNick, action.suspectId, action.content, 'player',
                );
                // Generate AI response (host has suspect prompts)
                const suspect = newGame.suspects?.find(s => s.id === action.suspectId);
                if (suspect) {
                    const response = generateMockResponse(suspect, action.content);
                    newGame = mystery.addInterrogation(
                        newGame, suspect.name, action.suspectId, response, 'suspect',
                    );
                }
                break;
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
    }, [amIHost, addMsg, addActivityLog, broadcastState, generateMockResponse]);

    return {
        mysteryGame, setMysteryGame,
        mysteryRef, mysteryHostRef, hasJoinedMystery,
        handleMysteryAction, startMystery, handleMysteryLocalAction,
    };
}
