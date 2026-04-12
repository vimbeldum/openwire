import { useState, useRef, useEffect, useCallback } from 'react';
import * as shashn from '../lib/shashn';
import * as socket from '../lib/socket';

export default function useShashnGame(deps) {
    const {
        myIdRef, nickRef, walletRef,
        addMsg, updateWallet, amIHost,
        updateBankLedger, resolvePayoutEvent, addActivityLog,
    } = deps;

    const [shashnGame, setShashnGame] = useState(null);
    const shashnRef = useRef(null);
    const shashnHostRef = useRef(null);
    const hasJoinedShashn = useRef(false);

    useEffect(() => { shashnRef.current = shashnGame; }, [shashnGame]);

    // ── Handle incoming socket messages ─────────────────────
    const handleShashnAction = useCallback((msg, action) => {
        const myId = myIdRef.current;
        const myNick = nickRef.current;

        switch (action.type) {
            case 'shashn_start': {
                if (action.host === myId) return;
                addMsg('\u2605', `${action.host_nick} started Shashn!`, 'game_invite', {
                    gameType: 'shashn',
                    inviteData: { room_id: action.room_id, host: action.host, host_nick: action.host_nick },
                    roomId: msg.room_id,
                });
                break;
            }
            case 'shashn_state': {
                if (msg.peer_id === myIdRef.current) break;
                const gameState = shashn.deserializeGame(action.state);
                if (gameState) {
                    if (!hasJoinedShashn.current && shashnHostRef.current !== myIdRef.current) break;
                    setShashnGame(gameState);
                }
                break;
            }
            case 'shashn_join': {
                if (!amIHost(shashnHostRef.current)) break;
                setShashnGame(prev => {
                    if (!prev) return prev;
                    const updated = shashn.addPlayer(prev, action.peer_id, action.nick);
                    if (updated !== prev) {
                        setTimeout(() => {
                            socket.sendRoomMessage(updated.roomId, shashn.serializeShashnAction({ type: 'shashn_state', state: shashn.serializeGame(updated) }));
                        }, 0);
                    }
                    return updated;
                });
                break;
            }
            case 'shashn_play': {
                if (!amIHost(shashnHostRef.current)) break;
                setShashnGame(prev => {
                    if (!prev) return prev;
                    const updated = shashn.playCard(prev, action.cardId);
                    setTimeout(() => {
                        socket.sendRoomMessage(updated.roomId, shashn.serializeShashnAction({ type: 'shashn_state', state: shashn.serializeGame(updated) }));
                    }, 0);
                    return updated;
                });
                break;
            }
            case 'shashn_collect': {
                if (!amIHost(shashnHostRef.current)) break;
                setShashnGame(prev => {
                    if (!prev) return prev;
                    const updated = shashn.collectTrick(prev);
                    setTimeout(() => {
                        socket.sendRoomMessage(updated.roomId, shashn.serializeShashnAction({ type: 'shashn_state', state: shashn.serializeGame(updated) }));
                    }, 0);
                    return updated;
                });
                break;
            }
            case 'shashn_newround': {
                if (!amIHost(shashnHostRef.current)) break;
                setShashnGame(prev => {
                    if (!prev) return prev;
                    const updated = shashn.newRound(prev);
                    setTimeout(() => {
                        socket.sendRoomMessage(updated.roomId, shashn.serializeShashnAction({ type: 'shashn_state', state: shashn.serializeGame(updated) }));
                    }, 0);
                    return updated;
                });
                break;
            }
        }
    }, [addMsg, amIHost]);

    // ── Start Shashn ────────────────────────────────────
    const startShashn = useCallback((roomId) => {
        const myId = myIdRef.current;
        const myNick = nickRef.current;
        const newGame = shashn.createShashn(roomId);
        const withPlayer = shashn.addPlayer(newGame, myId, myNick);
        setShashnGame(withPlayer);
        shashnHostRef.current = myId;
        hasJoinedShashn.current = true;
        addMsg('\u2605', `\u{1F0A1} Shashn started! 2-player trick-taking card game.`, 'system');
        socket.sendRoomMessage(roomId, shashn.serializeShashnAction({
            type: 'shashn_start', room_id: roomId, host: myId, host_nick: myNick,
        }));
        socket.sendRoomMessage(roomId, shashn.serializeShashnAction({
            type: 'shashn_state', state: shashn.serializeGame(withPlayer),
        }));
    }, [addMsg]);

    // ── Local action handler ──────────────────────────────
    const handleShashnLocalAction = useCallback((action) => {
        const myId = myIdRef.current;
        const myNick = nickRef.current;
        const game = shashnGame;

        if (!game) return;

        // Non-host sends actions to host
        if (!amIHost(shashnHostRef.current)) {
            if (['play', 'collect', 'newround'].includes(action.type)) {
                socket.sendRoomMessage(game.roomId, shashn.serializeShashnAction({
                    type: `shashn_${action.type}`,
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
            case 'play':
                newGame = shashn.playCard(game, action.cardId);
                break;
            case 'collect':
                newGame = shashn.collectTrick(game);
                break;
            case 'newround':
                newGame = shashn.newRound(game);
                break;
            default:
                return;
        }

        setShashnGame(newGame);
        socket.sendRoomMessage(newGame.roomId, shashn.serializeShashnAction({ type: 'shashn_state', state: shashn.serializeGame(newGame) }));
    }, [amIHost]);

    // Cleanup
    useEffect(() => {
        return () => {};
    }, []);

    return {
        shashnGame, setShashnGame,
        shashnRef, shashnHostRef, hasJoinedShashn,
        handleShashnAction, startShashn, handleShashnLocalAction,
    };
}
