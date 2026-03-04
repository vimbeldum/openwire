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
    const [currentRoom, setCurrentRoom] = useState(null);
    const [connected, setConnected] = useState(false);
    const [myWallet, setMyWallet] = useState(null);

    // Games
    const [activeGame, setActiveGame] = useState(null);       // Tic-Tac-Toe
    const [blackjackGame, setBlackjackGame] = useState(null);
    const [rouletteGame, setRouletteGame] = useState(null);
    const [andarBaharGame, setAndarBaharGame] = useState(null);

    // Admin
    const [showAdmin, setShowAdmin] = useState(false);
    const [activityLog, setActivityLog] = useState([]);
    const [bannedIps, setBannedIps] = useState([]);

    // Invites
    const [pendingInvites, setPendingInvites] = useState([]);
    const [pendingChallenges, setPendingChallenges] = useState([]);
    const [pendingBjInvites, setPendingBjInvites] = useState([]);
    const [pendingRlInvites, setPendingRlInvites] = useState([]);
    const [pendingAbInvites, setPendingAbInvites] = useState([]);

    const [showGifPicker, setShowGifPicker] = useState(false);
    const messagesEnd = useRef(null);

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

    useEffect(() => { activeGameRef.current = activeGame; }, [activeGame]);
    useEffect(() => { blackjackRef.current = blackjackGame; }, [blackjackGame]);
    useEffect(() => { rouletteRef.current = rouletteGame; }, [rouletteGame]);
    useEffect(() => { andarBaharRef.current = andarBaharGame; }, [andarBaharGame]);
    useEffect(() => { roomsRef.current = rooms; }, [rooms]);
    useEffect(() => { peersRef.current = peers; }, [peers]);
    useEffect(() => { currentRoomRef.current = currentRoom; }, [currentRoom]);
    useEffect(() => { walletRef.current = myWallet; }, [myWallet]);

    useEffect(() => { saveMessages(messages); }, [messages]);

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

    const addMsg = useCallback((sender, content, type = 'chat', extra = {}) => {
        setMessages(prev => [...prev, { time: timeStr(), sender, content, type, id: Date.now() + Math.random(), ...extra }]);
    }, []);

    const addActivityLog = useCallback((message) => {
        setActivityLog(prev => [...prev.slice(-99), { time: timeStr(), message }]);
    }, []);

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

            const spun = rl.spin(currentGame);
            setRouletteGame(spun);

            // Apply winnings to my wallet
            const myId = myIdRef.current;
            const myNet = spun.payouts?.[myId];
            if (myNet !== undefined && walletRef.current) {
                let w = walletRef.current;
                if (myNet > 0) w = wallet.credit(w, myNet, 'Roulette win');
                else if (myNet < 0) w = wallet.debit(w, -myNet, 'Roulette bet');
                updateWallet(w);
            }

            // Broadcast state
            const roomId = currentGame.roomId;
            socket.sendRoomMessage(roomId, rl.serializeRouletteAction({ type: 'rl_state', state: rl.serializeGame(spun) }));
            addActivityLog(`Roulette spin: result ${spun.result} (${rl.getColor(spun.result)})`);

            // Auto reset to betting after RESULTS_DISPLAY_MS
            setTimeout(() => {
                const reset = rl.newRound(spun);
                setRouletteGame(reset);
                if (amIHost(rouletteHostRef.current)) {
                    socket.sendRoomMessage(roomId, rl.serializeRouletteAction({ type: 'rl_state', state: rl.serializeGame(reset) }));
                }
            }, rl.RESULTS_DISPLAY_MS);

        }, rl.SPIN_INTERVAL_MS);
    }, [addActivityLog, amIHost, updateWallet]);

    useEffect(() => {
        return () => {
            if (rouletteTimerRef.current) clearInterval(rouletteTimerRef.current);
            if (abDealTimerRef.current) clearInterval(abDealTimerRef.current);
            if (abCycleTimerRef.current) clearTimeout(abCycleTimerRef.current);
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

                    // Apply wallet changes for host
                    const myId = myIdRef.current;
                    const myNet = next.payouts?.[myId];
                    if (myNet !== undefined && walletRef.current) {
                        let w = walletRef.current;
                        if (myNet > 0) w = wallet.credit(w, myNet, 'Andar Bahar win');
                        else if (myNet < 0) w = wallet.debit(w, -myNet, 'Andar Bahar bet');
                        updateWallet(w);
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
                setPendingChallenges(prev => {
                    if (prev.some(c => c.challenger === action.challenger && c.room_id === action.room_id)) return prev;
                    return [...prev, { id: Date.now(), challenger: action.challenger, challenger_nick: action.challenger_nick, room_id: action.room_id }];
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
                setPendingBjInvites(prev => {
                    if (prev.some(i => i.room_id === action.room_id)) return prev;
                    return [...prev, { id: Date.now(), room_id: action.room_id, host: action.host, host_nick: action.host_nick }];
                });
                break;
            }
            case 'bj_state': {
                const gameState = bj.deserializeGame(action.state);
                if (gameState) {
                    setBlackjackGame(prev => {
                        // Apply wallet changes when game ends
                        if (gameState.phase === 'ended' && prev?.phase !== 'ended') {
                            const payouts = bj.getPayouts(gameState);
                            const myNet = payouts[myId];
                            if (myNet !== undefined && walletRef.current) {
                                let w = walletRef.current;
                                if (myNet > 0) w = wallet.credit(w, myNet, 'Blackjack win');
                                else if (myNet < 0) w = wallet.debit(w, -myNet, 'Blackjack loss');
                                // Update wallet asynchronously
                                setTimeout(() => updateWallet(w), 0);
                                const resultText = myNet > 0 ? `won ${myNet}` : myNet < 0 ? `lost ${-myNet}` : 'pushed';
                                addActivityLog(`Blackjack: ${myNick} ${resultText} chips`);
                            }
                        }
                        return gameState;
                    });
                }
                break;
            }
            case 'bj_join': {
                addMsg('★', `🃏 ${action.nick} joined Blackjack!`, 'system');
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
                setPendingRlInvites(prev => {
                    if (prev.some(i => i.room_id === action.room_id)) return prev;
                    return [...prev, { id: Date.now(), room_id: action.room_id, host: action.host, host_nick: action.host_nick }];
                });
                break;
            }
            case 'rl_state': {
                const gameState = rl.deserializeGame(action.state);
                if (gameState) {
                    setRouletteGame(prev => {
                        // Apply wallet changes on results
                        if (gameState.phase === 'results' && prev?.phase !== 'results') {
                            const myNet = gameState.payouts?.[myId];
                            if (myNet !== undefined && walletRef.current) {
                                let w = walletRef.current;
                                if (myNet > 0) w = wallet.credit(w, myNet, 'Roulette win');
                                else if (myNet < 0) w = wallet.debit(w, -myNet, 'Roulette bet');
                                setTimeout(() => updateWallet(w), 0);
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
                setPendingAbInvites(prev => {
                    if (prev.some(i => i.room_id === action.room_id)) return prev;
                    return [...prev, { id: Date.now(), room_id: action.room_id, host: action.host, host_nick: action.host_nick }];
                });
                break;
            }
            case 'ab_state': {
                const gameState = ab.deserializeGame(action.state);
                if (gameState) {
                    setAndarBaharGame(prev => {
                        if (gameState.phase === 'ended' && prev?.phase !== 'ended') {
                            const myNet = gameState.payouts?.[myId];
                            if (myNet !== undefined && walletRef.current) {
                                let w = walletRef.current;
                                if (myNet > 0) w = wallet.credit(w, myNet, 'Andar Bahar win');
                                else if (myNet < 0) w = wallet.debit(w, -myNet, 'Andar Bahar bet');
                                setTimeout(() => updateWallet(w), 0);
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

                    if (isGameMsg) {
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
                        } else {
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
        messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // ── Invite handlers ──────────────────────────────────────
    const acceptInvite = (invite) => { socket.joinRoom(invite.room_id); setPendingInvites(prev => prev.filter(i => i.id !== invite.id)); };
    const declineInvite = (invite) => setPendingInvites(prev => prev.filter(i => i.id !== invite.id));

    // ── Challenge handlers ───────────────────────────────────
    const acceptChallenge = (challenge) => {
        const myId = myIdRef.current;
        const myNick = nickRef.current;
        addMsg('★', `🎮 You accepted ${challenge.challenger_nick}'s challenge!`, 'system');
        const g = game.createGame({ peer_id: challenge.challenger, nick: challenge.challenger_nick }, { peer_id: myId, nick: myNick }, challenge.room_id);
        setActiveGame(g);
        socket.sendRoomMessage(challenge.room_id, game.serializeGameAction({ type: 'Accept', accepter: myId, accepter_nick: myNick, room_id: challenge.room_id }));
        setPendingChallenges(prev => prev.filter(c => c.id !== challenge.id));
    };
    const declineChallenge = (challenge) => {
        socket.sendRoomMessage(challenge.room_id, game.serializeGameAction({ type: 'Decline', decliner: myIdRef.current, decliner_nick: nickRef.current, room_id: challenge.room_id }));
        addMsg('★', `🎮 You declined ${challenge.challenger_nick}'s challenge.`, 'system');
        setPendingChallenges(prev => prev.filter(c => c.id !== challenge.id));
    };

    // ── Blackjack handlers ───────────────────────────────────
    const startBlackjack = (roomId) => {
        const myId = myIdRef.current;
        const myNick = nickRef.current;
        const newGame = bj.createGame(roomId, myId);
        newGame.players = [{ peer_id: myId, nick: myNick, hand: [], status: 'waiting', bet: 0 }];
        setBlackjackGame(newGame);
        addMsg('★', `🃏 Blackjack started!`, 'system');
        socket.sendRoomMessage(roomId, bj.serializeBlackjackAction({ type: 'bj_start', room_id: roomId, host: myId, host_nick: myNick }));
        socket.sendRoomMessage(roomId, bj.serializeBlackjackAction({ type: 'bj_state', state: bj.serializeGame(newGame) }));
    };

    const acceptBjInvite = (invite) => {
        socket.sendRoomMessage(invite.room_id, bj.serializeBlackjackAction({ type: 'bj_join', peer_id: myIdRef.current, nick: nickRef.current }));
        setPendingBjInvites(prev => prev.filter(i => i.id !== invite.id));
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
                newGame = bj.placeBet(blackjackGame, action.peer_id, action.amount);
                break;
            }
            case 'deal': newGame = bj.dealInitialCards(blackjackGame); break;
            case 'hit': newGame = bj.hit(blackjackGame, action.peer_id); break;
            case 'stand': newGame = bj.stand(blackjackGame, action.peer_id); break;
            case 'dealerPlay': newGame = bj.runDealerTurn(blackjackGame); break;
            case 'newRound': newGame = bj.newRound(blackjackGame); break;
        }

        setBlackjackGame(newGame);
        socket.sendRoomMessage(newGame.roomId, bj.serializeBlackjackAction({ type: 'bj_state', state: bj.serializeGame(newGame) }));

        if (newGame.phase === 'dealer' && blackjackGame.phase !== 'dealer') {
            setTimeout(() => {
                const settled = bj.runDealerTurn(newGame);
                setBlackjackGame(settled);
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
        addMsg('★', `🎰 Roulette started! Auto-spin every 2 minutes.`, 'system');
        socket.sendRoomMessage(roomId, rl.serializeRouletteAction({ type: 'rl_start', room_id: roomId, host: myId, host_nick: myNick }));
        socket.sendRoomMessage(roomId, rl.serializeRouletteAction({ type: 'rl_state', state: rl.serializeGame(newGame) }));
        startRouletteTimer();
    };

    const acceptRlInvite = (invite) => {
        rouletteHostRef.current = invite.host;
        setPendingRlInvites(prev => prev.filter(i => i.id !== invite.id));
        addMsg('★', `🎰 Joined Roulette room!`, 'system');
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
        addMsg('★', `🃏 Andar Bahar started! Betting open for 30s.`, 'system');
        socket.sendRoomMessage(roomId, ab.serializeAndarBaharAction({ type: 'ab_start', room_id: roomId, host: myId, host_nick: myNick }));
        socket.sendRoomMessage(roomId, ab.serializeAndarBaharAction({ type: 'ab_state', state: ab.serializeGame(newGame) }));
        // Start the auto-cycle immediately
        startAbCycle(newGame);
    };

    const acceptAbInvite = (invite) => {
        abHostRef.current = invite.host;
        setPendingAbInvites(prev => prev.filter(i => i.id !== invite.id));
        addMsg('★', `🃏 Joined Andar Bahar table!`, 'system');
    };

    const handleAbAction = (action) => {
        if (!andarBaharGame) return;
        const myId = myIdRef.current;
        const myNick = nickRef.current;
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
            addMsg('★', '/clear  — clear chat history', 'system');
            return;
        }

        if (text === '/clear') {
            setMessages([]);
            sessionStorage.removeItem(STORAGE_KEY);
            addMsg('★', 'Chat history cleared.', 'system');
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
                        <span className="header-chips">💰 {balance.toLocaleString()}</span>
                    )}
                    <span className={`status-dot ${connected ? '' : 'offline'}`} />
                    <span>{connected ? `${myNick} — ${peers.length} online` : 'Connecting...'}</span>
                </div>
            </header>

            {/* Invite Toasts */}
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
                {pendingBjInvites.map(invite => (
                    <div key={invite.id} className="invite-toast">
                        <div className="invite-toast-title">🃏 Blackjack</div>
                        <div className="invite-toast-body"><strong>{invite.host_nick}</strong> started a Blackjack game!</div>
                        <div className="invite-toast-actions">
                            <button className="btn-accept" onClick={() => acceptBjInvite(invite)}>Join</button>
                            <button className="btn-decline" onClick={() => setPendingBjInvites(prev => prev.filter(i => i.id !== invite.id))}>Ignore</button>
                        </div>
                    </div>
                ))}
                {pendingRlInvites.map(invite => (
                    <div key={invite.id} className="invite-toast">
                        <div className="invite-toast-title">🎰 Roulette</div>
                        <div className="invite-toast-body"><strong>{invite.host_nick}</strong> started Roulette!</div>
                        <div className="invite-toast-actions">
                            <button className="btn-accept" onClick={() => acceptRlInvite(invite)}>Join</button>
                            <button className="btn-decline" onClick={() => setPendingRlInvites(prev => prev.filter(i => i.id !== invite.id))}>Ignore</button>
                        </div>
                    </div>
                ))}
                {pendingAbInvites.map(invite => (
                    <div key={invite.id} className="invite-toast">
                        <div className="invite-toast-title">🃏 Andar Bahar</div>
                        <div className="invite-toast-body"><strong>{invite.host_nick}</strong> started Andar Bahar!</div>
                        <div className="invite-toast-actions">
                            <button className="btn-accept" onClick={() => acceptAbInvite(invite)}>Join</button>
                            <button className="btn-decline" onClick={() => setPendingAbInvites(prev => prev.filter(i => i.id !== invite.id))}>Ignore</button>
                        </div>
                    </div>
                ))}
            </div>

            {/* Tic-Tac-Toe Challenge Popup */}
            {pendingChallenges.length > 0 && (
                <div className="game-challenge">
                    <div className="game-challenge-title">🎮 Game Challenge!</div>
                    <div className="game-challenge-sub">{pendingChallenges[0].challenger_nick} challenged you to Tic-Tac-Toe</div>
                    <div className="game-challenge-actions">
                        <button className="btn-accept" onClick={() => acceptChallenge(pendingChallenges[0])}>Accept</button>
                        <button className="btn-decline" onClick={() => declineChallenge(pendingChallenges[0])}>Decline</button>
                    </div>
                </div>
            )}

            <div className="messages-area">
                {messages.map((m) => (
                    <div key={m.id} className={`msg ${m.type}`}>
                        <span className="msg-time">[{m.time}]</span>
                        {m.sender && <span className={`msg-sender ${m.type}`}>{m.sender}:</span>}
                        {m.gif ? (
                            <img src={m.gif} alt="GIF" className="msg-gif" />
                        ) : (
                            <span className="msg-content"> {m.content}</span>
                        )}
                    </div>
                ))}
                <div ref={messagesEnd} />
            </div>

            <form className="chat-input" onSubmit={handleSend}>
                <div className="chat-input-wrapper" style={{ flex: 1, position: 'relative' }}>
                    <input
                        type="text"
                        placeholder={currentRoom ? `Message #${rooms.find(r => r.room_id === currentRoom)?.name || 'room'}...` : 'Message General Chat... (or /help)'}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
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
                        <span className="room-name">General Chat</span>
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
                            <span className="room-name">{r.name}</span>
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
                <GameBoard game={activeGame} myId={myIdRef.current} onMove={handleGameMove} onRematch={handleRematch} onClose={() => setActiveGame(null)} />
            )}
            {blackjackGame && (
                <BlackjackBoard game={blackjackGame} myId={myIdRef.current} wallet={myWallet} onAction={handleBjAction} onClose={() => setBlackjackGame(null)} />
            )}
            {rouletteGame && (
                <RouletteBoard
                    game={rouletteGame}
                    myId={myIdRef.current}
                    myNick={myNick}
                    wallet={myWallet}
                    onAction={handleRlAction}
                    onClose={() => setRouletteGame(null)}
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
                    isHost={amIHost(abHostRef.current)}
                />
            )}

            {/* Admin Portal */}
            {showAdmin && initialIsAdmin && (
                <AdminPortal
                    peers={peers}
                    activityLog={activityLog}
                    bannedIps={bannedIps}
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
