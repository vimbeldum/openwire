import { useState, useRef, useEffect, useCallback } from 'react';
import * as rl from '../lib/roulette';
import * as wallet from '../lib/wallet';
import * as socket from '../lib/socket';

/**
 * Custom hook encapsulating all Roulette game state, refs, timers, and handlers.
 *
 * @param {Object} deps - shared dependencies from ChatRoom
 * @param {React.MutableRefObject} deps.myIdRef
 * @param {React.MutableRefObject} deps.nickRef
 * @param {React.MutableRefObject} deps.walletRef
 * @param {Function} deps.addMsg
 * @param {Function} deps.updateWallet
 * @param {Function} deps.amIHost
 * @param {Function} deps.updateBankLedger
 * @param {Function} deps.resolvePayoutEvent
 * @param {Function} deps.addActivityLog
 */
export default function useRouletteGame(deps) {
    const {
        myIdRef, nickRef, walletRef,
        addMsg, updateWallet, amIHost,
        updateBankLedger, resolvePayoutEvent, addActivityLog,
    } = deps;

    const [rouletteGame, setRouletteGame] = useState(null);
    const rouletteRef = useRef(null);
    const rouletteHostRef = useRef(null);
    const hasJoinedRl = useRef(false);
    const rouletteTimerRef = useRef(null);
    const rouletteSpinTimeoutRef = useRef(null);
    const rouletteResultTimeoutRef = useRef(null);

    useEffect(() => { rouletteRef.current = rouletteGame; }, [rouletteGame]);

    // ── Roulette auto-spin ───────────────────────────────────
    const startRouletteTimer = useCallback(() => {
        if (rouletteTimerRef.current) clearInterval(rouletteTimerRef.current);
        clearTimeout(rouletteSpinTimeoutRef.current);
        clearTimeout(rouletteResultTimeoutRef.current);

        rouletteTimerRef.current = setInterval(() => {
            const currentGame = rouletteRef.current;
            const hostId = rouletteHostRef.current;
            if (!currentGame || !amIHost(hostId)) return;
            if (currentGame.phase !== 'betting') return;

            // Start 10s spinning phase
            const spun = rl.spin(currentGame);
            setRouletteGame(spun);

            const roomId = currentGame.roomId;
            socket.sendRoomMessage(roomId, rl.serializeRouletteAction({ type: 'rl_state', state: rl.serializeGame(spun) }));
            addActivityLog(`Roulette wheel spinning...`);

            // After SPIN_PHASE_MS (10s), show results
            rouletteSpinTimeoutRef.current = setTimeout(() => {
                const resultsGame = rl.finishSpin(rouletteRef.current || spun);
                setRouletteGame(resultsGame);

                // Apply winnings via Global Ledger Service
                const myId = myIdRef.current;
                const myNet = resultsGame.payouts?.[myId];

                // Track house P&L
                if (amIHost(rouletteHostRef.current) && resultsGame.payouts) {
                    updateBankLedger('roulette', resultsGame.payouts);
                }

                if (myNet !== undefined && walletRef.current) {
                    const event = new rl.RouletteEngine(resultsGame).calculateResults(resultsGame);
                    resolvePayoutEvent(event, myId, walletRef.current);
                }

                if (amIHost(rouletteHostRef.current)) {
                    socket.sendRoomMessage(roomId, rl.serializeRouletteAction({ type: 'rl_state', state: rl.serializeGame(resultsGame) }));
                    addActivityLog(`Roulette spin: result ${spun.result} (${rl.getColor(spun.result)})`);
                }

                // After RESULTS_DISPLAY_MS (10s), start new betting round
                rouletteResultTimeoutRef.current = setTimeout(() => {
                    const reset = rl.newRound(rouletteRef.current || resultsGame);
                    setRouletteGame(reset);
                    if (amIHost(rouletteHostRef.current)) {
                        socket.sendRoomMessage(roomId, rl.serializeRouletteAction({ type: 'rl_state', state: rl.serializeGame(reset) }));
                    }
                }, rl.RESULTS_DISPLAY_MS);

            }, rl.SPIN_PHASE_MS);

        }, rl.SPIN_INTERVAL_MS);
    }, [addActivityLog, amIHost, updateWallet]);

    // ── Roulette message handler ─────────────────────────────
    const handleRouletteAction = useCallback((msg, action) => {
        const myId = myIdRef.current;
        switch (action.type) {
            case 'rl_start': {
                if (action.host === myId) return;
                addMsg('\u{1F3B0}', `${action.host_nick} started Roulette!`, 'game_invite', {
                    gameType: 'roulette',
                    inviteData: { room_id: action.room_id, host: action.host, host_nick: action.host_nick },
                    roomId: msg.room_id,
                });
                break;
            }
            case 'rl_state': {
                // Skip own state echo (host already has authoritative state)
                if (msg.peer_id === myIdRef.current) break;
                const gameState = rl.deserializeGame(action.state);
                if (gameState) {
                    if (!hasJoinedRl.current && rouletteHostRef.current !== myIdRef.current) break;
                    setRouletteGame(prev => {
                        if (gameState.phase === 'results' && prev?.phase !== 'results' && !amIHost(rouletteHostRef.current)) {
                            const myNet = gameState.payouts?.[myId];
                            if (myNet !== undefined && walletRef.current) {
                                const event = new rl.RouletteEngine(gameState).calculateResults(gameState);
                                setTimeout(() => resolvePayoutEvent(event, myId, walletRef.current), 0);
                            }
                        }
                        return gameState;
                    });
                }
                break;
            }
            case 'rl_bet': {
                // Host processes remote player's bet
                if (!amIHost(rouletteHostRef.current)) break;
                setRouletteGame(prev => {
                    if (!prev || prev.phase !== 'betting') return prev;
                    const updated = rl.placeBet(prev, action.peer_id, action.nick, action.betType, action.betTarget, action.amount);
                    setTimeout(() => {
                        socket.sendRoomMessage(updated.roomId, rl.serializeRouletteAction({ type: 'rl_state', state: rl.serializeGame(updated) }));
                    }, 0);
                    return updated;
                });
                break;
            }
            case 'rl_clearBets': {
                if (!amIHost(rouletteHostRef.current)) break;
                setRouletteGame(prev => {
                    if (!prev) return prev;
                    const updated = rl.clearBets(prev, action.peer_id);
                    setTimeout(() => {
                        socket.sendRoomMessage(updated.roomId, rl.serializeRouletteAction({ type: 'rl_state', state: rl.serializeGame(updated) }));
                    }, 0);
                    return updated;
                });
                break;
            }
        }
    }, [addMsg, amIHost]);

    // ── Roulette start ────────────────────────────────────
    const startRoulette = useCallback((roomId) => {
        const myId = myIdRef.current;
        const myNick = nickRef.current;
        const newGame = rl.createRoulette(roomId);
        setRouletteGame(newGame);
        rouletteHostRef.current = myId;
        hasJoinedRl.current = true; // host auto-joined
        addMsg('\u2605', `\u{1F3B0} Roulette started! Auto-spin every 2 minutes.`, 'system');
        socket.sendRoomMessage(roomId, rl.serializeRouletteAction({ type: 'rl_start', room_id: roomId, host: myId, host_nick: myNick }));
        socket.sendRoomMessage(roomId, rl.serializeRouletteAction({ type: 'rl_state', state: rl.serializeGame(newGame) }));
        startRouletteTimer();
    }, [addMsg, startRouletteTimer]);

    // ── Roulette local action handler ───────────────────────
    const handleRlAction = useCallback((action) => {
        if (!rouletteRef.current) return;
        const rouletteGame = rouletteRef.current;
        const myId = myIdRef.current;
        const myNick = nickRef.current;

        // Non-host: proxy bet/clearBets to host (host is authoritative)
        if (!amIHost(rouletteHostRef.current)) {
            if (action.type === 'bet') {
                const w = walletRef.current;
                if (!w || !wallet.canAfford(w, action.amount)) { addMsg('\u2605', `\u26A0 Insufficient chips.`, 'system'); return; }
                updateWallet(wallet.debit(w, action.amount, 'Roulette bet'));
                socket.sendRoomMessage(rouletteGame.roomId, rl.serializeRouletteAction({
                    type: 'rl_bet', peer_id: myId, nick: myNick, betType: action.betType, betTarget: action.betTarget, amount: action.amount,
                }));
            } else if (action.type === 'clearBets') {
                const myBets = (rouletteGame.bets || []).filter(b => b.peer_id === myId);
                const refund = myBets.reduce((s, b) => s + (b.amount || 0), 0);
                if (refund > 0 && walletRef.current) {
                    updateWallet(wallet.credit(walletRef.current, refund, 'Roulette bets cleared'));
                }
                socket.sendRoomMessage(rouletteGame.roomId, rl.serializeRouletteAction({
                    type: 'rl_clearBets', peer_id: myId,
                }));
            }
            return;
        }

        // Host processes locally
        let newGame = rouletteGame;

        switch (action.type) {
            case 'bet': {
                const w = walletRef.current;
                if (!w || !wallet.canAfford(w, action.amount)) { addMsg('\u2605', `\u26A0 Insufficient chips.`, 'system'); return; }
                updateWallet(wallet.debit(w, action.amount, 'Roulette bet'));
                newGame = rl.placeBet(rouletteGame, myId, myNick, action.betType, action.betTarget, action.amount);
                break;
            }
            case 'clearBets': {
                const myBets = (rouletteGame.bets || []).filter(b => b.peer_id === myId);
                const refund = myBets.reduce((s, b) => s + (b.amount || 0), 0);
                if (refund > 0 && walletRef.current) {
                    updateWallet(wallet.credit(walletRef.current, refund, 'Roulette bets cleared'));
                }
                newGame = rl.clearBets(rouletteGame, myId);
                break;
            }
        }

        setRouletteGame(newGame);
        socket.sendRoomMessage(newGame.roomId, rl.serializeRouletteAction({ type: 'rl_state', state: rl.serializeGame(newGame) }));
    }, [amIHost, addMsg, updateWallet]);

    // Cleanup timers on unmount
    useEffect(() => {
        return () => {
            if (rouletteTimerRef.current) clearInterval(rouletteTimerRef.current);
            clearTimeout(rouletteSpinTimeoutRef.current);
            clearTimeout(rouletteResultTimeoutRef.current);
        };
    }, []);

    return {
        rouletteGame, setRouletteGame,
        rouletteRef, rouletteHostRef, hasJoinedRl,
        rouletteTimerRef, rouletteSpinTimeoutRef, rouletteResultTimeoutRef,
        startRouletteTimer, handleRouletteAction,
        startRoulette, handleRlAction,
    };
}
