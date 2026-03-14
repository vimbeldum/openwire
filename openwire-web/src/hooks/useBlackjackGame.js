import { useState, useRef, useEffect, useCallback } from 'react';
import * as bj from '../lib/blackjack';
import * as wallet from '../lib/wallet';
import * as socket from '../lib/socket';
import * as ledger from '../lib/core/ledger.js';

/**
 * Custom hook encapsulating all Blackjack game state, refs, timers, and handlers.
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
export default function useBlackjackGame(deps) {
    const {
        myIdRef, nickRef, walletRef,
        addMsg, updateWallet, amIHost,
        updateBankLedger, resolvePayoutEvent, addActivityLog,
    } = deps;

    const [blackjackGame, setBlackjackGame] = useState(null);
    const blackjackRef = useRef(null);
    const bjHostRef = useRef(null);
    const hasJoinedBj = useRef(false);
    const bjDealerTimerRef = useRef(null);
    const bjTurnTimerRef = useRef(null);
    const bjDealerTransitionTimerRef = useRef(null);

    useEffect(() => { blackjackRef.current = blackjackGame; }, [blackjackGame]);

    // Shared helper: after a BJ game update, check for dealer phase transition
    const bjCheckDealerTransition = useCallback((prevPhase, newGame) => {
        if (newGame.phase === 'dealer' && prevPhase !== 'dealer') {
            if (bjDealerTransitionTimerRef.current) clearTimeout(bjDealerTransitionTimerRef.current);
            bjDealerTransitionTimerRef.current = setTimeout(() => {
                bjDealerTransitionTimerRef.current = null;
                const settled = bj.runDealerTurn(newGame);
                const payoutEvent = new bj.BlackjackEngine(settled).calculateResults(settled);
                settled.payouts = payoutEvent.totals || {};
                setBlackjackGame(settled);
                if (amIHost(bjHostRef.current) && settled.payouts) {
                    updateBankLedger('blackjack', settled.payouts);
                }
                const hostMyId = myIdRef.current;
                const hostMyNet = settled.payouts?.[hostMyId];
                if (hostMyNet !== undefined && walletRef.current) {
                    resolvePayoutEvent(payoutEvent, hostMyId, walletRef.current);
                }
                socket.sendRoomMessage(settled.roomId, bj.serializeBlackjackAction({ type: 'bj_state', state: bj.serializeGame(settled) }));
            }, 1000);
        }
    }, [amIHost, updateBankLedger, resolvePayoutEvent]);

    // ── Per-player turn timeout (host-only) ────────────────
    const startTurnTimer = useCallback((gameVal) => {
        if (bjTurnTimerRef.current) clearTimeout(bjTurnTimerRef.current);
        if (!gameVal || gameVal.phase !== 'playing' || gameVal.currentPlayerIndex < 0) return;
        if (!gameVal.turnDeadline) return;

        const msLeft = Math.max(0, gameVal.turnDeadline - Date.now());

        bjTurnTimerRef.current = setTimeout(() => {
            const currentGame = blackjackRef.current;
            if (!currentGame || !amIHost(bjHostRef.current) || currentGame.phase !== 'playing') return;
            const activePlayer = currentGame.players[currentGame.currentPlayerIndex];
            if (!activePlayer) return;

            // Auto-stand for the timed-out player
            const prevPhase = currentGame.phase;
            const updated = bj.stand(currentGame, activePlayer.peer_id);
            setBlackjackGame(updated);
            socket.sendRoomMessage(updated.roomId, bj.serializeBlackjackAction({ type: 'bj_state', state: bj.serializeGame(updated) }));
            bjCheckDealerTransition(prevPhase, updated);

            // If still playing with a new active player, restart timer
            if (updated.phase === 'playing' && updated.currentPlayerIndex >= 0) {
                startTurnTimer(updated);
            }
        }, msLeft);
    }, [amIHost, bjCheckDealerTransition]);

    // ── Blackjack Auto-deal timer ──────────────────────────
    const startBlackjackTimer = useCallback((gameVal) => {
        if (!gameVal || gameVal.phase !== 'betting') return;
        if (bjDealerTimerRef.current) clearTimeout(bjDealerTimerRef.current);

        const msLeft = Math.max(0, gameVal.nextDealAt - Date.now());

        bjDealerTimerRef.current = setTimeout(() => {
            const currentGame = blackjackRef.current;
            const hostId = bjHostRef.current;
            if (!currentGame || !amIHost(hostId) || currentGame.phase !== 'betting') return;

            // Auto-deal
            const dealtGame = bj.dealInitialCards(currentGame);
            setBlackjackGame(dealtGame);
            socket.sendRoomMessage(currentGame.roomId, bj.serializeBlackjackAction({ type: 'bj_state', state: bj.serializeGame(dealtGame) }));
            // If all players got blackjack, game goes straight to dealer phase — run dealer turn
            bjCheckDealerTransition('betting', dealtGame);
            // Start per-player turn timer if in playing phase
            if (dealtGame.phase === 'playing') startTurnTimer(dealtGame);
        }, msLeft);
    }, [amIHost, bjCheckDealerTransition, startTurnTimer]);

    // ── Blackjack message handler ────────────────────────────
    const handleBlackjackAction = useCallback((msg, action) => {
        const myId = myIdRef.current;
        const myNick = nickRef.current;
        switch (action.type) {
            case 'bj_start': {
                if (action.host === myId) return;
                addMsg('\u{1F0CF}', `${action.host_nick} started a Blackjack game!`, 'game_invite', {
                    gameType: 'blackjack',
                    inviteData: { room_id: action.room_id, host: action.host, host_nick: action.host_nick },
                    roomId: msg.room_id,
                });
                break;
            }
            case 'bj_state': {
                // Skip own state echo (host already has authoritative state)
                if (msg.peer_id === myIdRef.current) break;
                const gameState = bj.deserializeGame(action.state);
                if (gameState) {
                    if (!hasJoinedBj.current && bjHostRef.current !== myIdRef.current) break;
                    setBlackjackGame(prev => {
                        // Apply wallet changes when game ends
                        // Only process payouts for non-host peers (host already did it in timer callback)
                        if (gameState.phase === 'ended' && prev?.phase !== 'ended' && !amIHost(bjHostRef.current)) {
                            const event = new bj.BlackjackEngine(gameState).calculateResults(gameState);
                            const myNet = event.totals?.[myId];
                            if (myNet !== undefined && walletRef.current) {
                                setTimeout(() => resolvePayoutEvent(event, myId, walletRef.current), 0);
                                const resultText = myNet > 0 ? `won ${myNet}` : myNet < 0 ? `lost ${-myNet}` : 'pushed';
                                addActivityLog(`Blackjack: ${myNick} ${resultText} chips`);
                            }
                        }

                        // Restart timer loop on guest if new round
                        if (gameState.phase === 'betting' && (!prev || prev.phase !== 'betting')) {
                            // Only needed if you want UI to show a synced timer
                        }

                        return gameState;
                    });
                }
                break;
            }
            case 'bj_join': {
                // A peer wants to join — host must add them to game and broadcast
                addMsg('\u2605', `\u{1F0CF} ${action.nick} joined Blackjack!`, 'system');
                // If I am the host, add the player and broadcast the new state
                setBlackjackGame(prev => {
                    if (!prev) return prev;
                    // Check if already in game
                    if (prev.players.some(p => p.peer_id === action.peer_id)) return prev;
                    const updated = bj.addPlayer(prev, action.peer_id, action.nick);
                    // Broadcast new state (async so we don't call socket inside setState directly)
                    setTimeout(() => {
                        if (bjHostRef.current === myIdRef.current) {
                            socket.sendRoomMessage(updated.roomId, bj.serializeBlackjackAction({ type: 'bj_state', state: bj.serializeGame(updated) }));
                        }
                    }, 0);
                    return updated;
                });
                break;
            }
            case 'bj_player_action': {
                // Non-host player sent an action — only the host processes it
                if (!amIHost(bjHostRef.current)) break;
                setBlackjackGame(prev => {
                    if (!prev) return prev;
                    let updated = prev;
                    if (action.action === 'bet') {
                        updated = bj.placeBet(prev, action.peer_id, action.amount);
                    } else if (action.action === 'hit') {
                        updated = bj.hit(prev, action.peer_id);
                    } else if (action.action === 'stand') {
                        updated = bj.stand(prev, action.peer_id);
                    } else if (action.action === 'split') {
                        updated = bj.split(prev, action.peer_id);
                    } else if (action.action === 'insurance') {
                        updated = bj.takeInsurance(prev, action.peer_id);
                    } else if (action.action === 'doubleDown') {
                        updated = bj.doubleDown(prev, action.peer_id);
                    } else return prev;
                    const prevPhase = prev.phase;
                    setTimeout(() => {
                        socket.sendRoomMessage(updated.roomId, bj.serializeBlackjackAction({ type: 'bj_state', state: bj.serializeGame(updated) }));
                        bjCheckDealerTransition(prevPhase, updated);
                        if (updated.phase === 'playing' && updated.currentPlayerIndex >= 0) {
                            startTurnTimer(updated);
                        }
                    }, 0);
                    return updated;
                });
                break;
            }
        }
    }, [addMsg, addActivityLog, amIHost, bjCheckDealerTransition, resolvePayoutEvent, startTurnTimer]);

    // ── Blackjack start ───────────────────────────────────
    const startBlackjack = useCallback((roomId) => {
        const myId = myIdRef.current;
        const myNick = nickRef.current;
        const newGame = bj.createGame(roomId, myId);
        newGame.players = [{ peer_id: myId, nick: myNick, hand: [], status: 'waiting', bet: 0 }];
        setBlackjackGame(newGame);
        bjHostRef.current = myId;
        hasJoinedBj.current = true; // host auto-joined
        addMsg('\u2605', `\u{1F0CF} Blackjack started! Dealing in 20s.`, 'system');
        socket.sendRoomMessage(roomId, bj.serializeBlackjackAction({ type: 'bj_start', room_id: roomId, host: myId, host_nick: myNick }));
        socket.sendRoomMessage(roomId, bj.serializeBlackjackAction({ type: 'bj_state', state: bj.serializeGame(newGame) }));
        startBlackjackTimer(newGame);
    }, [addMsg, startBlackjackTimer]);

    // ── Blackjack local action handler ───────────────────────
    const handleBjAction = useCallback((action) => {
        if (!blackjackRef.current) return;
        const blackjackGame = blackjackRef.current;
        const myId = myIdRef.current;
        const myNick = nickRef.current;

        // Non-host players: proxy bet/hit/stand to host (they don't have the deck)
        if (!amIHost(bjHostRef.current)) {
            if (action.type === 'join') {
                socket.sendRoomMessage(blackjackGame.roomId, bj.serializeBlackjackAction({ type: 'bj_join', peer_id: myId, nick: myNick }));
                return;
            }
            if (action.type === 'bet') {
                const w = walletRef.current;
                if (!w || !wallet.canAfford(w, action.amount)) return;
                // Upfront debit — prevents double-spending across concurrent games
                updateWallet(wallet.debit(w, action.amount, 'Blackjack bet'));
                socket.sendRoomMessage(blackjackGame.roomId, bj.serializeBlackjackAction({
                    type: 'bj_player_action', peer_id: myId, nick: myNick, action: 'bet', amount: action.amount,
                }));
                return;
            }
            if (['hit', 'stand', 'split', 'insurance', 'doubleDown'].includes(action.type)) {
                const myBet = blackjackGame.players.find(p => p.peer_id === myId)?.bet || 0;
                // For split/double, debit additional chips equal to original bet
                if (action.type === 'split' || action.type === 'doubleDown') {
                    const w = walletRef.current;
                    if (!w || !wallet.canAfford(w, myBet)) { addMsg('\u2605', `\u26A0 Insufficient chips.`, 'system'); return; }
                    updateWallet(wallet.debit(w, myBet, `Blackjack ${action.type}`));
                }
                // Insurance costs half the original bet
                if (action.type === 'insurance') {
                    const insCost = Math.floor(myBet / 2);
                    const w = walletRef.current;
                    if (!w || !wallet.canAfford(w, insCost)) { addMsg('\u2605', `\u26A0 Insufficient chips.`, 'system'); return; }
                    updateWallet(wallet.debit(w, insCost, 'Blackjack insurance'));
                }
                socket.sendRoomMessage(blackjackGame.roomId, bj.serializeBlackjackAction({
                    type: 'bj_player_action', peer_id: myId, action: action.type,
                }));
                return;
            }
            return; // non-host ignores deal/dealerPlay/newRound
        }

        // Host processes locally (has full deck)
        let newGame = blackjackGame;

        switch (action.type) {
            case 'join':
                newGame = bj.addPlayer(blackjackGame, myId, myNick);
                socket.sendRoomMessage(blackjackGame.roomId, bj.serializeBlackjackAction({ type: 'bj_join', peer_id: myId, nick: myNick }));
                break;
            case 'bet': {
                const w = walletRef.current;
                if (!w || !wallet.canAfford(w, action.amount)) break;
                // Upfront debit — prevents double-spending across concurrent games
                updateWallet(wallet.debit(w, action.amount, 'Blackjack bet'));
                newGame = bj.placeBet(blackjackGame, myId, action.amount);
                break;
            }
            case 'deal': newGame = bj.dealInitialCards(blackjackGame); break;
            case 'hit': newGame = bj.hit(blackjackGame, myId); break;
            case 'stand': newGame = bj.stand(blackjackGame, myId); break;
            case 'split': {
                const splitCost = blackjackGame.players.find(p => p.peer_id === myId)?.bet || 0;
                const w = walletRef.current;
                if (!w || !wallet.canAfford(w, splitCost)) { addMsg('\u2605', '\u26A0 Insufficient chips for split.', 'system'); return; }
                updateWallet(wallet.debit(w, splitCost, 'Blackjack split'));
                newGame = bj.split(blackjackGame, myId);
                break;
            }
            case 'insurance': {
                const insCost = Math.floor((blackjackGame.players.find(p => p.peer_id === myId)?.bet || 0) / 2);
                const w = walletRef.current;
                if (!w || !wallet.canAfford(w, insCost)) { addMsg('\u2605', '\u26A0 Insufficient chips for insurance.', 'system'); return; }
                updateWallet(wallet.debit(w, insCost, 'Blackjack insurance'));
                newGame = bj.takeInsurance(blackjackGame, myId);
                break;
            }
            case 'doubleDown': {
                const ddCost = blackjackGame.players.find(p => p.peer_id === myId)?.bet || 0;
                const w = walletRef.current;
                if (!w || !wallet.canAfford(w, ddCost)) { addMsg('\u2605', '\u26A0 Insufficient chips for double down.', 'system'); return; }
                updateWallet(wallet.debit(w, ddCost, 'Blackjack double down'));
                newGame = bj.doubleDown(blackjackGame, myId);
                break;
            }
            case 'dealerPlay': newGame = bj.runDealerTurn(blackjackGame); break;
            case 'newRound':
                newGame = bj.newRound(blackjackGame);
                startBlackjackTimer(newGame);
                break;
        }

        setBlackjackGame(newGame);
        socket.sendRoomMessage(newGame.roomId, bj.serializeBlackjackAction({ type: 'bj_state', state: bj.serializeGame(newGame) }));
        bjCheckDealerTransition(blackjackGame.phase, newGame);
        // Restart turn timer if still in playing phase
        if (newGame.phase === 'playing' && newGame.currentPlayerIndex >= 0) {
            startTurnTimer(newGame);
        }
    }, [amIHost, addMsg, updateWallet, startBlackjackTimer, bjCheckDealerTransition, startTurnTimer]);

    // Cleanup timers on unmount
    useEffect(() => {
        return () => {
            if (bjDealerTimerRef.current) clearTimeout(bjDealerTimerRef.current);
            if (bjTurnTimerRef.current) clearTimeout(bjTurnTimerRef.current);
            if (bjDealerTransitionTimerRef.current) clearTimeout(bjDealerTransitionTimerRef.current);
        };
    }, []);

    return {
        blackjackGame, setBlackjackGame,
        blackjackRef, bjHostRef, hasJoinedBj, bjDealerTimerRef, bjTurnTimerRef, bjDealerTransitionTimerRef,
        startBlackjackTimer, startTurnTimer, bjCheckDealerTransition,
        handleBlackjackAction, startBlackjack, handleBjAction,
    };
}
