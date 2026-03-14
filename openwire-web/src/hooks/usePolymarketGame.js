import { useState, useRef, useEffect, useCallback } from 'react';
import * as pm from '../lib/polymarket';
import * as wallet from '../lib/wallet';
import * as socket from '../lib/socket';

/**
 * Custom hook encapsulating all Polymarket/Predictions game state, refs, and handlers.
 *
 * @param {Object} deps - shared dependencies from ChatRoom
 * @param {React.MutableRefObject} deps.myIdRef
 * @param {React.MutableRefObject} deps.nickRef
 * @param {React.MutableRefObject} deps.walletRef
 * @param {Function} deps.addMsg
 * @param {Function} deps.updateWallet
 * @param {Function} deps.amIHost
 * @param {Function} deps.resolvePayoutEvent
 */
export default function usePolymarketGame(deps) {
    const {
        myIdRef, nickRef, walletRef,
        addMsg, updateWallet, amIHost,
        resolvePayoutEvent,
    } = deps;

    const [polymarketGame, setPolymarketGame] = useState(null);
    const polymarketRef = useRef(null);
    const pmHostRef = useRef(null);
    const hasJoinedPm = useRef(false);

    useEffect(() => { polymarketRef.current = polymarketGame; }, [polymarketGame]);

    // ── Polymarket message handler ────────────────────────────
    const handlePolymarketAction = useCallback((msg, action) => {
        const myId = myIdRef.current;
        switch (action.type) {
            case 'pm_start': {
                if (action.host === myId) return;
                addMsg('\u{1F4CA}', `${action.host_nick} started Predictions!`, 'game_invite', {
                    gameType: 'polymarket',
                    inviteData: { room_id: action.room_id, host: action.host, host_nick: action.host_nick },
                    roomId: msg.room_id,
                });
                break;
            }
            case 'pm_state': {
                // Skip own state echo
                if (msg.peer_id === myIdRef.current) break;
                const gameState = pm.deserializeGame(action.state);
                if (gameState) {
                    if (!hasJoinedPm.current && pmHostRef.current !== myIdRef.current) break;
                    if (msg.from && pmHostRef.current && msg.from !== pmHostRef.current) break;
                    setPolymarketGame(prev => {
                        if (gameState.phase === 'resolved' && prev?.phase !== 'resolved' && !amIHost(pmHostRef.current)) {
                            const myNet = gameState.payouts?.[myId];
                            if (myNet !== undefined && walletRef.current) {
                                const event = new pm.PolymarketEngine(gameState).calculateResults(gameState);
                                setTimeout(() => resolvePayoutEvent(event, myId, walletRef.current), 0);
                            }
                        }
                        return gameState;
                    });
                }
                break;
            }
            case 'pm_buy': {
                // Host processes buy request from non-host peer
                if (!amIHost(pmHostRef.current)) break;
                setPolymarketGame(prev => {
                    if (!prev || prev.phase !== 'open') return prev;
                    const result = pm.buyShares(prev, action.peer_id, action.nick, action.outcomeIdx, action.shares);
                    if (!result) return prev;
                    const updated = result.game;
                    setTimeout(() => {
                        socket.sendRoomMessage(updated.roomId, pm.serializePolymarketAction({ type: 'pm_state', state: pm.serializeGame(updated) }));
                    }, 0);
                    return updated;
                });
                break;
            }
            case 'pm_sell': {
                if (!amIHost(pmHostRef.current)) break;
                setPolymarketGame(prev => {
                    if (!prev || prev.phase !== 'open') return prev;
                    const result = pm.sellShares(prev, action.peer_id, action.nick, action.outcomeIdx, action.shares);
                    if (!result) return prev;
                    const updated = result.game;
                    setTimeout(() => {
                        socket.sendRoomMessage(updated.roomId, pm.serializePolymarketAction({ type: 'pm_state', state: pm.serializeGame(updated) }));
                    }, 0);
                    return updated;
                });
                break;
            }
        }
    }, [amIHost, addMsg]);

    // ── Polymarket start ───────────────────────────────────
    const startPolymarket = useCallback((roomId) => {
        const myId = myIdRef.current;
        const myNick = nickRef.current;
        const newGame = pm.createPolymarket(roomId);
        setPolymarketGame(newGame);
        pmHostRef.current = myId;
        hasJoinedPm.current = true;
        addMsg('\u{1F4CA}', `Predictions market started! Use the panel to create a question.`, 'system');
        socket.sendRoomMessage(roomId, pm.serializePolymarketAction({ type: 'pm_start', room_id: roomId, host: myId, host_nick: myNick }));
        socket.sendRoomMessage(roomId, pm.serializePolymarketAction({ type: 'pm_state', state: pm.serializeGame(newGame) }));
    }, [addMsg]);

    // ── Polymarket local action handler ───────────────────────
    const handlePmAction = useCallback((action) => {
        if (!polymarketRef.current) return;
        const polymarketGame = polymarketRef.current;
        const myId = myIdRef.current;
        const myNick = nickRef.current;
        const roomId = polymarketGame.roomId;

        switch (action.type) {
            case 'create': {
                if (!amIHost(pmHostRef.current)) return;
                const newGame = pm.createMarket(polymarketGame, action.question, action.outcomes);
                setPolymarketGame(newGame);
                socket.sendRoomMessage(roomId, pm.serializePolymarketAction({ type: 'pm_state', state: pm.serializeGame(newGame) }));
                addMsg('\u{1F4CA}', `Market created: "${action.question}"`, 'system');
                break;
            }
            case 'buy': {
                const w = walletRef.current;
                const costEstimate = action.shares; // rough upper bound
                if (!w || !wallet.canAfford(w, costEstimate)) { addMsg('\u2605', `\u26A0 Insufficient chips.`, 'system'); return; }
                if (amIHost(pmHostRef.current)) {
                    const result = pm.buyShares(polymarketGame, myId, myNick, action.outcomeIdx, action.shares);
                    if (result.cost > 0) {
                        updateWallet(wallet.debit(walletRef.current, result.cost, 'Prediction share buy'));
                        setPolymarketGame(result.game);
                        socket.sendRoomMessage(roomId, pm.serializePolymarketAction({ type: 'pm_state', state: pm.serializeGame(result.game) }));
                    }
                } else {
                    // Non-host: send buy request to host, debit will happen on state sync
                    socket.sendRoomMessage(roomId, pm.serializePolymarketAction({
                        type: 'pm_buy', peer_id: myId, nick: myNick,
                        outcomeIdx: action.outcomeIdx, shares: action.shares,
                    }));
                }
                break;
            }
            case 'sell': {
                if (amIHost(pmHostRef.current)) {
                    const result = pm.sellShares(polymarketGame, myId, myNick, action.outcomeIdx, action.shares);
                    if (result.revenue > 0) {
                        updateWallet(wallet.credit(walletRef.current, result.revenue, 'Prediction share sell'));
                        setPolymarketGame(result.game);
                        socket.sendRoomMessage(roomId, pm.serializePolymarketAction({ type: 'pm_state', state: pm.serializeGame(result.game) }));
                    }
                } else {
                    socket.sendRoomMessage(roomId, pm.serializePolymarketAction({
                        type: 'pm_sell', peer_id: myId, nick: myNick,
                        outcomeIdx: action.outcomeIdx, shares: action.shares,
                    }));
                }
                break;
            }
            case 'lock': {
                if (!amIHost(pmHostRef.current)) return;
                const locked = pm.lockMarket(polymarketGame);
                setPolymarketGame(locked);
                socket.sendRoomMessage(roomId, pm.serializePolymarketAction({ type: 'pm_state', state: pm.serializeGame(locked) }));
                addMsg('\u{1F4CA}', `Market locked \u2014 no more trading.`, 'system');
                break;
            }
            case 'resolve': {
                if (!amIHost(pmHostRef.current)) return;
                const resolved = pm.resolveMarket(polymarketGame, action.winnerIdx);
                setPolymarketGame(resolved);
                socket.sendRoomMessage(roomId, pm.serializePolymarketAction({ type: 'pm_state', state: pm.serializeGame(resolved) }));
                // Process payouts for host
                const engine = new pm.PolymarketEngine(resolved);
                const event = engine.calculateResults(resolved);
                resolvePayoutEvent(event, myId, walletRef.current);
                addMsg('\u{1F4CA}', `Market resolved: ${resolved.outcomes[action.winnerIdx]} wins!`, 'system');
                break;
            }
            case 'newMarket': {
                if (!amIHost(pmHostRef.current)) return;
                const fresh = pm.newMarket(polymarketGame);
                setPolymarketGame(fresh);
                socket.sendRoomMessage(roomId, pm.serializePolymarketAction({ type: 'pm_state', state: pm.serializeGame(fresh) }));
                break;
            }
        }
    }, [amIHost, addMsg, updateWallet, resolvePayoutEvent]);

    return {
        polymarketGame, setPolymarketGame,
        polymarketRef, pmHostRef, hasJoinedPm,
        handlePolymarketAction, startPolymarket, handlePmAction,
    };
}
