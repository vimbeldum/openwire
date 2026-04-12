import { useState, useRef, useEffect, useCallback } from 'react';
import * as clue from '../lib/cluedo';
import * as socket from '../lib/socket';

export default function useCluedoGame(deps) {
    const {
        myIdRef, nickRef, walletRef,
        addMsg, updateWallet, amIHost,
        updateBankLedger, resolvePayoutEvent, addActivityLog,
    } = deps;

    const [cluedoGame, setCluedoGame] = useState(null);
    const cluedoRef = useRef(null);
    const clueHostRef = useRef(null);
    const hasJoinedClue = useRef(false);

    useEffect(() => { cluedoRef.current = cluedoGame; }, [cluedoGame]);

    // ── Handle incoming socket messages ─────────────────────
    const handleCluedoAction = useCallback((msg, action) => {
        const myId = myIdRef.current;
        const myNick = nickRef.current;

        switch (action.type) {
            case 'clue_start': {
                if (action.host === myId) return;
                addMsg('\u2605', `${action.host_nick} started Cluedo!`, 'game_invite', {
                    gameType: 'cluedo',
                    inviteData: { room_id: action.room_id, host: action.host, host_nick: action.host_nick },
                    roomId: msg.room_id,
                });
                break;
            }
            case 'clue_state': {
                if (msg.peer_id === myIdRef.current) break;
                const gameState = clue.deserializeGame(action.state);
                if (gameState) {
                    if (!hasJoinedClue.current && clueHostRef.current !== myIdRef.current) break;
                    setCluedoGame(gameState);
                }
                break;
            }
            case 'clue_join': {
                if (!amIHost(clueHostRef.current)) break;
                setCluedoGame(prev => {
                    if (!prev) return prev;
                    const updated = clue.addPlayer(prev, action.peer_id, action.nick);
                    if (updated !== prev) {
                        setTimeout(() => {
                            socket.sendRoomMessage(updated.roomId, clue.serializeCluedoAction({ type: 'clue_state', state: clue.serializeGame(updated) }));
                        }, 0);
                    }
                    return updated;
                });
                break;
            }
            case 'clue_roll': {
                if (!amIHost(clueHostRef.current)) break;
                setCluedoGame(prev => {
                    if (!prev) return prev;
                    const updated = clue.roll(prev);
                    setTimeout(() => {
                        socket.sendRoomMessage(updated.roomId, clue.serializeCluedoAction({ type: 'clue_state', state: clue.serializeGame(updated) }));
                    }, 0);
                    return updated;
                });
                break;
            }
            case 'clue_move': {
                if (!amIHost(clueHostRef.current)) break;
                setCluedoGame(prev => {
                    if (!prev) return prev;
                    const updated = clue.moveToRoom(prev, action.room);
                    setTimeout(() => {
                        socket.sendRoomMessage(updated.roomId, clue.serializeCluedoAction({ type: 'clue_state', state: clue.serializeGame(updated) }));
                    }, 0);
                    return updated;
                });
                break;
            }
            case 'clue_stay': {
                if (!amIHost(clueHostRef.current)) break;
                setCluedoGame(prev => {
                    if (!prev) return prev;
                    const updated = clue.stayInRoom(prev);
                    setTimeout(() => {
                        socket.sendRoomMessage(updated.roomId, clue.serializeCluedoAction({ type: 'clue_state', state: clue.serializeGame(updated) }));
                    }, 0);
                    return updated;
                });
                break;
            }
            case 'clue_suggest': {
                if (!amIHost(clueHostRef.current)) break;
                setCluedoGame(prev => {
                    if (!prev) return prev;
                    const updated = clue.makeSuggestion(prev, action.suspect, action.weapon, action.room);
                    setTimeout(() => {
                        socket.sendRoomMessage(updated.roomId, clue.serializeCluedoAction({ type: 'clue_state', state: clue.serializeGame(updated) }));
                    }, 0);
                    return updated;
                });
                break;
            }
            case 'clue_accuse': {
                if (!amIHost(clueHostRef.current)) break;
                setCluedoGame(prev => {
                    if (!prev) return prev;
                    const updated = clue.makeAccusation(prev, action.suspect, action.weapon, action.room);
                    setTimeout(() => {
                        socket.sendRoomMessage(updated.roomId, clue.serializeCluedoAction({ type: 'clue_state', state: clue.serializeGame(updated) }));
                    }, 0);
                    return updated;
                });
                break;
            }
        }
    }, [addMsg, amIHost]);

    // ── Start Cluedo ────────────────────────────────────
    const startCluedo = useCallback((roomId) => {
        const myId = myIdRef.current;
        const myNick = nickRef.current;
        const newGame = clue.createCluedo(roomId);
        const withPlayer = clue.addPlayer(newGame, myId, myNick);
        const started = clue.startGame(withPlayer);
        setCluedoGame(started);
        clueHostRef.current = myId;
        hasJoinedClue.current = true;
        addMsg('\u2605', `\u{1F50D} Cluedo started! Make suggestions to find the murderer.`, 'system');
        socket.sendRoomMessage(roomId, clue.serializeCluedoAction({
            type: 'clue_start', room_id: roomId, host: myId, host_nick: myNick,
        }));
        socket.sendRoomMessage(roomId, clue.serializeCluedoAction({
            type: 'clue_state', state: clue.serializeGame(started),
        }));
    }, [addMsg]);

    // ── Local action handler ──────────────────────────────
    const handleClueAction = useCallback((action) => {
        const myId = myIdRef.current;
        const myNick = nickRef.current;
        const game = cluedoGame;

        if (!game) return;

        // Non-host sends actions to host
        if (!amIHost(clueHostRef.current)) {
            if (['roll', 'move', 'stay', 'suggest', 'accuse'].includes(action.type)) {
                socket.sendRoomMessage(game.roomId, clue.serializeCluedoAction({
                    type: `clue_${action.type}`,
                    peer_id: myId,
                    nick: myNick,
                    ...action,
                }));
            }
            return;
        }

        // Host processes locally
        let newGame = game;

        switch (action.type) {
            case 'roll':
                newGame = clue.roll(game);
                break;
            case 'move':
                newGame = clue.moveToRoom(game, action.room);
                break;
            case 'stay':
                newGame = clue.stayInRoom(game);
                break;
            case 'suggest':
                newGame = clue.makeSuggestion(game, action.suspect, action.weapon, action.room);
                break;
            case 'accuse':
                newGame = clue.makeAccusation(game, action.suspect, action.weapon, action.room);
                break;
            default:
                return;
        }

        setCluedoGame(newGame);
        socket.sendRoomMessage(newGame.roomId, clue.serializeCluedoAction({ type: 'clue_state', state: clue.serializeGame(newGame) }));
    }, [amIHost]);

    // Cleanup
    useEffect(() => {
        return () => {};
    }, []);

    return {
        cluedoGame, setCluedoGame,
        cluedoRef, clueHostRef, hasJoinedClue,
        handleCluedoAction, startCluedo, handleClueAction,
    };
}
