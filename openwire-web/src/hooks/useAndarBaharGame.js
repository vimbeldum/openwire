import { useState, useRef, useEffect, useCallback } from 'react';
import * as ab from '../lib/andarbahar';
import * as wallet from '../lib/wallet';
import * as socket from '../lib/socket';

/**
 * Custom hook encapsulating all Andar Bahar game state, refs, timers, and handlers.
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
export default function useAndarBaharGame(deps) {
    const {
        myIdRef, nickRef, walletRef,
        addMsg, updateWallet, amIHost,
        updateBankLedger, resolvePayoutEvent, addActivityLog,
    } = deps;

    const [andarBaharGame, setAndarBaharGame] = useState(null);
    const andarBaharRef = useRef(null);
    const abHostRef = useRef(null);
    const hasJoinedAb = useRef(false);
    const abDealTimerRef = useRef(null);
    const abCycleTimerRef = useRef(null);
    const abGenRef = useRef(0);
    const startAbCycleRef = useRef(null);

    useEffect(() => { andarBaharRef.current = andarBaharGame; }, [andarBaharGame]);

    // ── Andar Bahar auto-cycle (host-driven) ─────────────────
    const startAbCycle = useCallback((initialGame) => {
        // Clear any existing timers
        if (abDealTimerRef.current) clearInterval(abDealTimerRef.current);
        if (abCycleTimerRef.current) clearTimeout(abCycleTimerRef.current);
        abGenRef.current++;
        const gen = abGenRef.current;

        const roomId = initialGame.roomId;
        const bettingMs = ab.BETTING_DURATION_MS;

        // Phase 1: Betting window -> after BETTING_DURATION_MS, deal trump
        abCycleTimerRef.current = setTimeout(() => {
            if (gen !== abGenRef.current) return;
            if (!amIHost(abHostRef.current)) return;
            const current = andarBaharRef.current;
            if (!current || current.phase !== 'betting') return;

            const withTrump = ab.dealTrump(current);
            setAndarBaharGame(withTrump);
            socket.sendRoomMessage(roomId, ab.serializeAndarBaharAction({ type: 'ab_state', state: ab.serializeGame(withTrump) }));
            addActivityLog(`Andar Bahar: trump card ${withTrump.trumpCard?.value}${withTrump.trumpCard?.suit}`);

            // Phase 2: Deal cards 1-by-1
            abDealTimerRef.current = setInterval(() => {
                if (gen !== abGenRef.current) { clearInterval(abDealTimerRef.current); return; }
                const cur = andarBaharRef.current;
                if (!cur || !amIHost(abHostRef.current)) { clearInterval(abDealTimerRef.current); return; }
                if (cur.phase !== 'dealing') { clearInterval(abDealTimerRef.current); return; }

                const next = ab.dealNext(cur);
                setAndarBaharGame(next);
                socket.sendRoomMessage(roomId, ab.serializeAndarBaharAction({ type: 'ab_state', state: ab.serializeGame(next) }));

                if (next.phase === 'ended') {
                    clearInterval(abDealTimerRef.current);

                    if (amIHost(abHostRef.current) && next.payouts) {
                        updateBankLedger('andarbahar', next.payouts);
                    }

                    // Apply wallet changes for host via Global Ledger Service
                    const myId = myIdRef.current;
                    const myNet = next.payouts?.[myId];
                    if (myNet !== undefined && walletRef.current) {
                        const event = new ab.AndarBaharEngine(next).calculateResults(next);
                        resolvePayoutEvent(event, myId, walletRef.current);
                    }
                    addActivityLog(`Andar Bahar: ${next.result?.toUpperCase()} wins! Trump: ${next.trumpCard?.value}${next.trumpCard?.suit}`);

                    // Phase 3: Show results for RESULTS_DISPLAY_MS, then new round
                    abCycleTimerRef.current = setTimeout(() => {
                        if (gen !== abGenRef.current) return;
                        if (!amIHost(abHostRef.current)) return;
                        const reset = ab.newRound(andarBaharRef.current || next);
                        setAndarBaharGame(reset);
                        socket.sendRoomMessage(roomId, ab.serializeAndarBaharAction({ type: 'ab_state', state: ab.serializeGame(reset) }));
                        // Restart cycle via ref to avoid stale closure
                        startAbCycleRef.current?.(reset);
                    }, ab.RESULTS_DISPLAY_MS);
                }
            }, ab.DEAL_INTERVAL_MS);

        }, bettingMs);
    }, [addActivityLog, amIHost, updateBankLedger, resolvePayoutEvent]);

    // Keep ref in sync so recursive calls always use latest closure
    useEffect(() => { startAbCycleRef.current = startAbCycle; }, [startAbCycle]);

    // ── Andar Bahar message handler ──────────────────────────
    const handleAndarBaharAction = useCallback((msg, action) => {
        const myId = myIdRef.current;
        switch (action.type) {
            case 'ab_start': {
                if (action.host === myId) return;
                addMsg('\u{1F0CF}', `${action.host_nick} started Andar Bahar!`, 'game_invite', {
                    gameType: 'andarbahar',
                    inviteData: { room_id: action.room_id, host: action.host, host_nick: action.host_nick },
                    roomId: msg.room_id,
                });
                break;
            }
            case 'ab_state': {
                // Skip own state echo (host already has authoritative state)
                if (msg.peer_id === myIdRef.current) break;
                const gameState = ab.deserializeGame(action.state);
                if (gameState) {
                    if (!hasJoinedAb.current && abHostRef.current !== myIdRef.current) break;
                    setAndarBaharGame(prev => {
                        if (gameState.phase === 'ended' && prev?.phase !== 'ended' && !amIHost(abHostRef.current)) {
                            const myNet = gameState.payouts?.[myId];
                            if (myNet !== undefined && walletRef.current) {
                                const event = new ab.AndarBaharEngine(gameState).calculateResults(gameState);
                                setTimeout(() => resolvePayoutEvent(event, myId, walletRef.current), 0);
                            }
                        }
                        return gameState;
                    });
                }
                break;
            }
            case 'ab_bet': {
                // Host processes remote player's bet
                if (!amIHost(abHostRef.current)) break;
                setAndarBaharGame(prev => {
                    if (!prev || prev.phase !== 'betting') return prev;
                    const updated = ab.placeBet(prev, action.peer_id, action.nick, action.side, action.amount);
                    setTimeout(() => {
                        socket.sendRoomMessage(updated.roomId, ab.serializeAndarBaharAction({ type: 'ab_state', state: ab.serializeGame(updated) }));
                    }, 0);
                    return updated;
                });
                break;
            }
            case 'ab_clearBets': {
                if (!amIHost(abHostRef.current)) break;
                setAndarBaharGame(prev => {
                    if (!prev) return prev;
                    const updated = ab.clearBets(prev, action.peer_id);
                    setTimeout(() => {
                        socket.sendRoomMessage(updated.roomId, ab.serializeAndarBaharAction({ type: 'ab_state', state: ab.serializeGame(updated) }));
                    }, 0);
                    return updated;
                });
                break;
            }
        }
    }, [addMsg, amIHost]);

    // ── Andar Bahar start ───────────────────────────────────
    const startAndarBahar = useCallback((roomId) => {
        const myId = myIdRef.current;
        const myNick = nickRef.current;
        const newGame = ab.createGame(roomId);
        setAndarBaharGame(newGame);
        abHostRef.current = myId;
        hasJoinedAb.current = true; // host auto-joined
        addMsg('\u2605', `\u{1F0CF} Andar Bahar started! Betting open for 30s.`, 'system');
        socket.sendRoomMessage(roomId, ab.serializeAndarBaharAction({ type: 'ab_start', room_id: roomId, host: myId, host_nick: myNick }));
        socket.sendRoomMessage(roomId, ab.serializeAndarBaharAction({ type: 'ab_state', state: ab.serializeGame(newGame) }));
        // Start the auto-cycle immediately
        startAbCycle(newGame);
    }, [addMsg, startAbCycle]);

    // ── Andar Bahar local action handler ───────────────────────
    const handleAbAction = useCallback((action) => {
        if (!andarBaharRef.current) return;
        const andarBaharGame = andarBaharRef.current;
        const myId = myIdRef.current;
        const myNick = nickRef.current;

        // Non-host: proxy bet/clearBets to host (host has the deck)
        if (!amIHost(abHostRef.current)) {
            if (action.type === 'bet') {
                const w = walletRef.current;
                if (!w || !wallet.canAfford(w, action.amount)) { addMsg('\u2605', `\u26A0 Insufficient chips.`, 'system'); return; }
                updateWallet(wallet.debit(w, action.amount, 'Andar Bahar bet'));
                socket.sendRoomMessage(andarBaharGame.roomId, ab.serializeAndarBaharAction({
                    type: 'ab_bet', peer_id: myId, nick: myNick, side: action.side, amount: action.amount,
                }));
            } else if (action.type === 'clearBets') {
                const myBets = (andarBaharGame.bets || []).filter(b => b.peer_id === myId);
                const refund = myBets.reduce((s, b) => s + (b.amount || 0), 0);
                if (refund > 0 && walletRef.current) {
                    updateWallet(wallet.credit(walletRef.current, refund, 'Andar Bahar bets cleared'));
                }
                socket.sendRoomMessage(andarBaharGame.roomId, ab.serializeAndarBaharAction({
                    type: 'ab_clearBets', peer_id: myId,
                }));
            }
            return;
        }

        // Host processes locally
        if (action.type === 'clearBets') {
            const myBets = (andarBaharGame.bets || []).filter(b => b.peer_id === myId);
            const refund = myBets.reduce((s, b) => s + (b.amount || 0), 0);
            if (refund > 0 && walletRef.current) {
                updateWallet(wallet.credit(walletRef.current, refund, 'Andar Bahar bets cleared'));
            }
            const newGame = ab.clearBets(andarBaharGame, myId);
            setAndarBaharGame(newGame);
            socket.sendRoomMessage(newGame.roomId, ab.serializeAndarBaharAction({ type: 'ab_state', state: ab.serializeGame(newGame) }));
            return;
        }

        if (action.type !== 'bet') return;

        const w = walletRef.current;
        if (!w || !wallet.canAfford(w, action.amount)) { addMsg('\u2605', `\u26A0 Insufficient chips.`, 'system'); return; }
        updateWallet(wallet.debit(w, action.amount, 'Andar Bahar bet'));
        const newGame = ab.placeBet(andarBaharGame, myId, myNick, action.side, action.amount);
        setAndarBaharGame(newGame);
        socket.sendRoomMessage(newGame.roomId, ab.serializeAndarBaharAction({ type: 'ab_state', state: ab.serializeGame(newGame) }));
    }, [amIHost, addMsg, updateWallet]);

    // Cleanup timers on unmount
    useEffect(() => {
        return () => {
            if (abDealTimerRef.current) clearInterval(abDealTimerRef.current);
            if (abCycleTimerRef.current) clearTimeout(abCycleTimerRef.current);
            abGenRef.current++;
        };
    }, []);

    return {
        andarBaharGame, setAndarBaharGame,
        andarBaharRef, abHostRef, hasJoinedAb,
        abDealTimerRef, abCycleTimerRef, abGenRef,
        startAbCycle, handleAndarBaharAction,
        startAndarBahar, handleAbAction,
    };
}
