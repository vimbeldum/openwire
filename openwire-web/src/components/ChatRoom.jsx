import { useState, useEffect, useRef, useCallback } from 'react';
import * as socket from '../lib/socket';
import * as game from '../lib/game';
import * as bj from '../lib/blackjack';
import * as rl from '../lib/roulette';
import * as ab from '../lib/andarbahar';
import * as wallet from '../lib/wallet';
import GameBoard from './GameBoard';
import BlackjackBoard from './BlackjackBoard';
import RouletteBoard from './RouletteBoard';
import AndarBaharBoard from './AndarBaharBoard';
import AdminPortal from './AdminPortal';
import GifPicker from './GifPicker';
import HowToPlay from './HowToPlay';
import PostSessionSummary from './PostSessionSummary';
import AccountHistory from './AccountHistory';
import AgentControlPanel from './AgentControlPanel';
import LiveTicker from './chat/LiveTicker';
import TypingBar from './chat/TypingBar';
import * as ledger from '../lib/core/ledger.js';
import { getRoomAlias } from '../lib/core/identity.js';

function timeStr() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const STORAGE_KEY = 'openwire_messages';
const MAX_STORED_MESSAGES = 500;

function loadMessages() {
    try {
        const stored = sessionStorage.getItem(STORAGE_KEY);
        if (stored) { const parsed = JSON.parse(stored); return parsed.messages || []; }
    } catch { }
    return [];
}

function saveMessages(messages) {
    try {
        const toStore = messages.slice(-MAX_STORED_MESSAGES);
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ messages: toStore, savedAt: Date.now() }));
    } catch { }
}

export default function ChatRoom({ nick: initialNick, isAdmin: initialIsAdmin }) {
    const [messages, setMessages] = useState(() => loadMessages());
    const [input, setInput] = useState('');
    const [peers, setPeers] = useState([]);
    const [rooms, setRooms] = useState([]);
    const [currentRoom, setCurrentRoom] = useState(() => localStorage.getItem('openwire_current_room') || null);
    const [connected, setConnected] = useState(false);
    const [myWallet, setMyWallet] = useState(null);

    // Games
    const [activeGame, setActiveGame] = useState(null);       // Tic-Tac-Toe
    const [blackjackGame, setBlackjackGame] = useState(null);
    const [rouletteGame, setRouletteGame] = useState(null);
    const [andarBaharGame, setAndarBaharGame] = useState(null);

    // How to Play
    const [showHelp, setShowHelp] = useState(false);
    const [showPostSummary, setShowPostSummary] = useState(false);
    const [lastPayoutEvent, setLastPayoutEvent] = useState(null);
    const [showAccountHistory, setShowAccountHistory] = useState(false);
    const handledGameResultRef = useRef(null);
    const [helpGame, setHelpGame] = useState(null);
    const openHelp = (gameType) => { setHelpGame(gameType); setShowHelp(true); };

    // Admin
    const [showAdmin, setShowAdmin] = useState(false);
    const [activityLog, setActivityLog] = useState([]);
    const [bannedIps, setBannedIps] = useState([]);

    // Invites (room-level only; game invites are now in-chat messages)
    const [pendingInvites, setPendingInvites] = useState([]);

    // Pop-Culture Agent Swarm
    const [showAgentPanel, setShowAgentPanel] = useState(false);
    const [agentRunning, setAgentRunning] = useState(false);
    const swarmRef = useRef(null);

    // Bank Ledger (House P&L Tracker)
    const [bankLedger, setBankLedger] = useState(() => {
        try { return JSON.parse(sessionStorage.getItem('bank_ledger')) || { roulette: 0, blackjack: 0, andarbahar: 0 }; }
        catch { return { roulette: 0, blackjack: 0, andarbahar: 0 }; }
    });

    const updateBankLedger = useCallback((gameName, payoutsMap) => {
        if (!payoutsMap) return;
        let houseNet = 0;
        Object.values(payoutsMap).forEach(net => { houseNet -= net; }); // house profit = sum of player losses
        setBankLedger(prev => {
            const next = { ...prev, [gameName]: (prev[gameName] || 0) + houseNet };
            sessionStorage.setItem('bank_ledger', JSON.stringify(next));
            return next;
        });
    }, []);
    // Casino ticker (separate from chat — game events only)
    const [tickerItems, setTickerItems] = useState([]);
    // Typing indicators
    const [typingPeers, setTypingPeers] = useState({});
    const lastTypingSentRef = useRef(0);
    // Whisper mode
    const [whisperTarget, setWhisperTarget] = useState(null);

    const [showGifPicker, setShowGifPicker] = useState(false);
    const [showGameChat, setShowGameChat] = useState(false); // floating chat while game is open
    const messagesEnd = useRef(null);
    const gameChatEnd = useRef(null);

    const myIdRef = useRef(null);
    const nickRef = useRef(initialNick);
    const isAdminRef = useRef(initialIsAdmin);
    const activeGameRef = useRef(null);
    const blackjackRef = useRef(null);
    const rouletteRef = useRef(null);
    const andarBaharRef = useRef(null);
    const roomsRef = useRef([]);
    const peersRef = useRef([]);
    const currentRoomRef = useRef(null);
    const walletRef = useRef(null);

    // Host tracking per game type per room
    const rouletteHostRef = useRef(null);   // peer_id of roulette host
    const abHostRef = useRef(null);         // peer_id of andar bahar host
    const rouletteTimerRef = useRef(null);
    const abDealTimerRef = useRef(null);

    // Consent flags: only open game board if user explicitly accepted
    const hasJoinedBj = useRef(false);
    const hasJoinedRl = useRef(false);
    const hasJoinedAb = useRef(false);

    useEffect(() => { activeGameRef.current = activeGame; }, [activeGame]);
    useEffect(() => { blackjackRef.current = blackjackGame; }, [blackjackGame]);
    useEffect(() => { rouletteRef.current = rouletteGame; }, [rouletteGame]);
    useEffect(() => { andarBaharRef.current = andarBaharGame; }, [andarBaharGame]);
    useEffect(() => { roomsRef.current = rooms; }, [rooms]);
    useEffect(() => { peersRef.current = peers; }, [peers]);
    useEffect(() => { currentRoomRef.current = currentRoom; }, [currentRoom]);
    useEffect(() => { walletRef.current = myWallet; }, [myWallet]);

    useEffect(() => { saveMessages(messages); }, [messages]);

    // ── Typing peer cleanup (stale after 3s) ─────────────────
    useEffect(() => {
        const cleanup = setInterval(() => {
            const cutoff = Date.now() - 3000;
            setTypingPeers(prev => {
                const next = Object.fromEntries(
                    Object.entries(prev).filter(([, v]) => v.ts > cutoff)
                );
                return Object.keys(next).length === Object.keys(prev).length ? prev : next;
            });
        }, 1000);
        return () => clearInterval(cleanup);
    }, []);

    // ── addMsg — declared here so screenshot useEffect below can reference it
    const addMsg = useCallback((sender, content, type = 'chat', extra = {}) => {
        setMessages(prev => [...prev, {
            time: timeStr(), sender, content, type,
            id: Date.now() + Math.random(),
            roomId: currentRoomRef.current || null,
            reactions: {},
            ...extra,
        }]);
        // Feed real chat messages into swarm context (not system/game messages)
        if ((type === 'self' || type === 'peer') && content && !extra?.isAgent) {
            swarmRef.current?.addContext(sender, content);
        }
    }, []);

    // ── Screenshot detection → room alert ────────────────────
    useEffect(() => {
        const detect = (e) => {
            const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');
            const isMacShot = isMac && e.metaKey && e.shiftKey && ['3', '4', '5', '6'].includes(e.key);
            const isWinShot = !isMac && e.key === 'PrintScreen';
            if (isMacShot || isWinShot) {
                const activeRoom = currentRoomRef.current;
                if (activeRoom) {
                    socket.sendRoomMessage(activeRoom, JSON.stringify({
                        type: 'screenshot_alert', nick: nickRef.current,
                    }));
                }
                addMsg('📸', 'You took a screenshot — room has been notified.', 'system');
            }
        };
        window.addEventListener('keydown', detect);
        return () => window.removeEventListener('keydown', detect);
    }, [addMsg]);

    // ── TTT game-over → NonFinancialEvent ledger record ──────
    useEffect(() => {
        if (!activeGame?.result) return;
        if (activeGame.result === handledGameResultRef.current) return;
        handledGameResultRef.current = activeGame.result;

        const myId = myIdRef.current;
        if (!myId) return;
        const isParticipant =
            activeGame.playerX?.peer_id === myId ||
            activeGame.playerO?.peer_id === myId;
        if (!isParticipant) return;

        const event = game.calculateResults(activeGame);
        const deviceId = wallet.getDeviceId();
        ledger.processEvent(walletRef.current, event, myId, deviceId);

        setLastPayoutEvent(event);
        setShowPostSummary(true);
    }, [activeGame]);

    useEffect(() => {
        if (currentRoom) localStorage.setItem('openwire_current_room', currentRoom);
        else localStorage.removeItem('openwire_current_room');
    }, [currentRoom]);

    // ── Wallet init ──────────────────────────────────────────
    useEffect(() => {
        if (initialNick) {
            const w = wallet.loadWallet(initialNick);
            setMyWallet(w);
            walletRef.current = w;
        }
    }, [initialNick]);

    const updateWallet = useCallback((updatedWallet) => {
        setMyWallet(updatedWallet);
        walletRef.current = updatedWallet;
        // Broadcast balance to relay
        if (myIdRef.current) {
            socket.send({ type: 'balance_update', balance: wallet.getTotalBalance(updatedWallet) });
        }
    }, []);

    // ── Agent Swarm bootstrap ─────────────────────────────────
    useEffect(() => {
        let cancelled = false;
        import('../lib/agents/swarm.js').then(({ AgentSwarm }) => {
        if (cancelled) return;
        const swarm = new AgentSwarm({
            onMessage: (characterId, nick, avatar, text) => {
                const activeRoom = currentRoomRef.current;
                // Inject locally as a peer-style message
                addMsg(`${avatar} ${nick}`, text, 'peer', {
                    roomId: activeRoom,
                    isAgent: true,
                    characterId,
                });
                // Broadcast to room so all members see it
                if (activeRoom) {
                    socket.sendRoomMessage(activeRoom, JSON.stringify({
                        type: 'agent_message',
                        characterId,
                        nick: `${avatar} ${nick}`,
                        text,
                    }));
                }
                // Feed back into context
                swarm.addContext(nick, text);
            },
            onError: (msg) => console.warn('[AgentSwarm]', msg),
            onModelLoad: () => setAgentRunning(true),
        });
        swarmRef.current = swarm;
        }); // end dynamic import
        return () => {
            cancelled = true;
            swarmRef.current?.stop();
            swarmRef.current = null;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const addTicker = useCallback((text, gameType = 'casino') => {
        setTickerItems(prev => [...prev.slice(-29), { text, gameType, ts: Date.now() }]);
    }, []);

    const addReaction = useCallback((msgId, emoji, peerId) => {
        setMessages(prev => prev.map(m => {
            if (m.id !== msgId) return m;
            const existing = m.reactions?.[emoji] || [];
            if (existing.includes(peerId)) return m;
            return { ...m, reactions: { ...m.reactions, [emoji]: [...existing, peerId] } };
        }));
    }, []);

    const addActivityLog = useCallback((message) => {
        setActivityLog(prev => [...prev.slice(-99), { time: timeStr(), message }]);
    }, []);

    // ── Emoji reaction handler ────────────────────────────────
    const handleReact = useCallback((msgId, emoji) => {
        const myId = myIdRef.current;
        addReaction(msgId, emoji, myId);
        const activeRoom = currentRoomRef.current;
        if (activeRoom) {
            socket.sendRoomMessage(activeRoom, JSON.stringify({
                type: 'react', msgId, emoji, nick: nickRef.current,
            }));
        }
    }, [addReaction]);

    // ── Payout resolution (financial games) ─────────────────
    const resolvePayoutEvent = useCallback((event, myId, walletObj) => {
        const deviceId = wallet.getDeviceId();
        const { updatedWallet } = ledger.processEvent(walletObj, event, myId, deviceId);
        updateWallet(updatedWallet);
        setLastPayoutEvent(event);
        setShowPostSummary(true);
        // Add to casino ticker (not chat)
        const net = event.totals?.[myId];
        if (net !== undefined && Math.abs(net) >= 50) {
            const sign = net > 0 ? '+' : '';
            addTicker(`${nickRef.current} ${sign}${net} — ${event.resultLabel}`, event.gameType);
        }
        // Broadcast big wins to room ticker
        if (net >= 200 && currentRoomRef.current) {
            socket.sendRoomMessage(currentRoomRef.current, JSON.stringify({
                type: 'casino_ticker',
                text: `${nickRef.current} won ${net} chips! (${event.resultLabel})`,
                gameType: event.gameType,
            }));
        }
        return updatedWallet;
    }, [addTicker, updateWallet]);

    // ── Game invite from chat message ────────────────────────
    const joinGameFromInvite = useCallback((msg) => {
        const { gameType, inviteData } = msg;
        const myId = myIdRef.current;
        const myNick = nickRef.current;
        switch (gameType) {
            case 'blackjack':
                hasJoinedBj.current = true;
                bjHostRef.current = inviteData.host;
                socket.sendRoomMessage(inviteData.room_id, bj.serializeBlackjackAction({
                    type: 'bj_join', peer_id: myId, nick: myNick,
                }));
                addMsg('★', '🃏 Joined Blackjack table!', 'system');
                break;
            case 'roulette':
                hasJoinedRl.current = true;
                rouletteHostRef.current = inviteData.host;
                addMsg('★', '🎰 Joined Roulette room!', 'system');
                break;
            case 'andarbahar':
                hasJoinedAb.current = true;
                abHostRef.current = inviteData.host;
                addMsg('★', '🃏 Joined Andar Bahar table!', 'system');
                break;
            case 'tictactoe': {
                const newTTT = game.createGame(
                    { peer_id: inviteData.challenger, nick: inviteData.challenger_nick },
                    { peer_id: myId, nick: myNick },
                    inviteData.room_id,
                );
                setActiveGame(newTTT);
                socket.sendRoomMessage(inviteData.room_id, game.serializeGameAction({
                    type: 'Accept', accepter: myId, accepter_nick: myNick, room_id: inviteData.room_id,
                }));
                addMsg('★', '🎮 Game accepted!', 'system');
                break;
            }
        }
        setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, inviteUsed: true } : m));
    }, [addMsg]);

    const dismissInvite = useCallback((msgId) => {
        setMessages(prev => prev.map(m => m.id === msgId ? { ...m, inviteUsed: true } : m));
    }, []);

    // ── Custom P2P action handler ─────────────────────────────
    const handleCustomAction = useCallback((msg, action) => {
        const myId = myIdRef.current;
        switch (action.type) {
            case 'typing':
                setTypingPeers(prev => ({
                    ...prev, [msg.peer_id]: { nick: action.nick, ts: Date.now() },
                }));
                break;
            case 'react':
                addReaction(action.msgId, action.emoji, msg.peer_id);
                break;
            case 'tip':
                if (action.to === myId && walletRef.current) {
                    const updated = wallet.credit(walletRef.current, action.amount, `Tip from ${action.from_nick}`);
                    updateWallet(updated);
                    addMsg('💸', `${action.from_nick} sent you ${action.amount} chips!`, 'system');
                }
                break;
            case 'screenshot_alert':
                addMsg('📸', `${action.nick} took a screenshot!`, 'system');
                break;
            case 'casino_ticker':
                addTicker(action.text, action.gameType);
                break;
            case 'whisper':
                if (action.to === myId || msg.peer_id === myId) {
                    addMsg(`🤫 ${action.from_nick}`, action.content, 'whisper', {
                        to: action.to, to_nick: action.to_nick, peer_id: msg.peer_id,
                        roomId: msg.room_id,
                    });
                }
                break;
            case 'agent_message':
                // Only show if it came from another peer (not ourself — we already showed it locally)
                if (msg.peer_id !== myIdRef.current) {
                    addMsg(action.nick, action.text, 'peer', {
                        roomId: msg.room_id, isAgent: true, characterId: action.characterId,
                    });
                    swarmRef.current?.addContext(action.nick, action.text);
                }
                break;
        }
    }, [addMsg, addReaction, addTicker, updateWallet]);

    // ── P2P host election ────────────────────────────────────
    const amIHost = useCallback((hostPeerId) => {
        return myIdRef.current && myIdRef.current === hostPeerId;
    }, []);

    const electNewHostFromPeers = useCallback((peerIds) => {
        // Deterministic: return the lowest peer_id alphabetically
        const sorted = [...peerIds].filter(Boolean).sort();
        return sorted[0] || null;
    }, []);

    // ── Roulette auto-spin ───────────────────────────────────
    const startRouletteTimer = useCallback(() => {
        if (rouletteTimerRef.current) clearInterval(rouletteTimerRef.current);

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
            setTimeout(() => {
                const resultsGame = rl.finishSpin(rouletteRef.current || spun);
                setRouletteGame(resultsGame);

                // Apply winnings via Global Ledger Service
                const myId = myIdRef.current;
                const myNet = spun.payouts?.[myId];

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
                setTimeout(() => {
                    const reset = rl.newRound(rouletteRef.current || resultsGame);
                    setRouletteGame(reset);
                    if (amIHost(rouletteHostRef.current)) {
                        socket.sendRoomMessage(roomId, rl.serializeRouletteAction({ type: 'rl_state', state: rl.serializeGame(reset) }));
                    }
                }, rl.RESULTS_DISPLAY_MS);

            }, rl.SPIN_PHASE_MS);

        }, rl.SPIN_INTERVAL_MS);
    }, [addActivityLog, amIHost, updateWallet]);

    // ── Blackjack Auto-deal timer ──────────────────────────
    const bjDealerTimerRef = useRef(null);

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
        }, msLeft);
    }, [amIHost]);

    useEffect(() => {
        return () => {
            if (rouletteTimerRef.current) clearInterval(rouletteTimerRef.current);
            if (abDealTimerRef.current) clearInterval(abDealTimerRef.current);
            if (abCycleTimerRef.current) clearTimeout(abCycleTimerRef.current);
            if (bjDealerTimerRef.current) clearTimeout(bjDealerTimerRef.current);
        };
    }, []);

    // ── Andar Bahar auto-cycle (host-driven) ─────────────────
    const abCycleTimerRef = useRef(null);

    const startAbCycle = useCallback((initialGame) => {
        // Clear any existing timers
        if (abDealTimerRef.current) clearInterval(abDealTimerRef.current);
        if (abCycleTimerRef.current) clearTimeout(abCycleTimerRef.current);

        const roomId = initialGame.roomId;
        const bettingMs = ab.BETTING_DURATION_MS;

        // Phase 1: Betting window → after BETTING_DURATION_MS, deal trump
        abCycleTimerRef.current = setTimeout(() => {
            if (!amIHost(abHostRef.current)) return;
            const current = andarBaharRef.current;
            if (!current || current.phase !== 'betting') return;

            const withTrump = ab.dealTrump(current);
            setAndarBaharGame(withTrump);
            socket.sendRoomMessage(roomId, ab.serializeAndarBaharAction({ type: 'ab_state', state: ab.serializeGame(withTrump) }));
            addActivityLog(`Andar Bahar: trump card ${withTrump.trumpCard?.value}${withTrump.trumpCard?.suit}`);

            // Phase 2: Deal cards 1-by-1
            abDealTimerRef.current = setInterval(() => {
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
                        if (!amIHost(abHostRef.current)) return;
                        const reset = ab.newRound(andarBaharRef.current || next);
                        setAndarBaharGame(reset);
                        socket.sendRoomMessage(roomId, ab.serializeAndarBaharAction({ type: 'ab_state', state: ab.serializeGame(reset) }));
                        // Restart cycle
                        startAbCycle(reset);
                    }, ab.RESULTS_DISPLAY_MS);
                }
            }, ab.DEAL_INTERVAL_MS);

        }, bettingMs);
    }, [addActivityLog, amIHost, updateWallet]);

    // ── Tic-Tac-Toe handler ──────────────────────────────────
    const handleGameAction = useCallback((msg, action) => {
        const myId = myIdRef.current;
        const myNick = nickRef.current;
        switch (action.type) {
            case 'Challenge': {
                if (action.challenger === myId) return;
                addMsg('🎮', `${action.challenger_nick} challenged you to Tic-Tac-Toe!`, 'game_invite', {
                    gameType: 'tictactoe',
                    inviteData: {
                        challenger: action.challenger,
                        challenger_nick: action.challenger_nick,
                        room_id: action.room_id,
                    },
                    roomId: action.room_id,
                });
                break;
            }
            case 'Accept': {
                if (action.accepter === myId) return;
                setActiveGame(prev => {
                    if (prev && prev.playerX.peer_id === myId) return prev;
                    return game.createGame({ peer_id: myId, nick: myNick }, { peer_id: action.accepter, nick: action.accepter_nick }, msg.room_id);
                });
                addMsg('★', `🎮 ${action.accepter_nick} accepted! Game on!`, 'system');
                break;
            }
            case 'Decline': {
                if (action.decliner === myId) return;
                addMsg('★', `🎮 ${action.decliner_nick} declined the challenge.`, 'system');
                break;
            }
            case 'Move': {
                setActiveGame(prev => {
                    if (!prev) return null;
                    const result = game.makeMove(prev, action.position, action.player);
                    return result.game || prev;
                });
                break;
            }
            case 'Resign': {
                addMsg('★', `🏳️ ${msg.nick} resigned.`, 'system');
                setActiveGame(null);
                break;
            }
        }
    }, [addMsg]);

    // ── Blackjack handler ────────────────────────────────────
    const handleBlackjackAction = useCallback((msg, action) => {
        const myId = myIdRef.current;
        const myNick = nickRef.current;
        switch (action.type) {
            case 'bj_start': {
                if (action.host === myId) return;
                addMsg('🃏', `${action.host_nick} started a Blackjack game!`, 'game_invite', {
                    gameType: 'blackjack',
                    inviteData: { room_id: action.room_id, host: action.host, host_nick: action.host_nick },
                    roomId: msg.room_id,
                });
                break;
            }
            case 'bj_state': {
                const gameState = bj.deserializeGame(action.state);
                if (gameState) {
                    // Only open/update game board if user has explicitly joined (or is host)
                    if (!hasJoinedBj.current && bjHostRef.current !== myIdRef.current) break;
                    setBlackjackGame(prev => {
                        // Apply wallet changes when game ends
                        if (gameState.phase === 'ended' && prev?.phase !== 'ended') {
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
                addMsg('★', `🃏 ${action.nick} joined Blackjack!`, 'system');
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
        }
    }, [addMsg, addActivityLog, updateWallet]);

    // ── Roulette message handler ─────────────────────────────
    const handleRouletteAction = useCallback((msg, action) => {
        const myId = myIdRef.current;
        switch (action.type) {
            case 'rl_start': {
                if (action.host === myId) return;
                addMsg('🎰', `${action.host_nick} started Roulette!`, 'game_invite', {
                    gameType: 'roulette',
                    inviteData: { room_id: action.room_id, host: action.host, host_nick: action.host_nick },
                    roomId: msg.room_id,
                });
                break;
            }
            case 'rl_state': {
                const gameState = rl.deserializeGame(action.state);
                if (gameState) {
                    // Only update route game if user has explicitly joined (or is host)
                    if (!hasJoinedRl.current && rouletteHostRef.current !== myIdRef.current) break;
                    setRouletteGame(prev => {
                        // Apply wallet changes on results
                        if (gameState.phase === 'results' && prev?.phase !== 'results') {
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
        }
    }, [updateWallet]);

    // ── Andar Bahar message handler ──────────────────────────
    const handleAndarBaharAction = useCallback((msg, action) => {
        const myId = myIdRef.current;
        switch (action.type) {
            case 'ab_start': {
                if (action.host === myId) return;
                addMsg('🃏', `${action.host_nick} started Andar Bahar!`, 'game_invite', {
                    gameType: 'andarbahar',
                    inviteData: { room_id: action.room_id, host: action.host, host_nick: action.host_nick },
                    roomId: msg.room_id,
                });
                break;
            }
            case 'ab_state': {
                const gameState = ab.deserializeGame(action.state);
                if (gameState) {
                    // Only update if user has explicitly joined (or is host)
                    if (!hasJoinedAb.current && abHostRef.current !== myIdRef.current) break;
                    setAndarBaharGame(prev => {
                        if (gameState.phase === 'ended' && prev?.phase !== 'ended') {
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
        }
    }, [updateWallet]);

    // ── WebSocket event handler ──────────────────────────────
    useEffect(() => {
        const onEvent = (msg) => {
            switch (msg.type) {
                case 'welcome':
                    myIdRef.current = msg.peer_id;
                    if (msg.nick && msg.nick !== nickRef.current) {
                        nickRef.current = msg.nick;
                        addMsg('★', `Your nickname was taken — assigned "${msg.nick}"`, 'system');
                    }
                    setConnected(true);
                    setPeers(msg.peers || []);
                    setRooms(msg.rooms || []);
                    addMsg('★', `Connected! Your ID: ${msg.peer_id}`, 'system');
                    addMsg('★', 'Type /help for commands.', 'system');

                    // Auto-join previously saved room if exists
                    const savedRoom = localStorage.getItem('openwire_current_room');
                    if (savedRoom) {
                        socket.joinRoom(savedRoom);
                        addMsg('★', `Auto-joined saved room.`, 'system');
                    }

                    // Broadcast wallet balance
                    if (walletRef.current) {
                        setTimeout(() => socket.send({ type: 'balance_update', balance: wallet.getTotalBalance(walletRef.current) }), 500);
                    }
                    // Fetch ban list if admin
                    if (isAdminRef.current) {
                        setTimeout(() => socket.send({ type: 'admin_get_bans' }), 600);
                    }
                    break;
                case 'peers':
                    setPeers(msg.peers || []);
                    if (msg.rooms) setRooms(msg.rooms);
                    break;
                case 'peer_joined':
                    setPeers(prev => [...prev.filter(p => p.peer_id !== msg.peer_id), { peer_id: msg.peer_id, nick: msg.nick }]);
                    addMsg('★', `${msg.nick} joined`, 'system');
                    break;
                case 'peer_left':
                    setPeers(prev => prev.filter(p => p.peer_id !== msg.peer_id));
                    addMsg('★', `${msg.nick} left`, 'system');
                    break;
                case 'message':
                    addMsg(msg.nick, msg.data, 'peer');
                    break;
                case 'room_created':
                    setRooms(prev => {
                        const updated = [...prev, { room_id: msg.room_id, name: msg.name, members: 1 }];
                        roomsRef.current = updated;
                        return updated;
                    });
                    setCurrentRoom(msg.room_id);
                    addMsg('★', `🏠 Room "${msg.name}" created! ID: ${msg.room_id}`, 'system');
                    break;
                case 'room_joined':
                    setRooms(prev => {
                        const updated = [...prev.filter(r => r.room_id !== msg.room_id), { room_id: msg.room_id, name: msg.name }];
                        roomsRef.current = updated;
                        return updated;
                    });
                    setCurrentRoom(msg.room_id);
                    addMsg('★', `🏠 Joined room "${msg.name}"`, 'system');
                    break;
                case 'room_invite':
                    setPendingInvites(prev => {
                        if (prev.some(i => i.room_id === msg.room_id)) return prev;
                        return [...prev, { id: Date.now(), room_id: msg.room_id, room_name: msg.room_name, from: msg.from, from_nick: msg.from_nick }];
                    });
                    break;
                case 'room_message': {
                    const isCurrentRoom = currentRoomRef.current === msg.room_id;
                    const isBjMsg = bj.isBlackjackMessage(msg.data);
                    const isRlMsg = rl.isRouletteMessage(msg.data);
                    const isAbMsg = ab.isAndarBaharMessage(msg.data);
                    const isGameMsg = game.isGameMessage(msg.data);

                    // Try custom JSON action first (typing, react, tip, whisper, ticker, screenshot)
                    let customAction = null;
                    if (!isBjMsg && !isRlMsg && !isAbMsg && !isGameMsg && msg.data?.startsWith('{')) {
                        try {
                            const parsed = JSON.parse(msg.data);
                            const CUSTOM = ['typing', 'react', 'tip', 'screenshot_alert', 'casino_ticker', 'whisper', 'agent_message'];
                            if (CUSTOM.includes(parsed.type)) customAction = parsed;
                        } catch { /* not JSON */ }
                    }

                    if (customAction) {
                        handleCustomAction(msg, customAction);
                    } else if (isGameMsg) {
                        const action = game.parseGameAction(msg.data);
                        if (action) handleGameAction(msg, action);
                    } else if (isBjMsg) {
                        const action = bj.parseBlackjackAction(msg.data);
                        if (action) handleBlackjackAction(msg, action);
                    } else if (isRlMsg) {
                        const action = rl.parseRouletteAction(msg.data);
                        if (action) handleRouletteAction(msg, action);
                    } else if (isAbMsg) {
                        const action = ab.parseAndarBaharAction(msg.data);
                        if (action) handleAndarBaharAction(msg, action);
                    } else if (isCurrentRoom) {
                        const gifMatch = msg.data.match(/^\[GIF\](.+)$/);
                        if (gifMatch) {
                            addMsg(msg.nick, '', 'peer', { gif: gifMatch[1], roomId: msg.room_id });
                        } else if (msg.data) {
                            addMsg(msg.nick, msg.data, 'peer', { roomId: msg.room_id });
                        }
                    }
                    break;
                }
                case 'room_peer_joined':
                    addMsg('★', `${msg.nick} joined the room`, 'system');
                    break;
                case 'room_peer_left':
                    addMsg('★', `${msg.nick} left the room`, 'system');
                    break;
                case 'room_list':
                    setRooms(msg.rooms || []);
                    break;

                // ── Host migration ───────────────────────────────────
                case 'host_left': {
                    const myId = myIdRef.current;
                    addMsg('★', `👑 Host changed — new host elected`, 'system');
                    // Update host references
                    if (rouletteRef.current?.roomId === msg.room_id) {
                        rouletteHostRef.current = msg.new_host;
                        if (msg.new_host === myId) {
                            addMsg('★', '👑 You are now the Roulette host', 'system');
                            startRouletteTimer();
                        }
                    }
                    if (andarBaharRef.current?.roomId === msg.room_id) {
                        abHostRef.current = msg.new_host;
                        if (msg.new_host === myId) {
                            addMsg('★', '👑 You are now the Andar Bahar host', 'system');
                            // Restart the full AB cycle from current state
                            const curAb = andarBaharRef.current;
                            if (curAb) startAbCycle(curAb);
                        }
                    }
                    break;
                }

                // ── Admin events ─────────────────────────────────────
                case 'kicked':
                    addMsg('★', `⚡ ${msg.message || 'You were kicked.'}`, 'system');
                    setConnected(false);
                    break;
                case 'banned':
                    addMsg('★', `🚫 ${msg.message || 'You are banned.'}`, 'system');
                    setConnected(false);
                    break;
                case 'banned_ips':
                    setBannedIps(msg.ips || []);
                    break;
                case 'admin_adjust_balance': {
                    const w = walletRef.current;
                    if (w) {
                        const updated = wallet.adminAdjust(w, msg.delta, msg.reason);
                        updateWallet(updated);
                        addMsg('★', `💰 Admin ${msg.delta > 0 ? 'added' : 'deducted'} ${Math.abs(msg.delta)} chips (${msg.reason})`, 'system');
                    }
                    break;
                }

                case 'disconnected':
                    setConnected(false);
                    addMsg('★', '⚠ Disconnected — reconnecting...', 'system');
                    break;
                case 'error':
                    addMsg('★', `⚠ ${msg.message}`, 'system');
                    break;
            }
        };

        socket.connect(nickRef.current, onEvent);
        return () => socket.disconnect();
    }, [addMsg, handleGameAction, handleBlackjackAction, handleRouletteAction, handleAndarBaharAction, startRouletteTimer, startAbCycle]);

    useEffect(() => {
        if (gameChatEnd.current && showGameChat) {
            gameChatEnd.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages, showGameChat]);

    useEffect(() => {
        messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // ── Invite handlers ──────────────────────────────────────
    const acceptInvite = (invite) => { socket.joinRoom(invite.room_id); setPendingInvites(prev => prev.filter(i => i.id !== invite.id)); };
    const declineInvite = (invite) => setPendingInvites(prev => prev.filter(i => i.id !== invite.id));

    // ── Blackjack handlers ───────────────────────────────────
    const bjHostRef = useRef(null);

    const startBlackjack = (roomId) => {
        const myId = myIdRef.current;
        const myNick = nickRef.current;
        const newGame = bj.createGame(roomId, myId);
        newGame.players = [{ peer_id: myId, nick: myNick, hand: [], status: 'waiting', bet: 0 }];
        setBlackjackGame(newGame);
        bjHostRef.current = myId;
        hasJoinedBj.current = true; // host auto-joined
        addMsg('★', `🃏 Blackjack started! Dealing in 20s.`, 'system');
        socket.sendRoomMessage(roomId, bj.serializeBlackjackAction({ type: 'bj_start', room_id: roomId, host: myId, host_nick: myNick }));
        socket.sendRoomMessage(roomId, bj.serializeBlackjackAction({ type: 'bj_state', state: bj.serializeGame(newGame) }));
        startBlackjackTimer(newGame);
    };

    const handleBjAction = (action) => {
        if (!blackjackGame) return;
        const myId = myIdRef.current;
        const myNick = nickRef.current;
        let newGame = blackjackGame;

        switch (action.type) {
            case 'join':
                newGame = bj.addPlayer(blackjackGame, myId, myNick);
                socket.sendRoomMessage(blackjackGame.roomId, bj.serializeBlackjackAction({ type: 'bj_join', peer_id: myId, nick: myNick }));
                break;
            case 'bet': {
                // Debit wallet on bet
                const w = walletRef.current;
                if (w && wallet.canAfford(w, action.amount)) {
                    const updated = wallet.debit(w, action.amount, 'Blackjack bet');
                    updateWallet(updated);
                }
                newGame = bj.placeBet(blackjackGame, myId, action.amount);
                break;
            }
            case 'deal': newGame = bj.dealInitialCards(blackjackGame); break;
            case 'hit': newGame = bj.hit(blackjackGame, myId); break;
            case 'stand': newGame = bj.stand(blackjackGame, myId); break;
            case 'dealerPlay': newGame = bj.runDealerTurn(blackjackGame); break;
            case 'newRound':
                newGame = bj.newRound(blackjackGame);
                startBlackjackTimer(newGame);
                break;
        }

        setBlackjackGame(newGame);
        socket.sendRoomMessage(newGame.roomId, bj.serializeBlackjackAction({ type: 'bj_state', state: bj.serializeGame(newGame) }));

        if (newGame.phase === 'dealer' && blackjackGame.phase !== 'dealer') {
            setTimeout(() => {
                const settled = bj.runDealerTurn(newGame);
                setBlackjackGame(settled);
                if (amIHost(bjHostRef.current) && settled.payouts) {
                    updateBankLedger('blackjack', settled.payouts);
                }
                socket.sendRoomMessage(settled.roomId, bj.serializeBlackjackAction({ type: 'bj_state', state: bj.serializeGame(settled) }));
            }, 1000);
        }
    };

    // ── Roulette handlers ────────────────────────────────────
    const startRoulette = (roomId) => {
        const myId = myIdRef.current;
        const myNick = nickRef.current;
        const newGame = rl.createRoulette(roomId);
        setRouletteGame(newGame);
        rouletteHostRef.current = myId;
        hasJoinedRl.current = true; // host auto-joined
        addMsg('★', `🎰 Roulette started! Auto-spin every 2 minutes.`, 'system');
        socket.sendRoomMessage(roomId, rl.serializeRouletteAction({ type: 'rl_start', room_id: roomId, host: myId, host_nick: myNick }));
        socket.sendRoomMessage(roomId, rl.serializeRouletteAction({ type: 'rl_state', state: rl.serializeGame(newGame) }));
        startRouletteTimer();
    };

    const handleRlAction = (action) => {
        if (!rouletteGame) return;
        const myId = myIdRef.current;
        const myNick = nickRef.current;
        let newGame = rouletteGame;

        switch (action.type) {
            case 'bet': {
                const w = walletRef.current;
                if (!w || !wallet.canAfford(w, action.amount)) { addMsg('★', `⚠ Insufficient chips.`, 'system'); return; }
                // Only deduct on spin, not on bet placement — just track the bet
                newGame = rl.placeBet(rouletteGame, myId, myNick, action.betType, action.betTarget, action.amount);
                break;
            }
            case 'clearBets':
                newGame = rl.clearBets(rouletteGame, myId);
                break;
        }

        setRouletteGame(newGame);
        socket.sendRoomMessage(newGame.roomId, rl.serializeRouletteAction({ type: 'rl_state', state: rl.serializeGame(newGame) }));
    };

    // ── Andar Bahar handlers ───────────────────────────────────
    const startAndarBahar = (roomId) => {
        const myId = myIdRef.current;
        const myNick = nickRef.current;
        const newGame = ab.createGame(roomId);
        setAndarBaharGame(newGame);
        abHostRef.current = myId;
        hasJoinedAb.current = true; // host auto-joined
        addMsg('★', `🃏 Andar Bahar started! Betting open for 30s.`, 'system');
        socket.sendRoomMessage(roomId, ab.serializeAndarBaharAction({ type: 'ab_start', room_id: roomId, host: myId, host_nick: myNick }));
        socket.sendRoomMessage(roomId, ab.serializeAndarBaharAction({ type: 'ab_state', state: ab.serializeGame(newGame) }));
        // Start the auto-cycle immediately
        startAbCycle(newGame);
    };

    const handleAbAction = (action) => {
        if (!andarBaharGame) return;
        const myId = myIdRef.current;
        const myNick = nickRef.current;

        if (action.type === 'clearBets') {
            const newGame = ab.clearBets(andarBaharGame, myId);
            setAndarBaharGame(newGame);
            socket.sendRoomMessage(newGame.roomId, ab.serializeAndarBaharAction({ type: 'ab_state', state: ab.serializeGame(newGame) }));
            return;
        }

        if (action.type !== 'bet') return; // auto-cycle handles everything else

        const w = walletRef.current;
        if (!w || !wallet.canAfford(w, action.amount)) { addMsg('★', `⚠ Insufficient chips.`, 'system'); return; }
        const newGame = ab.placeBet(andarBaharGame, myId, myNick, action.side, action.amount);
        setAndarBaharGame(newGame);
        socket.sendRoomMessage(newGame.roomId, ab.serializeAndarBaharAction({ type: 'ab_state', state: ab.serializeGame(newGame) }));
    };

    // ── GIF handler ──────────────────────────────────────────
    const handleGifSelect = (gifUrl) => {
        const myNick = nickRef.current;
        const activeRoom = currentRoomRef.current;
        if (!activeRoom) { addMsg('★', '⚠ Switch to a room to send GIFs', 'system'); return; }
        addMsg(myNick, '', 'self', { gif: gifUrl, roomId: activeRoom });
        socket.sendRoomMessage(activeRoom, `[GIF]${gifUrl}`);
        setShowGifPicker(false);
    };

    // ── Admin handlers ───────────────────────────────────────
    const handleAdminKick = (peer_id) => {
        socket.send({ type: 'admin_kick', peer_id });
        addActivityLog(`Kicked peer ${peer_id}`);
    };
    const handleAdminBanIp = (peer_id) => {
        socket.send({ type: 'admin_ban_ip', peer_id });
        addActivityLog(`IP-banned peer ${peer_id}`);
    };
    const handleAdminUnbanIp = (ip) => {
        socket.send({ type: 'admin_unban_ip', ip });
        setBannedIps(prev => prev.filter(i => i !== ip));
        addActivityLog(`Unbanned IP ${ip}`);
    };
    const handleAdminAdjustBalance = (peer_id, nick, delta) => {
        socket.send({ type: 'admin_adjust_balance', peer_id, delta, reason: `Admin grant from ${nickRef.current}` });
        addActivityLog(`Adjusted ${nick}'s balance by ${delta} chips`);
    };

    // ── Paste handler for Images/GIFs ───────────────────────────────
    const handlePaste = useCallback((e) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        for (const item of items) {
            if (item.type.indexOf('image/') !== -1) {
                const file = item.getAsFile();
                if (!file) continue;
                if (file.size > 1024 * 1024) { // 1MB limit for P2P ease
                    addMsg('★', '⚠ Image too large. Max 1MB.', 'system');
                    continue;
                }
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const dataUrl = ev.target.result;
                    const activeRoom = currentRoomRef.current;
                    if (activeRoom) {
                        addMsg(nickRef.current, '', 'self', { roomId: activeRoom, gif: dataUrl });
                        socket.sendRoomMessage(activeRoom, '', { gif: dataUrl });
                    } else {
                        addMsg('★', '⚠ Must be in a room to send images.', 'system');
                    }
                };
                reader.readAsDataURL(file);
                e.preventDefault();
                break;
            }
        }
    }, [addMsg]);

    // ── Command handler ──────────────────────────────────────
    const handleSend = (e) => {
        e.preventDefault();
        const text = input.trim();
        if (!text) return;
        setInput('');
        setShowGifPicker(false);

        const myId = myIdRef.current;
        const myNick = nickRef.current;
        const currentRooms = roomsRef.current;
        const currentPeers = peersRef.current;
        const activeRoom = currentRoomRef.current;

        if (text === '/help') {
            addMsg('★', '── COMMANDS ──────────────────────', 'system');
            addMsg('★', '/room create <name>  — create a room', 'system');
            addMsg('★', '/room invite <nick> <room_id>  — invite peer', 'system');
            addMsg('★', '/room list  — list rooms', 'system');
            addMsg('★', '/game tictactoe  — challenge room to game', 'system');
            addMsg('★', '/blackjack  — start blackjack game', 'system');
            addMsg('★', '/roulette  — start roulette (auto-spin every 2 min)', 'system');
            addMsg('★', '/andarbahar  — start Andar Bahar', 'system');
            addMsg('★', '/balance  — show your chip balance', 'system');
            addMsg('★', '/tip <nick> <amount>  — send chips to a peer', 'system');
            addMsg('★', '/clear  — clear current chat history', 'system');
            return;
        }

        if (text === '/clear') {
            const clearRoom = currentRoomRef.current || null;
            setMessages(prev => prev.filter(m => m.roomId !== clearRoom));
            addMsg('★', 'Chat history cleared.', 'system', { roomId: clearRoom });
            return;
        }

        if (text.startsWith('/tip ')) {
            const parts = text.slice(5).trim().split(/\s+/);
            if (parts.length >= 2) {
                const targetNick = parts[0];
                const amount = parseInt(parts[1], 10);
                const target = currentPeers.find(p => p.nick === targetNick);
                if (!target) { addMsg('★', `⚠ Peer "${targetNick}" not found.`, 'system'); return; }
                if (!amount || amount <= 0) { addMsg('★', '⚠ Invalid amount.', 'system'); return; }
                const w = walletRef.current;
                if (!w || !wallet.canAfford(w, amount)) { addMsg('★', '⚠ Insufficient chips.', 'system'); return; }
                const updated = wallet.debit(w, amount, `Tip to ${targetNick}`);
                updateWallet(updated);
                const tipRoom = activeRoom || (currentRooms[0]?.room_id);
                if (tipRoom) {
                    socket.sendRoomMessage(tipRoom, JSON.stringify({
                        type: 'tip', to: target.peer_id, from_nick: myNick, amount,
                    }));
                }
                addMsg('💸', `Tipped ${amount} chips to ${targetNick}!`, 'system');
            }
            return;
        }

        if (text === '/balance') {
            const w = walletRef.current;
            if (w) addMsg('★', `💰 Balance: ${wallet.getTotalBalance(w)} chips (base: ${w.baseBalance}, bonus: ${w.adminBonus})`, 'system');
            return;
        }

        if (text.startsWith('/room create ')) {
            const name = text.slice(13).trim();
            if (name) socket.createRoom(name);
            return;
        }

        if (text.startsWith('/room invite ')) {
            const parts = text.slice(13).trim().split(/\s+/);
            if (parts.length >= 2) {
                const target = currentPeers.find(p => p.nick === parts[0] || p.peer_id.startsWith(parts[0]));
                if (target) { socket.inviteToRoom(parts[1], target.peer_id); addMsg('★', `🏠 Invited ${target.nick} to room.`, 'system'); }
                else addMsg('★', `⚠ Peer "${parts[0]}" not found.`, 'system');
            }
            return;
        }

        if (text === '/room list') {
            if (currentRooms.length === 0) addMsg('★', '🏠 No rooms yet.', 'system');
            else currentRooms.forEach(r => addMsg('★', `  🏠 ${r.name}  |  ${r.room_id}`, 'system'));
            return;
        }

        if (text.startsWith('/game tictactoe') || text === '/game') {
            let roomId = text.slice(15).trim();
            if (!roomId && activeRoom) roomId = activeRoom;
            if (!roomId && currentRooms.length > 0) roomId = currentRooms[0].room_id;
            if (!roomId) { addMsg('★', '⚠ Create a room first.', 'system'); return; }
            addMsg('★', '🎮 Challenging room to Tic-Tac-Toe...', 'system');
            socket.sendRoomMessage(roomId, game.serializeGameAction({ type: 'Challenge', challenger: myId, challenger_nick: myNick, room_id: roomId }));
            return;
        }

        if (text === '/blackjack' || text.startsWith('/blackjack ')) {
            let roomId = text.slice(11).trim();
            if (!roomId && activeRoom) roomId = activeRoom;
            if (!roomId && currentRooms.length > 0) roomId = currentRooms[0].room_id;
            if (!roomId) { addMsg('★', '⚠ Create a room first.', 'system'); return; }
            if (blackjackRef.current) { addMsg('★', '⚠ Blackjack already in progress.', 'system'); return; }
            startBlackjack(roomId);
            return;
        }

        if (text === '/roulette' || text.startsWith('/roulette ')) {
            let roomId = text.slice(9).trim();
            if (!roomId && activeRoom) roomId = activeRoom;
            if (!roomId && currentRooms.length > 0) roomId = currentRooms[0].room_id;
            if (!roomId) { addMsg('★', '⚠ Create a room first.', 'system'); return; }
            if (rouletteRef.current) { addMsg('★', '⚠ Roulette already running.', 'system'); return; }
            startRoulette(roomId);
            return;
        }

        if (text === '/andarbahar' || text.startsWith('/andarbahar ')) {
            let roomId = text.slice(11).trim();
            if (!roomId && activeRoom) roomId = activeRoom;
            if (!roomId && currentRooms.length > 0) roomId = currentRooms[0].room_id;
            if (!roomId) { addMsg('★', '⚠ Create a room first.', 'system'); return; }
            if (andarBaharRef.current) { addMsg('★', '⚠ Andar Bahar already running.', 'system'); return; }
            startAndarBahar(roomId);
            return;
        }

        // Whisper mode — send ephemeral P2P message
        if (whisperTarget && activeRoom) {
            socket.sendRoomMessage(activeRoom, JSON.stringify({
                type: 'whisper',
                to: whisperTarget.peer_id,
                to_nick: whisperTarget.nick,
                from_nick: myNick,
                content: text,
            }));
            addMsg(`🤫 ${myNick}`, text, 'whisper', {
                to: whisperTarget.peer_id, to_nick: whisperTarget.nick, roomId: activeRoom,
            });
            return;
        }

        if (activeRoom) {
            addMsg(myNick, text, 'self', { roomId: activeRoom });
            socket.sendRoomMessage(activeRoom, text);
        } else {
            addMsg(myNick, text, 'self');
            socket.sendChat(text);
        }
    };

    // ── Game move ────────────────────────────────────────────
    const handleGameMove = (position) => {
        const myId = myIdRef.current;
        if (!activeGame || !game.isMyTurn(activeGame, myId)) return;
        const result = game.makeMove(activeGame, position, myId);
        if (result.error) { addMsg('★', `⚠ ${result.error}`, 'system'); return; }
        setActiveGame(result.game);
        socket.sendRoomMessage(result.game.roomId, game.serializeGameAction({ type: 'Move', position, room_id: result.game.roomId, player: myId }));
    };

    const handleRematch = () => {
        const myId = myIdRef.current;
        const myNick = nickRef.current;
        const g = activeGameRef.current;
        if (!g) return;
        const ng = game.newRound(g);
        setActiveGame(ng);
        socket.sendRoomMessage(ng.roomId, game.serializeGameAction({ type: 'Challenge', challenger: myId, challenger_nick: myNick, room_id: ng.roomId }));
    };

    const myNick = nickRef.current;
    const currentRoomName = currentRoom ? rooms.find(r => r.room_id === currentRoom)?.name || 'Unknown Room' : null;
    const balance = myWallet ? wallet.getTotalBalance(myWallet) : 0;
    const anyGameActive = !!(activeGame || blackjackGame || rouletteGame || andarBaharGame);

    return (
        <div className="chat-layout">
            <header className="chat-header">
                <h1>⚡ OpenWire</h1>
                <div className="header-context">
                    {currentRoomName ? (
                        <span className="current-room-indicator">
                            <span className="room-icon">🏠</span>
                            <span className="room-name">{currentRoomName}</span>
                            <button className="leave-room-btn" onClick={() => setCurrentRoom(null)} title="Back to General Chat">✕</button>
                        </span>
                    ) : (
                        <span className="general-chat-indicator">💬 General Chat</span>
                    )}
                </div>
                <div className="header-status">
                    {myWallet && (
                        <>
                            <button
                                className="btn-account-history"
                                onClick={() => setShowAccountHistory(true)}
                                title="Account History"
                            >📊</button>
                            <span className="header-chips">💰 {balance.toLocaleString()}</span>
                        </>
                    )}
                    <button
                        className={`btn-agent-panel ${agentRunning ? 'active' : ''}`}
                        onClick={() => setShowAgentPanel(v => !v)}
                        title="Pop-Culture Agent Swarm"
                    >🤖</button>
                    <span className={`status-dot ${connected ? '' : 'offline'}`} />
                    <span>{connected ? `${myNick} — ${peers.length} online` : 'Connecting...'}</span>
                </div>
            </header>

            {/* Room Invites — toast only for room invites (not game invites) */}
            {pendingInvites.length > 0 && (
                <div className="invite-toasts">
                    {pendingInvites.map(invite => (
                        <div key={invite.id} className="invite-toast">
                            <div className="invite-toast-title">🏠 Room Invite</div>
                            <div className="invite-toast-body"><strong>{invite.from_nick}</strong> invited you to <strong>{invite.room_name}</strong></div>
                            <div className="invite-toast-actions">
                                <button className="btn-accept" onClick={() => acceptInvite(invite)}>Accept</button>
                                <button className="btn-decline" onClick={() => declineInvite(invite)}>Decline</button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Casino Live Ticker — game events only, separate from chat */}
            <LiveTicker items={tickerItems} />

            <div className="messages-area">
                {messages
                    .filter(m => m.roomId === (currentRoom || null))
                    .map((m) => (
                    <div key={m.id} className={`msg ${m.type}${m.type === 'whisper' ? ' whisper' : ''}`}>
                        {m.type === 'game_invite' && !m.inviteUsed ? (
                            <div className="game-invite-inline">
                                <span className="game-invite-icon">{m.sender}</span>
                                <span className="game-invite-text">{m.content}</span>
                                <button className="game-invite-join" onClick={() => joinGameFromInvite(m)}>Join Table</button>
                                <button className="game-invite-dismiss" onClick={() => dismissInvite(m.id)}>✕</button>
                            </div>
                        ) : m.type === 'game_invite' && m.inviteUsed ? (
                            <div className="game-invite-inline used">
                                <span className="game-invite-icon">{m.sender}</span>
                                <span className="game-invite-text">{m.content} <em>(joined)</em></span>
                            </div>
                        ) : (
                            <>
                                <span className="msg-time">[{m.time}]</span>
                                {m.sender && <span className={`msg-sender ${m.type}`}>{m.sender}:</span>}
                                {m.gif ? (
                                    <img src={m.gif} alt="GIF" className="msg-gif" />
                                ) : (
                                    <span className="msg-content"> {m.content}</span>
                                )}
                                {/* Emoji reaction display */}
                                {m.reactions && Object.keys(m.reactions).length > 0 && (
                                    <span className="msg-reactions-display">
                                        {Object.entries(m.reactions).map(([emoji, peers]) => (
                                            <span key={emoji} className="reaction-badge" onClick={() => handleReact(m.id, emoji)}>
                                                {emoji} {peers.length}
                                            </span>
                                        ))}
                                    </span>
                                )}
                                {/* Quick reaction picker — show on hover via CSS */}
                                {(m.type === 'peer' || m.type === 'self') && (
                                    <span className="msg-reaction-bar">
                                        {['🔥', '👏', '💰'].map(e => (
                                            <button key={e} className="react-btn" onClick={() => handleReact(m.id, e)}>{e}</button>
                                        ))}
                                    </span>
                                )}
                            </>
                        )}
                    </div>
                ))}
                <div ref={messagesEnd} />
            </div>

            <TypingBar typingPeers={typingPeers} myId={myIdRef.current} />

            {whisperTarget && (
                <div className="whisper-mode-bar">
                    🤫 Whispering to <strong>{whisperTarget.nick}</strong>
                    <button onClick={() => setWhisperTarget(null)}>✕ Exit</button>
                </div>
            )}

            <form className="chat-input" onSubmit={handleSend}>
                <div className="chat-input-wrapper" style={{ flex: 1, position: 'relative' }}>
                    <input
                        type="text"
                        placeholder={currentRoom ? `Message #${rooms.find(r => r.room_id === currentRoom)?.name || 'room'}...` : 'Message General Chat... (or /help)'}
                        value={input}
                        onChange={(e) => {
                            setInput(e.target.value);
                            const now = Date.now();
                            if (now - lastTypingSentRef.current > 1500 && currentRoomRef.current) {
                                lastTypingSentRef.current = now;
                                socket.sendRoomMessage(currentRoomRef.current, JSON.stringify({
                                    type: 'typing', nick: nickRef.current,
                                }));
                            }
                        }}
                        onPaste={handlePaste}
                        autoFocus
                    />
                    {showGifPicker && <GifPicker onSelect={handleGifSelect} onClose={() => setShowGifPicker(false)} />}
                </div>
                <button type="button" className="gif-btn" onClick={() => setShowGifPicker(!showGifPicker)}>GIF</button>
                <button type="submit">Send</button>
            </form>

            <div className="sidebar">
                <div className="sidebar-section">
                    <div className="sidebar-title">Channels</div>
                    <div className={`room-item ${!currentRoom ? 'active' : ''}`} onClick={() => setCurrentRoom(null)} style={{ cursor: 'pointer' }}>
                        <span className="room-icon">💬</span>
                        <span className="room-name">General Chat {!currentRoom && <span style={{ fontSize: '0.7em', color: 'var(--brand)', marginLeft: '4px' }}>(Joined)</span>}</span>
                    </div>
                </div>

                {/* Wallet display */}
                {myWallet && (
                    <div className="sidebar-section">
                        <div className="sidebar-title">My Wallet</div>
                        <div className="sidebar-wallet">
                            <div className="wallet-balance">{balance.toLocaleString()} <span className="wallet-unit">chips</span></div>
                            <div className="wallet-sub">
                                Base: {myWallet.baseBalance} · Bonus: {myWallet.adminBonus}
                            </div>
                            <div className="wallet-resets">Resets at midnight IST</div>
                        </div>
                    </div>
                )}

                <div className="sidebar-section">
                    <div className="sidebar-title">Online ({peers.length})</div>
                    {peers.filter(p => p.peer_id !== myIdRef.current).map((p) => (
                        <div key={p.peer_id} className="peer-item">
                            <span className="peer-dot" />
                            <span className="peer-nick">{p.nick}</span>
                            {p.balance > 0 && <span className="peer-chips">{p.balance.toLocaleString()}</span>}
                            <button
                                className="whisper-btn"
                                title={`Whisper to ${p.nick}`}
                                onClick={() => setWhisperTarget({ peer_id: p.peer_id, nick: p.nick })}
                            >🤫</button>
                            <button
                                className="tip-btn"
                                title={`Tip ${p.nick}`}
                                onClick={() => {
                                    const amount = parseInt(prompt(`Tip amount to ${p.nick}:`), 10);
                                    if (!amount || amount <= 0) return;
                                    const w = walletRef.current;
                                    if (!w || !wallet.canAfford(w, amount)) { addMsg('★', '⚠ Insufficient chips.', 'system'); return; }
                                    const updated = wallet.debit(w, amount, `Tip to ${p.nick}`);
                                    updateWallet(updated);
                                    const tipRoom = currentRoomRef.current || roomsRef.current[0]?.room_id;
                                    if (tipRoom) {
                                        socket.sendRoomMessage(tipRoom, JSON.stringify({
                                            type: 'tip', to: p.peer_id, from_nick: nickRef.current, amount,
                                        }));
                                    }
                                    addMsg('💸', `Tipped ${amount} chips to ${p.nick}!`, 'system');
                                }}
                            >💰</button>
                        </div>
                    ))}
                    {peers.filter(p => p.peer_id !== myIdRef.current).length === 0 && (
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>No peers yet…</div>
                    )}
                </div>

                <div className="sidebar-section">
                    <div className="sidebar-title">Rooms ({rooms.length})</div>
                    {rooms.map((r) => (
                        <div key={r.room_id} className={`room-item ${currentRoom === r.room_id ? 'active' : ''}`} onClick={() => setCurrentRoom(r.room_id)} style={{ cursor: 'pointer' }}>
                            <span className="room-icon">🏠</span>
                            <span className="room-name">{r.name} {currentRoom === r.room_id && <span style={{ fontSize: '0.7em', color: 'var(--brand)', marginLeft: '4px' }}>(Joined)</span>}</span>
                        </div>
                    ))}
                </div>

                <div className="sidebar-actions">
                    <button className="sidebar-btn" onClick={() => { const name = prompt('Room name:'); if (name) socket.createRoom(name); }}>+ Create Room</button>

                    {rooms.length > 0 && (
                        <>
                            <button className="sidebar-btn" onClick={() => {
                                const roomId = currentRoomRef.current || roomsRef.current[0]?.room_id;
                                if (!roomId) { addMsg('★', '⚠ Select or create a room first', 'system'); return; }
                                socket.sendRoomMessage(roomId, game.serializeGameAction({ type: 'Challenge', challenger: myIdRef.current, challenger_nick: nickRef.current, room_id: roomId }));
                                addMsg('★', '🎮 Game challenge sent!', 'system');
                            }}>🎮 Tic-Tac-Toe</button>

                            <button className="sidebar-btn" onClick={() => {
                                const roomId = currentRoomRef.current || roomsRef.current[0]?.room_id;
                                if (!roomId) { addMsg('★', '⚠ Select or create a room first', 'system'); return; }
                                if (blackjackRef.current) { addMsg('★', '⚠ Blackjack already in progress', 'system'); return; }
                                startBlackjack(roomId);
                            }}>🃏 Blackjack</button>

                            <button className="sidebar-btn" onClick={() => {
                                const roomId = currentRoomRef.current || roomsRef.current[0]?.room_id;
                                if (!roomId) { addMsg('★', '⚠ Select or create a room first', 'system'); return; }
                                if (rouletteRef.current) { setRouletteGame(rouletteRef.current); return; }
                                startRoulette(roomId);
                            }}>🎰 Roulette</button>

                            <button className="sidebar-btn" onClick={() => {
                                const roomId = currentRoomRef.current || roomsRef.current[0]?.room_id;
                                if (!roomId) { addMsg('★', '⚠ Select or create a room first', 'system'); return; }
                                if (andarBaharRef.current) { setAndarBaharGame(andarBaharRef.current); return; }
                                startAndarBahar(roomId);
                            }}>🃏 Andar Bahar</button>

                            <button className="sidebar-btn" onClick={() => {
                                const nick = prompt('Invite nick:');
                                const roomId = currentRoomRef.current || roomsRef.current[0]?.room_id;
                                if (nick && roomId) {
                                    const target = peersRef.current.find(p => p.nick === nick);
                                    if (target) { socket.inviteToRoom(roomId, target.peer_id); addMsg('★', `🏠 Invited ${target.nick} to room.`, 'system'); }
                                    else addMsg('★', `⚠ Peer "${nick}" not found.`, 'system');
                                }
                            }}>✉ Invite to Room</button>
                        </>
                    )}

                    {initialIsAdmin && (
                        <button className="sidebar-btn admin-btn-sidebar" onClick={() => setShowAdmin(true)}>
                            🔐 Admin Portal
                        </button>
                    )}
                </div>
            </div>

            {/* Game Overlays */}
            {activeGame && (
                <GameBoard game={activeGame} myId={myIdRef.current} onMove={handleGameMove} onRematch={handleRematch} onClose={() => setActiveGame(null)} onHelp={() => openHelp('tictactoe')} />
            )}
            {blackjackGame && (
                <BlackjackBoard game={blackjackGame} myId={myIdRef.current} myNick={myNick} wallet={myWallet} onAction={handleBjAction} onClose={() => setBlackjackGame(null)} onHelp={() => openHelp('blackjack')} isHost={bjHostRef.current === myIdRef.current} />
            )}
            {rouletteGame && (
                <RouletteBoard
                    game={rouletteGame}
                    myId={myIdRef.current}
                    myNick={myNick}
                    wallet={myWallet}
                    onAction={handleRlAction}
                    onClose={() => setRouletteGame(null)}
                    onHelp={() => openHelp('roulette')}
                    isHost={amIHost(rouletteHostRef.current)}
                />
            )}
            {andarBaharGame && (
                <AndarBaharBoard
                    game={andarBaharGame}
                    myId={myIdRef.current}
                    myNick={myNick}
                    wallet={myWallet}
                    onAction={handleAbAction}
                    onClose={() => setAndarBaharGame(null)}
                    onHelp={() => openHelp('andarbahar')}
                    isHost={amIHost(abHostRef.current)}
                />
            )}

            {/* How to Play Overlay — stacked above game, internal scroll only */}
            {showHelp && (
                <HowToPlay activeGame={helpGame} onClose={() => setShowHelp(false)} />
            )}

            {/* Post-Session Summary — shown after every completed round */}
            {showPostSummary && lastPayoutEvent && (
                <PostSessionSummary
                    event={lastPayoutEvent}
                    myId={myIdRef.current}
                    onClose={() => setShowPostSummary(false)}
                />
            )}

            {/* Account History — full ledger view */}
            {showAccountHistory && (
                <AccountHistory
                    deviceId={wallet.getDeviceId()}
                    myId={myIdRef.current}
                    onClose={() => setShowAccountHistory(false)}
                />
            )}

            {/* Pop-Culture Agent Swarm Control Panel */}
            {showAgentPanel && (
                <AgentControlPanel
                    swarm={swarmRef.current}
                    onClose={() => setShowAgentPanel(false)}
                />
            )}

            {/* Floating chat toggle — visible only when a game overlay is open */}
            {anyGameActive && (
                <button
                    className={`floating-chat-btn ${showGameChat ? 'active' : ''}`}
                    onClick={() => setShowGameChat(v => !v)}
                    title="Toggle Chat"
                >
                    {showGameChat ? '✕' : '💬'}
                    {!showGameChat && messages.length > 0 && <span className="floating-chat-badge" />}
                </button>
            )}

            {/* Floating chat panel — shown on top of game overlays */}
            {anyGameActive && showGameChat && (
                <div className="floating-chat-panel">
                    <div className="floating-chat-header">
                        <span>💬 Chat {currentRoomName ? `· #${currentRoomName}` : ''}</span>
                        <button onClick={() => setShowGameChat(false)}>✕</button>
                    </div>
                    <div className="floating-chat-messages">
                        {messages.slice(-50).map((m) => (
                            <div key={m.id} className={`msg ${m.type}`}>
                                <span className="msg-time">[{m.time}]</span>
                                {m.sender && <span className={`msg-sender ${m.type}`}>{m.sender}:</span>}
                                {m.gif ? (
                                    <img src={m.gif} alt="GIF" className="msg-gif" style={{ maxWidth: '140px' }} />
                                ) : (
                                    <span className="msg-content"> {m.content}</span>
                                )}
                            </div>
                        ))}
                        <div ref={gameChatEnd} />
                    </div>
                    <form className="floating-chat-input" onSubmit={(e) => {
                        e.preventDefault();
                        const text = input.trim();
                        if (!text) return;
                        setInput('');
                        const activeRoom = currentRoomRef.current;
                        if (activeRoom) {
                            addMsg(nickRef.current, text, 'self', { roomId: activeRoom });
                            socket.sendRoomMessage(activeRoom, text);
                        } else {
                            addMsg(nickRef.current, text, 'self');
                            socket.sendChat(text);
                        }
                    }}>
                        <input
                            type="text"
                            placeholder="Message..."
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onPaste={handlePaste}
                        />
                        <button type="submit">Send</button>
                    </form>
                </div>
            )}

            {/* Admin Portal */}
            {showAdmin && initialIsAdmin && (
                <AdminPortal
                    peers={peers}
                    activityLog={activityLog}
                    bannedIps={bannedIps}
                    bankLedger={bankLedger}
                    onKick={handleAdminKick}
                    onBanIp={handleAdminBanIp}
                    onUnbanIp={handleAdminUnbanIp}
                    onAdjustBalance={handleAdminAdjustBalance}
                    onClose={() => setShowAdmin(false)}
                />
            )}
        </div>
    );
}
