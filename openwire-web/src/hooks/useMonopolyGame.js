import { useState, useRef, useEffect, useCallback } from 'react';
import * as mono from '../lib/monopoly';
import * as socket from '../lib/socket';

export default function useMonopolyGame(deps) {
    const {
        myIdRef, nickRef, walletRef,
        addMsg, updateWallet, amIHost,
        updateBankLedger, resolvePayoutEvent, addActivityLog,
    } = deps;

    const [monopolyGame, setMonopolyGame] = useState(null);
    const monopolyRef = useRef(null);
    const monoHostRef = useRef(null);
    const hasJoinedMono = useRef(false);
    const monoTimerRef = useRef(null);

    useEffect(() => { monopolyRef.current = monopolyGame; }, [monopolyGame]);

    // ── Handle incoming socket messages ─────────────────────
    const handleMonopolyAction = useCallback((msg, action) => {
        const myId = myIdRef.current;
        const myNick = nickRef.current;

        switch (action.type) {
            case 'mono_start': {
                if (action.host === myId) return;
                addMsg('\u2605', `${action.host_nick} started Monopoly!`, 'game_invite', {
                    gameType: 'monopoly',
                    inviteData: { room_id: action.room_id, host: action.host, host_nick: action.host_nick },
                    roomId: msg.room_id,
                });
                break;
            }
            case 'mono_state': {
                if (msg.peer_id === myIdRef.current) break;
                const gameState = mono.deserializeGame(action.state);
                if (gameState) {
                    if (!hasJoinedMono.current && monoHostRef.current !== myIdRef.current) break;
                    setMonopolyGame(gameState);
                }
                break;
            }
            case 'mono_join': {
                if (!amIHost(monoHostRef.current)) break;
                setMonopolyGame(prev => {
                    if (!prev) return prev;
                    const updated = mono.addPlayer(prev, action.peer_id, action.nick);
                    if (updated !== prev) {
                        setTimeout(() => {
                            socket.sendRoomMessage(updated.roomId, mono.serializeMonopolyAction({ type: 'mono_state', state: mono.serializeGame(updated) }));
                        }, 0);
                    }
                    return updated;
                });
                break;
            }
            case 'mono_roll': {
                if (!amIHost(monoHostRef.current)) break;
                setMonopolyGame(prev => {
                    if (!prev) return prev;
                    const updated = mono.roll(prev);
                    setTimeout(() => {
                        socket.sendRoomMessage(updated.roomId, mono.serializeMonopolyAction({ type: 'mono_state', state: mono.serializeGame(updated) }));
                    }, 0);
                    return updated;
                });
                break;
            }
            case 'mono_buy': {
                if (!amIHost(monoHostRef.current)) break;
                setMonopolyGame(prev => {
                    if (!prev) return prev;
                    const updated = mono.buyProperty(prev);
                    setTimeout(() => {
                        socket.sendRoomMessage(updated.roomId, mono.serializeMonopolyAction({ type: 'mono_state', state: mono.serializeGame(updated) }));
                    }, 0);
                    return updated;
                });
                break;
            }
            case 'mono_auction': {
                if (!amIHost(monoHostRef.current)) break;
                setMonopolyGame(prev => {
                    if (!prev) return prev;
                    const updated = mono.auctionProperty(prev);
                    setTimeout(() => {
                        socket.sendRoomMessage(updated.roomId, mono.serializeMonopolyAction({ type: 'mono_state', state: mono.serializeGame(updated) }));
                    }, 0);
                    return updated;
                });
                break;
            }
            case 'mono_endturn': {
                if (!amIHost(monoHostRef.current)) break;
                setMonopolyGame(prev => {
                    if (!prev) return prev;
                    const updated = mono.endTurn(prev);
                    setTimeout(() => {
                        socket.sendRoomMessage(updated.roomId, mono.serializeMonopolyAction({ type: 'mono_state', state: mono.serializeGame(updated) }));
                    }, 0);
                    return updated;
                });
                break;
            }
        }
    }, [addMsg, amIHost]);

    // ── Start Monopoly ────────────────────────────────────
    const startMonopoly = useCallback((roomId) => {
        const myId = myIdRef.current;
        const myNick = nickRef.current;
        const newGame = mono.createMonopoly(roomId);
        const started = mono.startGame(mono.addPlayer(newGame, myId, myNick));
        setMonopolyGame(started);
        monoHostRef.current = myId;
        hasJoinedMono.current = true;
        addMsg('\u2605', `\u{1F3E0} Monopoly started! Buy properties, collect rent, bankrupt opponents to win!`, 'system');
        socket.sendRoomMessage(roomId, mono.serializeMonopolyAction({
            type: 'mono_start', room_id: roomId, host: myId, host_nick: myNick,
        }));
        socket.sendRoomMessage(roomId, mono.serializeMonopolyAction({
            type: 'mono_state', state: mono.serializeGame(started),
        }));
    }, [addMsg]);

    // ── Local action handler ──────────────────────────────
    const handleMonoAction = useCallback((action) => {
        const myId = myIdRef.current;
        const myNick = nickRef.current;
        const game = monopolyGame;

        if (!game) return;

        // Non-host sends actions to host
        if (!amIHost(monoHostRef.current)) {
            if (action.type === 'roll' || action.type === 'buy' || action.type === 'auction' || action.type === 'endturn') {
                socket.sendRoomMessage(game.roomId, mono.serializeMonopolyAction({
                    type: `mono_${action.type}`,
                    peer_id: myId,
                    nick: myNick,
                }));
            }
            return;
        }

        // Host processes locally
        let newGame = game;

        switch (action.type) {
            case 'roll':
                newGame = mono.roll(game);
                break;
            case 'buy':
                newGame = mono.buyProperty(game);
                break;
            case 'auction':
                newGame = mono.auctionProperty(game);
                break;
            case 'endturn':
                newGame = mono.endTurn(game);
                break;
            default:
                return;
        }

        setMonopolyGame(newGame);
        socket.sendRoomMessage(newGame.roomId, mono.serializeMonopolyAction({ type: 'mono_state', state: mono.serializeGame(newGame) }));
    }, [amIHost]);

    // Cleanup
    useEffect(() => {
        return () => {
            if (monoTimerRef.current) clearInterval(monoTimerRef.current);
        };
    }, []);

    return {
        monopolyGame, setMonopolyGame,
        monopolyRef, monoHostRef, hasJoinedMono,
        monoTimerRef,
        handleMonopolyAction, startMonopoly, handleMonoAction,
    };
}
