import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense } from 'react';
import '../styles/chat.css';
import '../styles/games-shared.css';
import * as socket from '../lib/socket';
import * as game from '../lib/game';
import * as bj from '../lib/blackjack';
import * as rl from '../lib/roulette';
import * as ab from '../lib/andarbahar';
import * as pm from '../lib/polymarket';
import * as mystery from '../lib/mystery';
import * as wallet from '../lib/wallet';
import useBlackjackGame from '../hooks/useBlackjackGame';
import useRouletteGame from '../hooks/useRouletteGame';
import useAndarBaharGame from '../hooks/useAndarBaharGame';
import usePolymarketGame from '../hooks/usePolymarketGame';
import useMysteryGame from '../hooks/useMysteryGame';
import MessageRow from './chat/MessageRow';

// Retry wrapper: on chunk-not-found after deploy, reload once to get fresh HTML
function lazyRetry(fn) {
    return lazy(() => fn().then((mod) => {
        // Successful load — clear retry flag so future deploys can also retry
        sessionStorage.removeItem('openwire_chunk_reload');
        return mod;
    }).catch((e) => {
        const key = 'openwire_chunk_reload';
        if (!sessionStorage.getItem(key)) {
            sessionStorage.setItem(key, '1');
            window.location.reload();
            return new Promise(() => {});
        }
        // Already tried a reload — re-throw so React ErrorBoundary can render a fallback
        sessionStorage.removeItem(key);
        throw e;
    }));
}

const GameBoard = lazyRetry(() => import('./GameBoard'));
const BlackjackBoard = lazyRetry(() => import('./BlackjackBoard'));
const RouletteBoard = lazyRetry(() => import('./RouletteBoard'));
const AndarBaharBoard = lazyRetry(() => import('./AndarBaharBoard'));
const PolymarketBoard = lazyRetry(() => import('./PolymarketBoard'));
const AdminPortal = lazyRetry(() => import('./AdminPortal'));
const GifPicker = lazyRetry(() => import('./GifPicker'));
const HowToPlay = lazyRetry(() => import('./HowToPlay'));
const PostSessionSummary = lazyRetry(() => import('./PostSessionSummary'));
const AccountHistory = lazyRetry(() => import('./AccountHistory'));
const AgentControlPanel = lazyRetry(() => import('./AgentControlPanel'));
const VaultPanel = lazyRetry(() => import('./VaultPanel'));
const DeadDropsPanel = lazyRetry(() => import('./DeadDropsPanel'));
const CosmeticsShop = lazyRetry(() => import('./CosmeticsShop'));
const TambolaBoard = lazyRetry(() => import('./TambolaBoard'));
const SlotsBoard = lazyRetry(() => import('./SlotsBoard'));
const MysteryBoard = lazyRetry(() => import('./MysteryBoard'));
const KarmaGuide   = lazyRetry(() => import('./KarmaGuide'));
const PokeOverlay  = lazyRetry(() => import('./chat/PokeOverlay'));
import LiveTicker from './chat/LiveTicker';
import TypingBar from './chat/TypingBar';
import * as ledger from '../lib/core/ledger.js';
import { getRoomAlias } from '../lib/core/identity.js';
import { loadStore, getCharactersDict } from '../lib/agents/agentStore.js';
import { loadProfile, saveProfile, updateStreak } from '../lib/profile.js';
import { applyKarma, KARMA_EVENTS, getTier } from '../lib/reputation.js';
import * as vaultLib from '../lib/vault.js';
import { DEFAULT_CATALOG } from '../lib/cosmetics.js';
import { purchaseItem, equipItem, unequipItem, isAvailable, getEquippedClasses } from '../lib/cosmetics.js';
import { createJackpotState, addRake } from '../lib/jackpot.js';
import { setMinKarmaToPost } from '../lib/deaddrops.js';
import {
    CHAOS_PERSONALITIES, SILENCE_TIMEOUT_MS, pickChaosMessage,
    nextPersonality, ROOM_CONSTRAINTS, validateConstraint, filterEmojiOnly,
} from '../lib/chaosAgent.js';

const MENTION_REGEX = /(@\w+)/g;

const POKE_TYPES_MAP = {
    snowball: '\u2744\uFE0F', siren: '\uD83D\uDEA8', wave: '\uD83D\uDC4B', heart: '\uD83D\uDC96', thunder: '\u26A1', confetti: '\uD83C\uDF89',
};
const POKE_COOLDOWN_MS = 10_000;

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

export default function ChatRoom({ nick: initialNick, isAdmin: initialIsAdmin, connectionConfig = { mode: 'relay' }, onLogout, isCliMode, cliHost }) {
    // Dynamic agent characters from store (for @mention matching) — memoized to avoid rebuild every render
    const CHARACTERS = useMemo(() => getCharactersDict(loadStore()), []);

    const [messages, setMessages] = useState(() => loadMessages());
    const [input, setInput] = useState('');
    const [peers, setPeers] = useState([]);
    const [rooms, setRooms] = useState([]);
    const [currentRoom, setCurrentRoom] = useState(() => localStorage.getItem('openwire_current_room') || null);
    const [connected, setConnected] = useState(false);
    const [myWallet, setMyWallet] = useState(null);

    // Games
    const [activeGame, setActiveGame] = useState(null);       // Tic-Tac-Toe
    // Blackjack, Roulette, Andar Bahar, Polymarket — managed by extracted hooks (see below)

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

    // Ready-Up tracking (keyed by game type: { roulette: Set, blackjack: Set, andarbahar: Set })
    const [readyPeers, setReadyPeers] = useState({ roulette: new Set(), blackjack: new Set(), andarbahar: new Set() });
    const readyPeersRef = useRef(readyPeers);
    useEffect(() => { readyPeersRef.current = readyPeers; }, [readyPeers]);

    const clearReadyPeers = useCallback((gameType) => {
        setReadyPeers(prev => ({ ...prev, [gameType]: new Set() }));
    }, []);

    // New features: Vault, Dead Drops, Cosmetics, Tambola, Profile, Jackpot
    const [showVault, setShowVault] = useState(false);
    const [showDeadDrops, setShowDeadDrops] = useState(false);
    const [showCosmetics, setShowCosmetics] = useState(false);
    const [tambolaGame, setTambolaGame] = useState(false);
    const [showSlots, setShowSlots] = useState(false);
    // mysteryGame state is now managed by useMysteryGame hook
    const [showKarmaGuide, setShowKarmaGuide] = useState(false);
    const [profile, setProfile] = useState(null);
    const peerCosmeticsRef = useRef({}); // peer_id → { bubbleStyle, nameColor, chatFlair }
    const [catalog, setCatalog] = useState(DEFAULT_CATALOG);
    const [jackpotPool, setJackpotPool] = useState(() => createJackpotState('general'));

    // Pop-Culture Agent Swarm
    const [showAgentPanel, setShowAgentPanel] = useState(false);
    const [agentRunning, setAgentRunning] = useState(false);
    const [mentionToasts, setMentionToasts] = useState([]);
    const [activePoke, setActivePoke] = useState(null);
    const pokeCooldownsRef = useRef({});
    const [agentTyping, setAgentTyping] = useState({});   // { characterId: { nick, avatar, ts } }
    const swarmLogsRef = useRef([]);
    const swarmRef = useRef(null);
    // Per-user muted agents (localStorage-backed)
    const [mutedAgents, setMutedAgents] = useState(() => {
        try { return JSON.parse(localStorage.getItem('openwire_muted_agents')) || {}; }
        catch { return {}; }
    });
    const [showMuteMenu, setShowMuteMenu] = useState(false);
    const muteMenuRef = useRef(null);
    const [sidebarOpen, setSidebarOpen] = useState(false);

    // ── Chaos Agent ───────────────────────────────────────────
    const [chaosEnabled, setChaosEnabled] = useState(false);
    const [chaosPersonality, setChaosPersonality] = useState('instigator');
    const chaosTimerRef = useRef(null);
    const lastMessageTimeRef = useRef(Date.now());

    // ── Room Constraints ──────────────────────────────────────
    const [roomConstraint, setRoomConstraint] = useState(null); // '5word' | 'emoji' | 'nobackspace' | null

    const allAgentsMuted = Object.keys(CHARACTERS).length > 0 && Object.keys(CHARACTERS).every(id => mutedAgents[id]);

    // Close mute menu on outside click
    useEffect(() => {
        if (!showMuteMenu) return;
        const handler = (e) => {
            if (muteMenuRef.current && !muteMenuRef.current.contains(e.target)) setShowMuteMenu(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [showMuteMenu]);

    const toggleMuteAgent = useCallback((charId) => {
        setMutedAgents(prev => {
            const next = { ...prev, [charId]: !prev[charId] };
            localStorage.setItem('openwire_muted_agents', JSON.stringify(next));
            return next;
        });
    }, []);

    const toggleMuteAll = useCallback(() => {
        setMutedAgents(prev => {
            const allMuted = Object.keys(CHARACTERS).every(id => prev[id]);
            const next = {};
            Object.keys(CHARACTERS).forEach(id => { next[id] = !allMuted; });
            localStorage.setItem('openwire_muted_agents', JSON.stringify(next));
            return next;
        });
    }, [CHARACTERS]);

    const isAgentMuted = useCallback((msg) => {
        if (!msg.isAgent || !msg.characterId) return false;
        return !!mutedAgents[msg.characterId];
    }, [mutedAgents]);

    const filteredMessages = useMemo(() =>
        messages.filter(m => m.roomId === (currentRoom || null) && !isAgentMuted(m)),
        [messages, currentRoom, mutedAgents]
    );

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

    // @mention autocomplete
    const [mentionQuery, setMentionQuery] = useState(null); // null = closed, '' = show all
    const [mentionIndex, setMentionIndex] = useState(0);
    const [mentionSuggestions, setMentionSuggestions] = useState([]);
    const inputRef = useRef(null);

    // Debug mode
    const [debugMode, setDebugMode] = useState(() => localStorage.getItem('openwire_debug') === 'true');
    const debugModeRef = useRef(debugMode);
    useEffect(() => { debugModeRef.current = debugMode; }, [debugMode]);

    const myIdRef = useRef(null);
    const nickRef = useRef(initialNick);
    const isAdminRef = useRef(initialIsAdmin);
    const activeGameRef = useRef(null);
    const roomsRef = useRef([]);
    const peersRef = useRef([]);
    const currentRoomRef = useRef(null);
    const walletRef = useRef(null);

    // Stable ref for WebSocket event handler (avoids reconnect cascades)
    const onWsEventRef = useRef(null);

    useEffect(() => { activeGameRef.current = activeGame; }, [activeGame]);
    useEffect(() => { roomsRef.current = rooms; }, [rooms]);
    useEffect(() => { peersRef.current = peers; }, [peers]);
    useEffect(() => { currentRoomRef.current = currentRoom; }, [currentRoom]);
    useEffect(() => { walletRef.current = myWallet; }, [myWallet]);

    // Save messages on a fixed 5s interval via ref — prevents debounce starvation
    // when high message rates keep resetting the old setTimeout
    const messagesRef = useRef(messages);
    useEffect(() => { messagesRef.current = messages; }, [messages]);
    useEffect(() => {
        const timer = setInterval(() => saveMessages(messagesRef.current), 5000);
        return () => clearInterval(timer);
    }, []);

    // ── Typing peer cleanup (stale after 3s) ─────────────────
    useEffect(() => {
        const cleanup = setInterval(() => {
            const cutoff = Date.now() - 3000;
            setTypingPeers(prev => {
                // Avoid Object.fromEntries/Object.entries GC thrashing —
                // mutate-then-shallow-copy only when stale entries exist
                let dirty = false;
                for (const key in prev) {
                    if (prev[key].ts <= cutoff) { dirty = true; break; }
                }
                if (!dirty) return prev;
                const next = {};
                for (const key in prev) {
                    if (prev[key].ts > cutoff) next[key] = prev[key];
                }
                return next;
            });
        }, 1000);
        return () => clearInterval(cleanup);
    }, []);

    // ── addMsg — declared here so screenshot useEffect below can reference it
    const addMsg = useCallback((sender, content, type = 'chat', extra = {}) => {
        // Cap React messages at 1000 to prevent DOM memory leak from rapid agent chatter
        setMessages(prev => {
            const capped = prev.length > 1200 ? prev.slice(-1000) : prev;
            return [...capped, {
                time: timeStr(), sender, content, type,
                id: Date.now() + Math.random(),
                ts: Date.now(),
                roomId: currentRoomRef.current || null,
                reactions: {},
                ...extra,
            }];
        });
        // Reset chaos agent silence timer on every message
        lastMessageTimeRef.current = Date.now();
        // Feed real chat messages into swarm context (only general chat, not rooms or game messages)
        if ((type === 'self' || type === 'peer') && content && !extra?.isAgent && !extra?.roomId) {
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

    // ── Chaos Agent silence timer ──────────────────────────────
    useEffect(() => {
        if (!chaosEnabled) { clearInterval(chaosTimerRef.current); return; }
        chaosTimerRef.current = setInterval(() => {
            const elapsed = Date.now() - lastMessageTimeRef.current;
            if (elapsed >= SILENCE_TIMEOUT_MS) {
                const msg = pickChaosMessage(chaosPersonality);
                const p = CHAOS_PERSONALITIES[chaosPersonality];
                addMsg(`${p.emoji} ${p.name}`, msg, 'system');
                lastMessageTimeRef.current = Date.now(); // reset after posting
            }
        }, 5000); // check every 5s
        return () => clearInterval(chaosTimerRef.current);
    }, [chaosEnabled, chaosPersonality, addMsg]);

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

    // ── Room switch cleanup: stop timers, reset game state ──
    const cleanupGameState = useCallback(() => {
        // Clear all game timers
        if (rouletteTimerRef.current) { clearInterval(rouletteTimerRef.current); rouletteTimerRef.current = null; }
        if (rouletteSpinTimeoutRef.current) { clearTimeout(rouletteSpinTimeoutRef.current); rouletteSpinTimeoutRef.current = null; }
        if (rouletteResultTimeoutRef.current) { clearTimeout(rouletteResultTimeoutRef.current); rouletteResultTimeoutRef.current = null; }
        if (abDealTimerRef.current) { clearInterval(abDealTimerRef.current); abDealTimerRef.current = null; }
        if (abCycleTimerRef.current) { clearTimeout(abCycleTimerRef.current); abCycleTimerRef.current = null; }
        abGenRef.current++;
        if (bjDealerTimerRef.current) { clearTimeout(bjDealerTimerRef.current); bjDealerTimerRef.current = null; }
        if (snapshotTimerRef.current) { clearInterval(snapshotTimerRef.current); snapshotTimerRef.current = null; }
        // Reset game states
        setBlackjackGame(null);
        setRouletteGame(null);
        setAndarBaharGame(null);
        setPolymarketGame(null);
        setActiveGame(null);
        setMysteryGame(null);
        // Reset host refs
        bjHostRef.current = null;
        rouletteHostRef.current = null;
        abHostRef.current = null;
        pmHostRef.current = null;
        mysteryHostRef.current = null;
        // Reset consent flags
        hasJoinedBj.current = false;
        hasJoinedRl.current = false;
        hasJoinedAb.current = false;
        hasJoinedPm.current = false;
        hasJoinedMystery.current = false;
        // Clear ready peers
        setReadyPeers({ roulette: new Set(), blackjack: new Set(), andarbahar: new Set() });
    }, []);

    useEffect(() => {
        if (currentRoom) {
            localStorage.setItem('openwire_current_room', currentRoom);
        } else {
            localStorage.removeItem('openwire_current_room');
            localStorage.removeItem('openwire_current_room_name');
            cleanupGameState();
        }
    }, [currentRoom, cleanupGameState]);

    // ── Wallet + Profile init ─────────────────────────────────
    useEffect(() => {
        if (initialNick) {
            const w = wallet.loadWallet(initialNick);
            setMyWallet(w);
            walletRef.current = w;
            // Load persistent profile (reputation, vault, cosmetics, streak)
            const p = loadProfile(initialNick);
            const pUpdated = updateStreak(p);
            if (pUpdated !== p) saveProfile(pUpdated);
            setProfile(pUpdated);
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

    // ── Swarm host election: admin gets priority, otherwise oldest peer (lowest id) ──
    const shouldRunSwarm = useCallback(() => {
        // Opt-in only — swarm is OFF by default; user must enable it via the agent panel
        if (!localStorage.getItem('openwire:swarm_enabled')) return false;
        const peers = peersRef.current;
        const myId = myIdRef.current;
        if (!myId) return false;

        // Collect admin peer_ids from relay data
        const adminIds = peers.filter(p => p.is_admin).map(p => p.peer_id);

        if (isAdminRef.current) {
            // Among multiple admins, lowest peer_id wins to prevent duplicate swarms
            const allAdmins = [...new Set([...adminIds, myId])].sort();
            return allAdmins[0] === myId;
        }

        // Non-admins only host if NO admins are online (fallback)
        if (adminIds.length > 0) return false;

        const allIds = peers.map(p => p.peer_id).filter(Boolean);
        if (!allIds.length) return false;
        const sorted = [...allIds].sort();
        return sorted[0] === myId;
    }, []);

    // ── Agent Swarm bootstrap (always load module, only start if elected host) ──
    const swarmHostRef = useRef(false); // tracks whether this session is the active swarm host
    useEffect(() => {
        let cancelled = false;
        import('../lib/agents/swarm.js').then(({ AgentSwarm }) => {
        if (cancelled) return;
        const swarm = new AgentSwarm({
            onMessage: (characterId, nick, avatar, text) => {
                const displayNick = `${avatar} ${nick}`;
                // Always add to general chat (roomId: null) regardless of host's current view
                addMsg(displayNick, text, 'peer', {
                    roomId: null,
                    isAgent: true,
                    characterId,
                });
                // Broadcast to other sessions via general chat relay
                socket.sendChat(JSON.stringify({
                    type: 'agent_message',
                    nick: displayNick,
                    text,
                    characterId,
                }));
                // Feed back into context — mark as agent since this came from our own swarm
                swarm.addContext(nick, text, true);
            },
            onError: (msg) => {
                console.warn('[AgentSwarm]', msg);
                if (debugModeRef.current) addMsg('🔧', `[AI Error] ${msg}`, 'system');
            },
            onModelLoad: () => setAgentRunning(true),
            onLog: (line) => {
                // Mutate in place to avoid spread-copy GC pressure on every log line
                let logs = swarmLogsRef.current;
                if (logs.length >= 200) { logs = logs.slice(-199); swarmLogsRef.current = logs; }
                logs.push(line);
                if (debugModeRef.current) console.log('[AgentSwarm]', line);
            },
            onTyping: (characterId, nick, avatar, isTyping) => {
                if (isTyping) {
                    setAgentTyping(prev => ({ ...prev, [characterId]: { nick, avatar, ts: Date.now() } }));
                } else {
                    setAgentTyping(prev => {
                        const next = { ...prev };
                        delete next[characterId];
                        return next;
                    });
                }
            },
        });
        // Broadcast context summaries to peers when compaction runs
        swarm.onSummaryUpdate = (summary) => {
            socket.sendChat(JSON.stringify({
                type: 'context_summary',
                summary,
            }));
        };
        swarmRef.current = swarm;
        // Only start if this session is the elected swarm host
        const hostCheck = shouldRunSwarm();
        console.log('[SwarmElection] Bootstrap check:', { hostCheck, isAdmin: isAdminRef.current, myId: myIdRef.current, peers: peersRef.current?.length });
        if (hostCheck) {
            swarmHostRef.current = true;
            swarm.start().catch(e => console.warn('[AgentSwarm] auto-start failed:', e));
        }
        }); // end dynamic import
        return () => {
            cancelled = true;
            swarmRef.current?.stop();
            swarmRef.current = null;
            swarmHostRef.current = false;
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Re-evaluate swarm host on peer changes ──
    useEffect(() => {
        if (!swarmRef.current) return;
        const isHost = shouldRunSwarm();
        if (isHost && !swarmHostRef.current) {
            // This session just became the elected host — start the swarm
            swarmHostRef.current = true;
            swarmRef.current.start().catch(e => console.warn('[AgentSwarm] host-takeover start failed:', e));
            console.log('[SwarmElection] This session is now the swarm host');
        } else if (!isHost && swarmHostRef.current) {
            // Another session should host — stop our swarm
            swarmHostRef.current = false;
            swarmRef.current.stop();
            setAgentRunning(false);
            console.log('[SwarmElection] Swarm host moved to another session');
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [peers]);

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
    const lastSettledRoundRef = useRef(new Set());
    const resolvePayoutEvent = useCallback((event, myId, walletObj) => {
        // Idempotency: prevent double-processing the same round
        const roundKey = `${event.gameType}-${event.roundId}`;
        if (lastSettledRoundRef.current.has(roundKey)) return walletObj;
        lastSettledRoundRef.current.add(roundKey);
        // Cap the set to prevent unbounded growth
        if (lastSettledRoundRef.current.size > 50) {
            const first = lastSettledRoundRef.current.values().next().value;
            lastSettledRoundRef.current.delete(first);
        }
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
        // Award karma for game wins (net > 0 means the player profited)
        if (net > 0) {
            setProfile(prev => {
                if (!prev) return prev;
                const newRep = applyKarma(
                    prev.reputation ?? { karma: 0, tier: 'newcomer', history: [] },
                    KARMA_EVENTS.GAME_WIN,
                    { gameType: event.gameType },
                );
                const updated = { ...prev, reputation: newRep };
                saveProfile(updated);
                return updated;
            });
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

    // ── P2P host election ────────────────────────────────────
    const amIHost = useCallback((hostPeerId) => {
        return myIdRef.current && myIdRef.current === hostPeerId;
    }, []);

    // ── Game hooks (extracted from ChatRoom) ─────────────────
    const gameDeps = useMemo(() => ({ myIdRef, nickRef, walletRef, swarmRef, addMsg, updateWallet, amIHost, updateBankLedger, resolvePayoutEvent, addActivityLog }), [addMsg, updateWallet, amIHost, updateBankLedger, resolvePayoutEvent, addActivityLog]);

    const {
        blackjackGame, setBlackjackGame,
        blackjackRef, bjHostRef, hasJoinedBj, bjDealerTimerRef, bjTurnTimerRef, bjDealerTransitionTimerRef,
        startBlackjackTimer, startTurnTimer, bjCheckDealerTransition,
        handleBlackjackAction, startBlackjack, handleBjAction,
    } = useBlackjackGame(gameDeps);

    const {
        rouletteGame, setRouletteGame,
        rouletteRef, rouletteHostRef, hasJoinedRl,
        rouletteTimerRef, rouletteSpinTimeoutRef, rouletteResultTimeoutRef,
        startRouletteTimer, handleRouletteAction,
        startRoulette, handleRlAction,
    } = useRouletteGame(gameDeps);

    const {
        andarBaharGame, setAndarBaharGame,
        andarBaharRef, abHostRef, hasJoinedAb,
        abDealTimerRef, abCycleTimerRef, abGenRef,
        startAbCycle, handleAndarBaharAction,
        startAndarBahar, handleAbAction,
    } = useAndarBaharGame(gameDeps);

    const {
        polymarketGame, setPolymarketGame,
        polymarketRef, pmHostRef, hasJoinedPm,
        handlePolymarketAction, startPolymarket, handlePmAction,
    } = usePolymarketGame(gameDeps);

    const {
        mysteryGame, setMysteryGame,
        mysteryRef, mysteryHostRef, hasJoinedMystery,
        handleMysteryAction, startMystery, handleMysteryLocalAction,
    } = useMysteryGame(gameDeps);

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
                socket.sendRoomMessage(inviteData.room_id, JSON.stringify({
                    type: 'game_join', gameType: 'roulette', peer_id: myId, nick: myNick,
                }));
                addMsg('★', '🎰 Joined Roulette room!', 'system');
                break;
            case 'andarbahar':
                hasJoinedAb.current = true;
                abHostRef.current = inviteData.host;
                socket.sendRoomMessage(inviteData.room_id, JSON.stringify({
                    type: 'game_join', gameType: 'andarbahar', peer_id: myId, nick: myNick,
                }));
                addMsg('★', '🃏 Joined Andar Bahar table!', 'system');
                break;
            case 'polymarket':
                hasJoinedPm.current = true;
                pmHostRef.current = inviteData.host;
                socket.sendRoomMessage(inviteData.room_id, JSON.stringify({
                    type: 'game_join', gameType: 'polymarket', peer_id: myId, nick: myNick,
                }));
                addMsg('★', '📊 Joined Predictions market!', 'system');
                break;
            case 'mystery':
                hasJoinedMystery.current = true;
                mysteryHostRef.current = inviteData.host;
                socket.sendRoomMessage(inviteData.room_id, mystery.serializeMysteryAction({
                    type: 'mm_join', peer_id: myId, nick: myNick,
                }));
                socket.sendRoomMessage(inviteData.room_id, JSON.stringify({
                    type: 'game_join', gameType: 'mystery', peer_id: myId, nick: myNick,
                }));
                addMsg('\u2605', '\uD83D\uDD0D Joined Murder Mystery!', 'system');
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
                addMsg('\u2605', '\uD83C\uDFAE Game accepted!', 'system');
                break;
            }
        }
        setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, inviteUsed: true } : m));
    }, [addMsg]);

    const dismissInvite = useCallback((msgId) => {
        setMessages(prev => prev.map(m => m.id === msgId ? { ...m, inviteUsed: true } : m));
    }, []);

    // ── Timer cleanup on unmount ──
    useEffect(() => {
        return () => {
            if (snapshotTimerRef.current) clearInterval(snapshotTimerRef.current);
        };
    }, []);

    // ── Host state snapshot (periodic backup for host migration) ──
    const snapshotTimerRef = useRef(null);

    useEffect(() => {
        // Every 5 seconds, if we're host of any game, send a snapshot to the relay
        snapshotTimerRef.current = setInterval(() => {
            const roomId = currentRoomRef.current;
            if (!roomId) return;

            const snapshots = {};
            if (rouletteRef.current && amIHost(rouletteHostRef.current)) {
                snapshots.roulette = rl.serializeGame(rouletteRef.current);
            }
            if (blackjackRef.current && amIHost(bjHostRef.current)) {
                snapshots.blackjack = bj.serializeGame(blackjackRef.current);
            }
            if (andarBaharRef.current && amIHost(abHostRef.current)) {
                snapshots.andarbahar = ab.serializeGame(andarBaharRef.current);
            }
            if (polymarketRef.current && amIHost(pmHostRef.current)) {
                snapshots.polymarket = pm.serializeGame(polymarketRef.current);
            }

            if (Object.keys(snapshots).length > 0) {
                socket.sendStateSnapshot(roomId, snapshots);
            }
        }, 5000);

        return () => {
            if (snapshotTimerRef.current) clearInterval(snapshotTimerRef.current);
        };
    }, [amIHost]);

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
            case 'poke':
                if (action.to === myId) {
                    setActivePoke({ from_nick: action.from_nick, poke_type: action.poke_type });
                    addMsg('👊', `${action.from_nick} poked you with ${POKE_TYPES_MAP[action.poke_type] || '👋'}!`, 'system');
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
                        roomId: msg.room_id || null, isAgent: true, characterId: action.characterId,
                    });
                    // Pass forceIsAgent=true to prevent P2P emoji-nick loop
                    swarmRef.current?.addContext(action.nick, action.text, true);
                }
                break;
            case 'context_summary':
                // Receive compacted context summary from swarm host
                if (msg.peer_id !== myIdRef.current) {
                    swarmRef.current?.loadSummary(action.summary);
                }
                break;
            case 'admin_announce':
                // Mark peer as admin in local state (client-side dedup for swarm host election)
                if (action.peer_id && action.peer_id !== myIdRef.current) {
                    setPeers(prev => prev.map(p =>
                        p.peer_id === action.peer_id ? { ...p, is_admin: true } : p
                    ));
                }
                break;
            case 'admin_adjust_balance':
                // Only apply if we are the target — sender applies it locally, others ignore
                if (action.peer_id === myIdRef.current && msg.peer_id !== myIdRef.current && walletRef.current) {
                    const updated = wallet.adminAdjust(walletRef.current, action.delta, action.reason);
                    updateWallet(updated);
                    addMsg('★', `💰 Admin ${action.delta > 0 ? 'added' : 'deducted'} ${Math.abs(action.delta)} chips (${action.reason})`, 'system');
                }
                break;
            case 'admin_adjust_karma':
                if (action.peer_id === myIdRef.current && msg.peer_id !== myIdRef.current) {
                    setProfile(prev => {
                        if (!prev) return prev;
                        const currentKarma = prev.reputation?.karma ?? 0;
                        const newKarma = Math.max(0, currentKarma + action.delta);
                        const tier = getTier(newKarma).name;
                        const history = [
                            { eventType: 'admin_adjust', delta: action.delta, reason: action.reason, timestamp: Date.now(), data: {} },
                            ...(prev.reputation?.history ?? []),
                        ].slice(0, 50);
                        const updated = { ...prev, reputation: { karma: newKarma, tier, history } };
                        saveProfile(updated);
                        return updated;
                    });
                    addMsg('★', `⭐ Admin ${action.delta > 0 ? 'added' : 'removed'} ${Math.abs(action.delta)} karma`, 'system');
                }
                break;
            case 'mention_notify':
                if (action.to === myId) {
                    const toastId = Date.now() + Math.random();
                    setMentionToasts(prev => [...prev, { id: toastId, from: action.from_nick, text: action.text }]);
                    setTimeout(() => setMentionToasts(prev => prev.filter(t => t.id !== toastId)), 5000);
                }
                break;
            case 'ready_up': {
                const gameType = action.gameType; // 'roulette' | 'blackjack' | 'andarbahar'
                const peerId = action.peer_id || msg.peer_id;
                setReadyPeers(prev => {
                    const next = { ...prev };
                    next[gameType] = new Set(prev[gameType]);
                    next[gameType].add(peerId);
                    return next;
                });
                break;
            }
            case 'game_new_round': {
                // Skip if this is our own broadcast (host already processed locally)
                if (action.peer_id === myIdRef.current) break;
                // Any player can request a new round — host processes it
                const gt = action.gameType;
                if (gt === 'blackjack' && amIHost(bjHostRef.current)) {
                    const current = blackjackRef.current;
                    if (current && current.phase !== 'betting' && current.phase !== 'playing') {
                        if (bjTurnTimerRef.current) { clearTimeout(bjTurnTimerRef.current); bjTurnTimerRef.current = null; }
                        const newGame = bj.newRound(current);
                        setBlackjackGame(newGame);
                        clearReadyPeers('blackjack');
                        socket.sendRoomMessage(newGame.roomId, bj.serializeBlackjackAction({ type: 'bj_state', state: bj.serializeGame(newGame) }));
                        startBlackjackTimer(newGame);
                    }
                } else if (gt === 'roulette' && amIHost(rouletteHostRef.current)) {
                    const current = rouletteRef.current;
                    if (current && current.phase !== 'betting') {
                        if (rouletteTimerRef.current) { clearInterval(rouletteTimerRef.current); rouletteTimerRef.current = null; }
                        clearTimeout(rouletteSpinTimeoutRef.current);
                        clearTimeout(rouletteResultTimeoutRef.current);
                        const reset = rl.newRound(current);
                        setRouletteGame(reset);
                        clearReadyPeers('roulette');
                        socket.sendRoomMessage(reset.roomId, rl.serializeRouletteAction({ type: 'rl_state', state: rl.serializeGame(reset) }));
                    }
                } else if (gt === 'andarbahar' && amIHost(abHostRef.current)) {
                    const current = andarBaharRef.current;
                    if (current && current.phase !== 'betting') {
                        if (abCycleTimerRef.current) clearTimeout(abCycleTimerRef.current);
                        if (abDealTimerRef.current) { clearInterval(abDealTimerRef.current); abDealTimerRef.current = null; }
                        abGenRef.current++;
                        const reset = ab.newRound(current);
                        setAndarBaharGame(reset);
                        clearReadyPeers('andarbahar');
                        socket.sendRoomMessage(reset.roomId, ab.serializeAndarBaharAction({ type: 'ab_state', state: ab.serializeGame(reset) }));
                        startAbCycle(reset);
                    }
                }
                break;
            }
            case 'game_join': {
                // A peer joined a game — host broadcasts current state so they see the board
                const joinSenderId = msg.peer_id || msg.from;
                if (joinSenderId === myIdRef.current) break;
                addMsg('★', `🎮 ${action.nick} joined ${action.gameType}!`, 'system');
                const gt = action.gameType;
                if (gt === 'roulette' && amIHost(rouletteHostRef.current) && rouletteRef.current) {
                    setTimeout(() => {
                        socket.sendRoomMessage(rouletteRef.current.roomId, rl.serializeRouletteAction({ type: 'rl_state', state: rl.serializeGame(rouletteRef.current) }));
                    }, 100);
                } else if (gt === 'andarbahar' && amIHost(abHostRef.current) && andarBaharRef.current) {
                    setTimeout(() => {
                        socket.sendRoomMessage(andarBaharRef.current.roomId, ab.serializeAndarBaharAction({ type: 'ab_state', state: ab.serializeGame(andarBaharRef.current) }));
                    }, 100);
                } else if (gt === 'polymarket' && amIHost(pmHostRef.current) && polymarketRef.current) {
                    setTimeout(() => {
                        socket.sendRoomMessage(polymarketRef.current.roomId, pm.serializePolymarketAction({ type: 'pm_state', state: pm.serializeGame(polymarketRef.current) }));
                    }, 100);
                } else if (gt === 'mystery' && amIHost(mysteryHostRef.current) && mysteryRef.current) {
                    // Add the player directly (belt-and-suspenders with mm_join)
                    setMysteryGame(prev => {
                        if (!prev) return prev;
                        if (prev.players.some(p => p.peer_id === action.peer_id)) {
                            // Already joined — just broadcast current state
                            setTimeout(() => {
                                socket.sendRoomMessage(prev.roomId, mystery.serializeMysteryAction({ type: 'mm_state', state: mystery.serializeGame(prev) }));
                            }, 100);
                            return prev;
                        }
                        const updated = mystery.addPlayer(prev, action.peer_id, action.nick);
                        setTimeout(() => {
                            socket.sendRoomMessage(updated.roomId, mystery.serializeMysteryAction({ type: 'mm_state', state: mystery.serializeGame(updated) }));
                        }, 100);
                        return updated;
                    });
                }
                break;
            }
            case 'swarm_config':
                // Admin broadcast — apply provider/model changes to local swarm
                if (msg.peer_id !== myIdRef.current && swarmRef.current) {
                    if (action.provider) {
                        swarmRef.current.setProvider(action.provider);
                    }
                    if (action.defaultModel) {
                        swarmRef.current.defaultModel = action.defaultModel;
                    }
                }
                break;
            case 'admin_setting':
                // Admin broadcast a setting change — apply locally
                if (action.key === 'dead_drop_min_karma' && typeof action.value === 'number') {
                    setMinKarmaToPost(action.value);
                } else if (action.key === 'gif_provider' && typeof action.value === 'string') {
                    try { localStorage.setItem('openwire:gif_provider', action.value); } catch {}
                }
                break;
        }
    }, [addMsg, addReaction, addTicker, updateWallet, amIHost, clearReadyPeers, startBlackjackTimer]);

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

    // ── WebSocket event handler (ref-stable to avoid reconnect cascades) ──
    onWsEventRef.current = (msg) => {
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
                // Load existing peers' cosmetics
                for (const p of (msg.peers || [])) {
                    if (p.cosmetics) peerCosmeticsRef.current[p.peer_id] = p.cosmetics;
                }
                addMsg('★', `Connected! Your ID: ${msg.peer_id}`, 'system');
                addMsg('★', 'Type /help for commands.', 'system');

                // Auto-join previously saved room if exists
                {
                    const savedRoom = localStorage.getItem('openwire_current_room');
                    if (savedRoom) {
                        socket.joinRoom(savedRoom);
                        addMsg('★', `Auto-joined saved room.`, 'system');
                    }
                }

                // Broadcast wallet balance + cosmetics
                if (walletRef.current) {
                    setTimeout(() => socket.send({ type: 'balance_update', balance: wallet.getTotalBalance(walletRef.current) }), 500);
                }
                // Broadcast equipped cosmetics so peers see our style
                setTimeout(() => {
                    const p = profile || (initialNick ? loadProfile(initialNick) : null);
                    if (p) {
                        const cos = getEquippedClasses(p);
                        socket.send({ type: 'cosmetics_update', cosmetics: cos });
                    }
                }, 800);
                // Fetch ban list and broadcast admin status if admin
                if (isAdminRef.current) {
                    setTimeout(() => socket.send({ type: 'admin_get_bans' }), 600);
                    // Broadcast admin status so other clients can deduplicate swarm hosts
                    setTimeout(() => socket.sendChat(JSON.stringify({ type: 'admin_announce', peer_id: msg.peer_id })), 700);
                }
                break;
            case 'peers':
                setPeers(msg.peers || []);
                if (msg.rooms) setRooms(msg.rooms);
                break;
            case 'peer_balance_update':
                // Lightweight balance diff — update single peer instead of replacing entire list
                setPeers(prev => prev.map(p =>
                    p.peer_id === msg.peer_id ? { ...p, balance: msg.balance } : p
                ));
                break;
            case 'peer_cosmetics_update':
                // Store peer's cosmetics for rendering their chat messages
                if (msg.peer_id && msg.cosmetics) {
                    peerCosmeticsRef.current = { ...peerCosmeticsRef.current, [msg.peer_id]: msg.cosmetics };
                }
                break;
            case 'tip_received':
                // Direct message from relay (someone tipped us)
                if (msg.amount && walletRef.current) {
                    const updated = wallet.credit(walletRef.current, msg.amount, `Tip from ${msg.from_nick}`);
                    updateWallet(updated);
                    addMsg('💸', `${msg.from_nick} sent you ${msg.amount} chips!`, 'system');
                }
                break;
            case 'admin_adjust_balance':
                // Direct message from relay (admin adjusted our balance)
                if (msg.delta !== undefined && walletRef.current) {
                    const updated = wallet.adminAdjust(walletRef.current, msg.delta, msg.reason || 'Admin adjustment');
                    updateWallet(updated);
                    addMsg('★', `💰 Admin ${msg.delta > 0 ? 'added' : 'deducted'} ${Math.abs(msg.delta)} chips (${msg.reason || 'Admin adjustment'})`, 'system');
                }
                break;
            case 'peer_joined':
                setPeers(prev => [...prev.filter(p => p.peer_id !== msg.peer_id), { peer_id: msg.peer_id, nick: msg.nick, is_admin: msg.is_admin || false, is_bridge: msg.is_bridge || false, ip: msg.ip || null, geo: msg.geo || null }]);
                addMsg('★', `${msg.nick} joined`, 'system');
                break;
            case 'peer_left':
                setPeers(prev => prev.filter(p => p.peer_id !== msg.peer_id));
                delete peerCosmeticsRef.current[msg.peer_id];
                setReadyPeers(prev => {
                    const next = { ...prev };
                    for (const key of Object.keys(next)) {
                        if (next[key].has(msg.peer_id)) {
                            next[key] = new Set(next[key]);
                            next[key].delete(msg.peer_id);
                        }
                    }
                    return next;
                });
                addMsg('★', `${msg.nick} left`, 'system');
                break;
            case 'message': {
                // Try parsing custom JSON actions (mention_notify, agent_message, etc.)
                let msgCustom = null;
                if (msg.data?.startsWith('{')) {
                    try {
                        const parsed = JSON.parse(msg.data);
                        const CUSTOM = ['typing', 'react', 'tip', 'poke', 'screenshot_alert', 'casino_ticker', 'whisper', 'agent_message', 'mention_notify', 'swarm_config', 'context_summary', 'admin_announce', 'ready_up', 'game_new_round', 'game_join', 'admin_adjust_balance', 'admin_adjust_karma', 'admin_setting'];
                        if (CUSTOM.includes(parsed.type)) msgCustom = parsed;
                    } catch { /* not JSON */ }
                }
                if (msgCustom) {
                    handleCustomAction(msg, msgCustom);
                } else {
                    const cos = peerCosmeticsRef.current[msg.peer_id] || null;
                    const gifMatch = msg.data?.match(/^\[GIF\](.+)$/);
                    if (gifMatch) {
                        addMsg(msg.nick, '', 'peer', { gif: gifMatch[1], peerCosmetics: cos });
                    } else {
                        addMsg(msg.nick, msg.data, 'peer', { peerCosmetics: cos });
                        // Process @mentions from remote peers
                        if (msg.data) processMentions(msg.data, msg.nick);
                        if (msg.data && nickRef.current && msg.data.toLowerCase().includes(`@${nickRef.current.toLowerCase()}`)) {
                            const toastId = Date.now() + Math.random();
                            setMentionToasts(prev => [...prev, { id: toastId, from: msg.nick, text: msg.data }]);
                            setTimeout(() => setMentionToasts(prev => prev.filter(t => t.id !== toastId)), 5000);
                        }
                    }
                }
                break;
            }
            case 'room_created':
                setRooms(prev => {
                    const updated = [...prev, { room_id: msg.room_id, name: msg.name, members: 1 }];
                    roomsRef.current = updated;
                    return updated;
                });
                setCurrentRoom(msg.room_id);
                localStorage.setItem('openwire_current_room_name', msg.name);
                addMsg('★', `🏠 Room "${msg.name}" created! ID: ${msg.room_id}`, 'system');
                break;
            case 'room_joined':
                setRooms(prev => {
                    const updated = [...prev.filter(r => r.room_id !== msg.room_id), { room_id: msg.room_id, name: msg.name }];
                    roomsRef.current = updated;
                    return updated;
                });
                setCurrentRoom(msg.room_id);
                localStorage.setItem('openwire_current_room_name', msg.name);
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
                const isPmMsg = pm.isPolymarketMessage(msg.data);
                const isMmMsg = mystery.isMysteryMessage(msg.data);
                const isGameMsg = game.isGameMessage(msg.data);

                // Try custom JSON action first (typing, react, tip, whisper, ticker, screenshot)
                let customAction = null;
                if (!isBjMsg && !isRlMsg && !isAbMsg && !isPmMsg && !isMmMsg && !isGameMsg && msg.data?.startsWith('{')) {
                    try {
                        const parsed = JSON.parse(msg.data);
                        const CUSTOM = ['typing', 'react', 'tip', 'poke', 'screenshot_alert', 'casino_ticker', 'whisper', 'agent_message', 'mention_notify', 'swarm_config', 'context_summary', 'admin_announce', 'ready_up', 'game_new_round', 'game_join', 'admin_adjust_balance', 'admin_adjust_karma', 'admin_setting'];
                        if (CUSTOM.includes(parsed.type)) customAction = parsed;
                    } catch { /* not JSON */ }
                }

                if (customAction) {
                    handleCustomAction(msg, customAction);
                } else if (isGameMsg) {
                    const action = game.parseGameAction(msg.data);
                    if (action) handleGameAction(msg, action);
                } else if (isBjMsg) {
                    // Guard: only process BJ messages for the room we're playing in (or invites)
                    const action = bj.parseBlackjackAction(msg.data);
                    if (action && (action.type === 'bj_start' || !blackjackRef.current || blackjackRef.current.roomId === msg.room_id)) {
                        handleBlackjackAction(msg, action);
                    }
                } else if (isRlMsg) {
                    const action = rl.parseRouletteAction(msg.data);
                    if (action && (action.type === 'rl_start' || !rouletteRef.current || rouletteRef.current.roomId === msg.room_id)) {
                        handleRouletteAction(msg, action);
                    }
                } else if (isAbMsg) {
                    const action = ab.parseAndarBaharAction(msg.data);
                    if (action && (action.type === 'ab_start' || !andarBaharRef.current || andarBaharRef.current.roomId === msg.room_id)) {
                        handleAndarBaharAction(msg, action);
                    }
                } else if (isPmMsg) {
                    const action = pm.parsePolymarketAction(msg.data);
                    if (action && (action.type === 'pm_start' || !polymarketRef.current || polymarketRef.current.roomId === msg.room_id)) {
                        handlePolymarketAction(msg, action);
                    }
                } else if (isMmMsg) {
                    const action = mystery.parseMysteryAction(msg.data);
                    if (action && (action.type === 'mm_start' || !mysteryRef.current || mysteryRef.current.roomId === msg.room_id)) {
                        handleMysteryAction(msg, action);
                    }
                } else if (isCurrentRoom) {
                    const gifMatch = msg.data.match(/^\[GIF\](.+)$/);
                    if (gifMatch) {
                        const roomSenderId = msg.peer_id || msg.from;
                        addMsg(msg.nick, '', 'peer', { gif: gifMatch[1], roomId: msg.room_id, peerCosmetics: peerCosmeticsRef.current[roomSenderId] || null });
                    } else if (msg.data) {
                        const roomSenderId = msg.peer_id || msg.from;
                        addMsg(msg.nick, msg.data, 'peer', { roomId: msg.room_id, peerCosmetics: peerCosmeticsRef.current[roomSenderId] || null });
                        // Process @mentions from remote peers in rooms too
                        processMentions(msg.data, msg.nick);
                        // Check if we were @mentioned
                        if (nickRef.current && msg.data.toLowerCase().includes(`@${nickRef.current.toLowerCase()}`)) {
                            const toastId = Date.now() + Math.random();
                            setMentionToasts(prev => [...prev, { id: toastId, from: msg.nick, text: msg.data }]);
                            setTimeout(() => setMentionToasts(prev => prev.filter(t => t.id !== toastId)), 5000);
                        }
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
            case 'error':
                // If saved room was not found, auto-recreate it
                if (msg.message === 'Room not found' && msg.room_id) {
                    const savedName = localStorage.getItem('openwire_current_room_name');
                    if (savedName) {
                        addMsg('★', `🏠 Room expired — recreating "${savedName}"...`, 'system');
                        socket.createRoom(savedName);
                    } else {
                        localStorage.removeItem('openwire_current_room');
                        setCurrentRoom(null);
                    }
                } else {
                    addMsg('★', `⚠ ${msg.message}`, 'system');
                }
                break;

            // ── Host migration ───────────────────────────────────
            case 'host_left': {
                const myId = myIdRef.current;
                addMsg('★', `Host changed — new host elected`, 'system');

                // Restore game state from relay snapshot if available
                let snapshots = {};
                if (msg.gameSnapshots) {
                    try {
                        snapshots = typeof msg.gameSnapshots === 'string'
                            ? JSON.parse(msg.gameSnapshots)
                            : msg.gameSnapshots;
                    } catch {
                        addMsg('★', 'Game state could not be restored from previous host.', 'system');
                    }
                }

                // Roulette
                if (rouletteRef.current?.roomId === msg.room_id) {
                    rouletteHostRef.current = msg.new_host;
                    if (msg.new_host === myId) {
                        addMsg('★', 'You are now the Roulette host', 'system');
                        // Restore from snapshot if available
                        if (snapshots.roulette) {
                            const restored = rl.deserializeGame(snapshots.roulette);
                            if (restored) {
                                // Phase-aware recovery: stuck in spinning → reset to betting
                                if (restored.phase === 'spinning') {
                                    const reset = rl.newRound(restored);
                                    setRouletteGame(reset);
                                    socket.sendRoomMessage(msg.room_id, rl.serializeRouletteAction({ type: 'rl_state', state: rl.serializeGame(reset) }));
                                } else {
                                    setRouletteGame(restored);
                                }
                            }
                        } else {
                            // Fallback: use local state if no snapshot
                            const curRl = rouletteRef.current;
                            if (curRl && curRl.phase !== 'betting') {
                                const reset = rl.newRound(curRl);
                                setRouletteGame(reset);
                                socket.sendRoomMessage(msg.room_id, rl.serializeRouletteAction({ type: 'rl_state', state: rl.serializeGame(reset) }));
                            }
                        }
                        startRouletteTimer();
                    }
                }

                // Blackjack
                if (blackjackRef.current?.roomId === msg.room_id) {
                    bjHostRef.current = msg.new_host;
                    if (msg.new_host === myId) {
                        addMsg('★', 'You are now the Blackjack host', 'system');
                        if (snapshots.blackjack) {
                            const restored = bj.deserializeGame(snapshots.blackjack);
                            if (restored) {
                                // Phase-aware: if stuck in 'playing' or 'dealer', reset to new round
                                if (restored.phase === 'playing' || restored.phase === 'dealer') {
                                    const reset = bj.newRound(restored);
                                    setBlackjackGame(reset);
                                    socket.sendRoomMessage(msg.room_id, bj.serializeBlackjackAction({ type: 'bj_state', state: bj.serializeGame(reset) }));
                                    startBlackjackTimer(reset);
                                } else {
                                    setBlackjackGame(restored);
                                    if (restored.phase === 'betting') startBlackjackTimer(restored);
                                }
                            }
                        } else {
                            const curBj = blackjackRef.current;
                            if (curBj && curBj.phase === 'betting') startBlackjackTimer(curBj);
                        }
                    }
                }

                // Andar Bahar
                if (andarBaharRef.current?.roomId === msg.room_id) {
                    abHostRef.current = msg.new_host;
                    if (msg.new_host === myId) {
                        addMsg('★', 'You are now the Andar Bahar host', 'system');
                        if (snapshots.andarbahar) {
                            const restored = ab.deserializeGame(snapshots.andarbahar);
                            if (restored) {
                                // Phase-aware: stuck in 'dealing' → create new round (deck is lost anyway)
                                if (restored.phase === 'dealing') {
                                    const reset = ab.newRound(restored);
                                    setAndarBaharGame(reset);
                                    socket.sendRoomMessage(msg.room_id, ab.serializeAndarBaharAction({ type: 'ab_state', state: ab.serializeGame(reset) }));
                                    startAbCycle(reset);
                                } else {
                                    setAndarBaharGame(restored);
                                    startAbCycle(restored);
                                }
                            }
                        } else {
                            const curAb = andarBaharRef.current;
                            if (curAb) startAbCycle(curAb);
                        }
                    }
                }

                // Polymarket
                if (polymarketRef.current?.roomId === msg.room_id) {
                    pmHostRef.current = msg.new_host;
                    if (msg.new_host === myId) {
                        addMsg('★', 'You are now the Predictions host', 'system');
                        if (snapshots.polymarket) {
                            const restored = pm.deserializeGame(snapshots.polymarket);
                            if (restored) setPolymarketGame(restored);
                        }
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
            case 'rate_limited':
                // Server told us we're sending too fast — silently throttle
                break;

            case 'disconnected':
                setConnected(false);
                addMsg('★', '⚠ Disconnected — reconnecting...', 'system');
                break;

            case 'cli_node_connecting':
                addMsg('★', `Connecting to CLI node at ${msg.url}...`, 'system');
                break;

            case 'cli_node_fallback':
                addMsg('★', `CLI node unreachable — falling back to OpenWire Relay`, 'system');
                break;
        }
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => {
        const adminSecret = isAdminRef.current ? (localStorage.getItem('openwire_admin_secret') || '') : '';
        const opts = { isAdmin: isAdminRef.current, adminSecret };
        if (connectionConfig.mode === 'cli-node' && connectionConfig.cliUrl) {
            socket.connectToCliNode(connectionConfig.cliUrl, nickRef.current, (msg) => onWsEventRef.current?.(msg), opts);
        } else {
            socket.connect(nickRef.current, (msg) => onWsEventRef.current?.(msg), opts);
        }
        return () => socket.disconnect();
    }, []);

    useEffect(() => {
        if (gameChatEnd.current && showGameChat) {
            gameChatEnd.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages, showGameChat]);

    // Debounced auto-scroll — only if user is near bottom, uses rAF to avoid layout thrash
    useEffect(() => {
        const container = messagesEnd.current?.parentElement;
        if (!container) return;
        const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 150;
        if (!isNearBottom) return;
        const raf = requestAnimationFrame(() => {
            messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
        });
        return () => cancelAnimationFrame(raf);
    }, [messages]);

    // ── Invite handlers ──────────────────────────────────────
    const acceptInvite = (invite) => { socket.joinRoom(invite.room_id); setPendingInvites(prev => prev.filter(i => i.id !== invite.id)); };
    const declineInvite = (invite) => setPendingInvites(prev => prev.filter(i => i.id !== invite.id));

    // Game start/action handlers provided by extracted hooks:
    // startBlackjack, handleBjAction — useBlackjackGame
    // startRoulette, handleRlAction — useRouletteGame
    // startAndarBahar, handleAbAction — useAndarBaharGame
    // startPolymarket, handlePmAction — usePolymarketGame

    // ── Ready Up handler ────────────────────────────────────
    const handleReadyUp = useCallback((gameType) => {
        const myId = myIdRef.current;
        // Add self locally
        setReadyPeers(prev => {
            const next = { ...prev };
            next[gameType] = new Set(prev[gameType]);
            next[gameType].add(myId);
            return next;
        });
        // Broadcast to room
        const roomId = gameType === 'roulette' ? rouletteRef.current?.roomId
            : gameType === 'blackjack' ? blackjackRef.current?.roomId
            : andarBaharRef.current?.roomId;
        if (roomId) {
            socket.sendRoomMessage(roomId, JSON.stringify({
                type: 'ready_up', gameType, peer_id: myId,
            }));
        }
    }, []);

    const handleGameNewRound = useCallback((gameType) => {
        const roomId = gameType === 'roulette' ? rouletteRef.current?.roomId
            : gameType === 'blackjack' ? blackjackRef.current?.roomId
            : andarBaharRef.current?.roomId;
        if (roomId) {
            socket.sendRoomMessage(roomId, JSON.stringify({
                type: 'game_new_round', gameType, peer_id: myIdRef.current,
            }));
        }
        // If I am the host, also process locally
        const myId = myIdRef.current;
        if (gameType === 'blackjack' && amIHost(bjHostRef.current)) {
            const current = blackjackRef.current;
            if (current && current.phase !== 'betting' && current.phase !== 'playing') {
                if (bjTurnTimerRef.current) { clearTimeout(bjTurnTimerRef.current); bjTurnTimerRef.current = null; }
                const newGame = bj.newRound(current);
                setBlackjackGame(newGame);
                clearReadyPeers('blackjack');
                socket.sendRoomMessage(newGame.roomId, bj.serializeBlackjackAction({ type: 'bj_state', state: bj.serializeGame(newGame) }));
                startBlackjackTimer(newGame);
            }
        } else if (gameType === 'roulette' && amIHost(rouletteHostRef.current)) {
            const current = rouletteRef.current;
            if (current && current.phase !== 'betting') {
                if (rouletteTimerRef.current) { clearInterval(rouletteTimerRef.current); rouletteTimerRef.current = null; }
                clearTimeout(rouletteSpinTimeoutRef.current);
                clearTimeout(rouletteResultTimeoutRef.current);
                const reset = rl.newRound(current);
                setRouletteGame(reset);
                clearReadyPeers('roulette');
                socket.sendRoomMessage(reset.roomId, rl.serializeRouletteAction({ type: 'rl_state', state: rl.serializeGame(reset) }));
                startRouletteTimer();
            }
        } else if (gameType === 'andarbahar' && amIHost(abHostRef.current)) {
            const current = andarBaharRef.current;
            if (current && current.phase !== 'betting') {
                if (abCycleTimerRef.current) clearTimeout(abCycleTimerRef.current);
                if (abDealTimerRef.current) { clearInterval(abDealTimerRef.current); abDealTimerRef.current = null; }
                abGenRef.current++;
                const reset = ab.newRound(current);
                setAndarBaharGame(reset);
                clearReadyPeers('andarbahar');
                socket.sendRoomMessage(reset.roomId, ab.serializeAndarBaharAction({ type: 'ab_state', state: ab.serializeGame(reset) }));
                startAbCycle(reset);
            }
        }
    }, [amIHost, clearReadyPeers, startBlackjackTimer, startAbCycle]);

    // ── Instant start: when all bettors are ready, host triggers game immediately ──
    // Uses state variables directly (not refs) so the effect fires on both
    // readyPeers changes AND game state changes (e.g. when a bet is placed).
    useEffect(() => {
        const myId = myIdRef.current;

        // Roulette: check if all bettors are ready
        const rlGame = rouletteGame;
        if (rlGame && rlGame.phase === 'betting' && amIHost(rouletteHostRef.current)) {
            const bettorIds = [...new Set((rlGame.bets || []).map(b => b.peer_id))];
            const readySet = readyPeers.roulette;
            if (bettorIds.length > 0 && bettorIds.every(id => readySet.has(id))) {
                // All bettors ready — instant spin
                clearReadyPeers('roulette');
                if (rouletteTimerRef.current) clearInterval(rouletteTimerRef.current);
                const spun = rl.spin(rlGame);
                setRouletteGame(spun);
                const roomId = rlGame.roomId;
                socket.sendRoomMessage(roomId, rl.serializeRouletteAction({ type: 'rl_state', state: rl.serializeGame(spun) }));
                rouletteSpinTimeoutRef.current = setTimeout(() => {
                    const resultsGame = rl.finishSpin(rouletteRef.current || spun);
                    setRouletteGame(resultsGame);
                    if (amIHost(rouletteHostRef.current) && resultsGame.payouts) {
                        updateBankLedger('roulette', resultsGame.payouts);
                    }
                    const myNet = resultsGame.payouts?.[myId];
                    if (myNet !== undefined && walletRef.current) {
                        const event = new rl.RouletteEngine(resultsGame).calculateResults(resultsGame);
                        resolvePayoutEvent(event, myId, walletRef.current);
                    }
                    if (amIHost(rouletteHostRef.current)) {
                        socket.sendRoomMessage(roomId, rl.serializeRouletteAction({ type: 'rl_state', state: rl.serializeGame(resultsGame) }));
                    }
                    rouletteResultTimeoutRef.current = setTimeout(() => {
                        const reset = rl.newRound(rouletteRef.current || resultsGame);
                        setRouletteGame(reset);
                        if (amIHost(rouletteHostRef.current)) {
                            socket.sendRoomMessage(roomId, rl.serializeRouletteAction({ type: 'rl_state', state: rl.serializeGame(reset) }));
                        }
                        startRouletteTimer();
                    }, rl.RESULTS_DISPLAY_MS);
                }, rl.SPIN_PHASE_MS);
            }
        }

        // Blackjack: check if all bettors are ready
        const bjGame = blackjackGame;
        if (bjGame && bjGame.phase === 'betting' && amIHost(bjHostRef.current)) {
            const bettorIds = bjGame.players.filter(p => p.bet > 0).map(p => p.peer_id);
            const readySet = readyPeers.blackjack;
            if (bettorIds.length > 0 && bettorIds.every(id => readySet.has(id))) {
                clearReadyPeers('blackjack');
                if (bjDealerTimerRef.current) clearTimeout(bjDealerTimerRef.current);
                const dealtGame = bj.dealInitialCards(bjGame);
                setBlackjackGame(dealtGame);
                socket.sendRoomMessage(bjGame.roomId, bj.serializeBlackjackAction({ type: 'bj_state', state: bj.serializeGame(dealtGame) }));
                bjCheckDealerTransition('betting', dealtGame);
                if (dealtGame.phase === 'playing') startTurnTimer(dealtGame);
            }
        }

        // Andar Bahar: check if all bettors are ready
        const abGame = andarBaharGame;
        if (abGame && abGame.phase === 'betting' && amIHost(abHostRef.current)) {
            const bettorIds = [...new Set((abGame.bets || []).map(b => b.peer_id))];
            const readySet = readyPeers.andarbahar;
            if (bettorIds.length > 0 && bettorIds.every(id => readySet.has(id))) {
                clearReadyPeers('andarbahar');
                if (abCycleTimerRef.current) clearTimeout(abCycleTimerRef.current);
                abGenRef.current++;
                // Deal trump immediately
                const withTrump = ab.dealTrump(abGame);
                setAndarBaharGame(withTrump);
                const roomId = abGame.roomId;
                socket.sendRoomMessage(roomId, ab.serializeAndarBaharAction({ type: 'ab_state', state: ab.serializeGame(withTrump) }));
                // Start dealing cards
                abDealTimerRef.current = setInterval(() => {
                    const cur = andarBaharRef.current;
                    if (!cur || !amIHost(abHostRef.current) || cur.phase !== 'dealing') {
                        clearInterval(abDealTimerRef.current);
                        return;
                    }
                    const next = ab.dealNext(cur);
                    setAndarBaharGame(next);
                    socket.sendRoomMessage(roomId, ab.serializeAndarBaharAction({ type: 'ab_state', state: ab.serializeGame(next) }));
                    if (next.phase === 'ended') {
                        clearInterval(abDealTimerRef.current);
                        if (amIHost(abHostRef.current) && next.payouts) {
                            updateBankLedger('andarbahar', next.payouts);
                        }
                        const myNet = next.payouts?.[myId];
                        if (myNet !== undefined && walletRef.current) {
                            const event = new ab.AndarBaharEngine(next).calculateResults(next);
                            resolvePayoutEvent(event, myId, walletRef.current);
                        }
                        abCycleTimerRef.current = setTimeout(() => {
                            if (!amIHost(abHostRef.current)) return;
                            const reset = ab.newRound(andarBaharRef.current || next);
                            setAndarBaharGame(reset);
                            socket.sendRoomMessage(roomId, ab.serializeAndarBaharAction({ type: 'ab_state', state: ab.serializeGame(reset) }));
                            startAbCycle(reset);
                        }, ab.RESULTS_DISPLAY_MS);
                    }
                }, ab.DEAL_INTERVAL_MS);
            }
        }
    }, [readyPeers, rouletteGame, blackjackGame, andarBaharGame, amIHost, clearReadyPeers, updateBankLedger, resolvePayoutEvent, startRouletteTimer, startAbCycle, startTurnTimer, bjCheckDealerTransition]);

    // ── Clear ready peers when phase changes away from betting ──
    useEffect(() => {
        if (rouletteGame && rouletteGame.phase !== 'betting') clearReadyPeers('roulette');
    }, [rouletteGame?.phase, clearReadyPeers]);
    useEffect(() => {
        if (blackjackGame && blackjackGame.phase !== 'betting') clearReadyPeers('blackjack');
    }, [blackjackGame?.phase, clearReadyPeers]);
    useEffect(() => {
        if (andarBaharGame && andarBaharGame.phase !== 'betting') clearReadyPeers('andarbahar');
    }, [andarBaharGame?.phase, clearReadyPeers]);

    // ── GIF handler ──────────────────────────────────────────
    const handleGifSelect = (gifUrl) => {
        const myNick = nickRef.current;
        const activeRoom = currentRoomRef.current;
        if (activeRoom) {
            addMsg(myNick, '', 'self', { gif: gifUrl, roomId: activeRoom });
            socket.sendRoomMessage(activeRoom, `[GIF]${gifUrl}`);
        } else {
            addMsg(myNick, '', 'self', { gif: gifUrl });
            socket.sendChat(`[GIF]${gifUrl}`);
        }
        setShowGifPicker(false);
    };

    // ── Poke handler ──────────────────────────────────────────
    const handlePoke = useCallback((peerId, peerNick, pokeType = 'snowball') => {
        const now = Date.now();
        const last = pokeCooldownsRef.current[peerId] || 0;
        if (now - last < POKE_COOLDOWN_MS) {
            addMsg('★', `⚠ Wait ${Math.ceil((POKE_COOLDOWN_MS - (now - last)) / 1000)}s before poking ${peerNick} again.`, 'system');
            return;
        }
        pokeCooldownsRef.current[peerId] = now;
        socket.sendChat(JSON.stringify({
            type: 'poke', to: peerId, from_nick: nickRef.current, poke_type: pokeType,
        }));
        addMsg('👊', `You poked ${peerNick} with ${POKE_TYPES_MAP[pokeType]}!`, 'system');
    }, [addMsg]);

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
        const reason = `Admin grant from ${nickRef.current}`;
        // Broadcast via general chat so the relay forwards it to all peers.
        // Each peer checks peer_id === myId before applying.
        socket.sendChat(JSON.stringify({ type: 'admin_adjust_balance', peer_id, delta, reason }));
        addActivityLog(`Adjusted ${nick}'s balance by ${delta} chips`);
        // Apply locally if we are the target (relay echo won't reach sender)
        if (peer_id === myIdRef.current && walletRef.current) {
            const updated = wallet.adminAdjust(walletRef.current, delta, reason);
            updateWallet(updated);
            addMsg('★', `💰 Admin ${delta > 0 ? 'added' : 'deducted'} ${Math.abs(delta)} chips (${reason})`, 'system');
        }
        // Optimistically update peer balance in the sidebar so admin sees the change immediately
        setPeers(prev => prev.map(p =>
            p.peer_id === peer_id ? { ...p, balance: Math.max(0, (p.balance || 0) + delta) } : p
        ));
    };
    const handleAdminAdjustKarma = (peer_id, nick, delta) => {
        const reason = `Admin karma grant from ${nickRef.current}`;
        socket.sendChat(JSON.stringify({ type: 'admin_adjust_karma', peer_id, delta, reason }));
        addActivityLog(`Adjusted ${nick}'s karma by ${delta}`);
        // Apply locally if we are the target
        if (peer_id === myIdRef.current) {
            setProfile(prev => {
                if (!prev) return prev;
                const currentKarma = prev.reputation?.karma ?? 0;
                const newKarma = Math.max(0, currentKarma + delta);
                const tier = getTier(newKarma).name;
                const history = [
                    { eventType: 'admin_adjust', delta, reason, timestamp: Date.now(), data: {} },
                    ...(prev.reputation?.history ?? []),
                ].slice(0, 50);
                const updated = { ...prev, reputation: { karma: newKarma, tier, history } };
                saveProfile(updated);
                return updated;
            });
            addMsg('★', `⭐ Admin ${delta > 0 ? 'added' : 'removed'} ${Math.abs(delta)} karma`, 'system');
        }
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

    // ── Render message content with @mention highlights ──────
    const renderContent = useCallback((text) => {
        if (!text || typeof text !== 'string') return text;
        const parts = text.split(MENTION_REGEX);
        if (parts.length === 1) return text;
        return parts.map((part, i) => {
            if (part.startsWith('@')) {
                return <span key={i} className="mention-highlight">{part}</span>;
            }
            return part;
        });
    }, []);

    // ── @mention detection helper ─────────────────────────────
    // Map full name AND word aliases so @babita matches "Babita Ji", @hathi matches "Dr. Hathi", etc.
    const agentNameMap = useMemo(() => {
        const map = {};
        Object.values(CHARACTERS).forEach(c => {
            const full = c.name.toLowerCase();
            map[full] = c.id;
            // Add each word as an alias (e.g. "babita" & "ji" for "Babita Ji", "dr" & "hathi" for "Dr. Hathi")
            const words = full.split(/[\s.]+/).filter(Boolean);
            words.forEach(w => { if (!map[w]) map[w] = c.id; });
        });
        return map;
    }, []);

    // Build cached list of all mentionable names (agents + online peers), sorted alphabetically
    const allMentionables = useMemo(() => {
        const names = new Map();
        Object.values(CHARACTERS).forEach(c => {
            names.set(c.name.toLowerCase(), { display: c.name, avatar: c.avatar, type: 'agent' });
        });
        peers.forEach(p => {
            if (p.nick && p.nick !== nickRef.current) {
                const key = p.nick.toLowerCase();
                if (!names.has(key)) names.set(key, { display: p.nick, avatar: '👤', type: 'peer' });
            }
        });
        return [...names.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([key, val]) => ({ key, ...val }));
    }, [CHARACTERS, peers]);

    // Update suggestions when query changes
    useEffect(() => {
        if (mentionQuery === null) { setMentionSuggestions([]); return; }
        if (!mentionQuery) { setMentionSuggestions(allMentionables); setMentionIndex(0); return; }
        const q = mentionQuery.toLowerCase();
        const filtered = allMentionables.filter(m => m.key.startsWith(q));
        setMentionSuggestions(filtered);
        setMentionIndex(0);
    }, [mentionQuery, allMentionables]);

    // Handle input changes to detect @mention trigger + room constraints
    const handleInputChange = useCallback((e) => {
        let val = e.target.value;

        // Emoji-only constraint: strip non-emoji characters
        if (roomConstraint === 'emoji') {
            val = filterEmojiOnly(val);
        }

        setInput(val);

        // Detect @mention: find the last '@' before the cursor
        const cursorPos = e.target.selectionStart;
        const textBefore = val.slice(0, cursorPos);
        const atIdx = textBefore.lastIndexOf('@');

        if (atIdx >= 0) {
            // Only trigger if '@' is at start or preceded by a space
            const charBefore = atIdx > 0 ? textBefore[atIdx - 1] : ' ';
            if (charBefore === ' ' || atIdx === 0) {
                const query = textBefore.slice(atIdx + 1);
                // Only show if query has no spaces (still typing the name)
                if (!/\s/.test(query)) {
                    setMentionQuery(query);
                    return;
                }
            }
        }
        setMentionQuery(null);
    }, [roomConstraint]);

    // Handle keyboard navigation in mention dropdown + room constraints
    const handleInputKeyDown = useCallback((e) => {
        // No-backspace constraint: obliterate entire draft on Backspace
        if (roomConstraint === 'nobackspace' && e.key === 'Backspace') {
            e.preventDefault();
            setInput('');
            addMsg('\u2605', '\uD83D\uDCA5 Backspace detected! Draft obliterated!', 'system');
            return;
        }

        if (mentionQuery === null || mentionSuggestions.length === 0) return;

        if (e.key === 'Tab' || e.key === 'Enter') {
            // Don't submit form on Enter when dropdown is open
            if (e.key === 'Enter') e.stopPropagation();
            e.preventDefault();
            const selected = mentionSuggestions[mentionIndex];
            if (!selected) return;

            // Replace the @query with @SelectedName + space
            const cursorPos = e.target.selectionStart;
            const textBefore = input.slice(0, cursorPos);
            const atIdx = textBefore.lastIndexOf('@');
            const before = input.slice(0, atIdx);
            const after = input.slice(cursorPos);
            const newVal = `${before}@${selected.display} ${after}`;
            setInput(newVal);
            setMentionQuery(null);

            // Move cursor after the inserted name + space
            const newCursorPos = atIdx + 1 + selected.display.length + 1;
            requestAnimationFrame(() => {
                e.target.setSelectionRange(newCursorPos, newCursorPos);
            });
            return;
        }

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setMentionIndex(prev => Math.min(prev + 1, mentionSuggestions.length - 1));
            return;
        }

        if (e.key === 'ArrowUp') {
            e.preventDefault();
            setMentionIndex(prev => Math.max(prev - 1, 0));
            return;
        }

        if (e.key === 'Escape') {
            setMentionQuery(null);
            return;
        }
    }, [mentionQuery, mentionSuggestions, mentionIndex, input, roomConstraint, addMsg]);

    const processMentions = useCallback((text, senderNick) => {
        const mentions = text.match(/@(\w+)/g);
        if (!mentions) return;
        const myNick = nickRef.current;
        const currentPeers = peersRef.current;

        mentions.forEach(raw => {
            const name = raw.slice(1).toLowerCase();

            // Check if it's an AI agent mention (only in general chat, not rooms)
            const agentId = agentNameMap[name];
            if (agentId && !currentRoomRef.current) {
                const sw = swarmRef.current;
                if (!sw) { console.warn(`[@Mention] No swarm instance for @${name}`); return; }
                if (!sw.running) { console.warn(`[@Mention] Swarm not running for @${name}`); return; }
                // Context already fed by addMsg — just trigger the response
                const c = CHARACTERS[agentId];
                if (!c) { console.warn(`[@Mention] Character not found: ${agentId}`); return; }
                if (!sw._isActive(agentId)) {
                    console.warn(`[@Mention] ${c.name} is disabled (char=${sw._charEnabled[agentId]}, group=${sw._groupEnabled[c.groupId || c.show]})`);
                    return;
                }
                sw._log(`[@Mention] ${c.name} triggered by @${name} from ${senderNick}`);
                if (sw._timers[agentId]) clearTimeout(sw._timers[agentId]);
                sw._generate(agentId, { force: true }).then(() => sw._scheduleNext(agentId));
                return;
            }

            // Check if it's a user mention — notify via toast if it's us
            if (name === myNick?.toLowerCase()) {
                const toastId = Date.now() + Math.random();
                setMentionToasts(prev => [...prev, { id: toastId, from: senderNick, text }]);
                setTimeout(() => setMentionToasts(prev => prev.filter(t => t.id !== toastId)), 5000);
            }
            // Check if mentioning another peer — send notification via room
            const target = currentPeers.find(p => p.nick?.toLowerCase() === name);
            if (target && target.nick !== myNick) {
                const activeRoom = currentRoomRef.current;
                if (activeRoom) {
                    socket.sendRoomMessage(activeRoom, JSON.stringify({
                        type: 'mention_notify', to: target.peer_id, from_nick: senderNick, text,
                    }));
                } else {
                    socket.sendChat(JSON.stringify({
                        type: 'mention_notify', to: target.peer_id, from_nick: senderNick, text,
                    }));
                }
            }
        });
    }, [agentNameMap]);

    // ── Command handler ──────────────────────────────────────
    const handleSend = (e) => {
        e.preventDefault();
        const text = input.trim();
        if (!text) return;

        // 5-word constraint: block if over limit
        if (roomConstraint === '5word') {
            const wc = text.split(/\s+/).filter(Boolean).length;
            if (wc > 5) {
                addMsg('\u2605', `\u26D4 Too many words! (${wc}/5) \u2014 trim it down.`, 'system');
                return;
            }
        }

        setInput('');
        setShowGifPicker(false);

        const myId = myIdRef.current;
        const myNick = nickRef.current;
        const currentRooms = roomsRef.current;
        const currentPeers = peersRef.current;
        const activeRoom = currentRoomRef.current;

        if (text === '/help') {
            const helpLines = [
                '── COMMANDS ──────────────────────',
                '/room create <name>  — create a room',
                '/room invite <nick> <room_id>  — invite peer',
                '/room list  — list rooms',
                '/game tictactoe  — challenge room to game',
                '/blackjack  — start blackjack game',
                '/roulette  — start roulette (auto-spin every 2 min)',
                '/andarbahar  — start Andar Bahar',
                '/predictions  — start prediction market',
                '/balance  — show your chip balance',
                '/tip <nick> <amount>  — send chips to a peer',
                '/clear  — clear current chat history',
                '/debug  — toggle AI debug mode (shows API calls & errors)',
            ];
            const now = timeStr();
            const roomId = currentRoomRef.current || null;
            setMessages(prev => {
                const capped = prev.length > 1200 ? prev.slice(-1000) : prev;
                return [...capped, ...helpLines.map(line => ({
                    time: now, sender: '★', content: line, type: 'system',
                    id: Date.now() + Math.random(),
                    roomId,
                    reactions: {},
                }))];
            });
            return;
        }

        if (text === '/debug') {
            const next = !debugMode;
            setDebugMode(next);
            localStorage.setItem('openwire_debug', String(next));
            addMsg('★', `🔧 Debug mode ${next ? 'ON' : 'OFF'} — ${next ? 'AI API calls will be logged to browser console & chat' : 'Debug logging disabled'}`, 'system');
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
                // Send via dedicated relay handler (updates both balances server-side)
                socket.send({ type: 'tip', to: target.peer_id, amount });
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

        if (text === '/predictions' || text.startsWith('/predictions ')) {
            let roomId = text.slice(13).trim();
            if (!roomId && activeRoom) roomId = activeRoom;
            if (!roomId && currentRooms.length > 0) roomId = currentRooms[0].room_id;
            if (!roomId) { addMsg('★', '⚠ Create a room first.', 'system'); return; }
            if (polymarketRef.current) { addMsg('★', '⚠ Predictions market already running.', 'system'); return; }
            startPolymarket(roomId);
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

        // Process @mentions for user toasts and AI agent triggers
        processMentions(text, myNick);
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
    const myCosmetics = useMemo(() => profile ? getEquippedClasses(profile) : null, [profile]);
    const anyGameActive = !!(activeGame || blackjackGame || rouletteGame || andarBaharGame || polymarketGame || mysteryGame);

    // Safe room leave — don't leave if an active game is using the room
    const safeLeaveRoom = useCallback((roomId) => {
        if (!roomId) return;
        const gameRooms = [
            blackjackRef.current?.roomId, rouletteRef.current?.roomId,
            andarBaharRef.current?.roomId, polymarketRef.current?.roomId,
            mysteryRef.current?.roomId,
        ];
        if (gameRooms.includes(roomId)) {
            // Game active in this room — just switch view, don't leave the relay room
            return;
        }
        socket.leaveRoom(roomId);
    }, []);

    // ── Stable callback props for memoized board components ──
    const closeBj = useCallback(() => {
        setBlackjackGame(null);
        bjHostRef.current = null;
        hasJoinedBj.current = false;
        if (bjDealerTimerRef.current) { clearTimeout(bjDealerTimerRef.current); bjDealerTimerRef.current = null; }
        if (bjTurnTimerRef.current) { clearTimeout(bjTurnTimerRef.current); bjTurnTimerRef.current = null; }
        if (bjDealerTransitionTimerRef.current) { clearTimeout(bjDealerTransitionTimerRef.current); bjDealerTransitionTimerRef.current = null; }
    }, []);
    const closeRl = useCallback(() => {
        setRouletteGame(null);
        rouletteHostRef.current = null;
        hasJoinedRl.current = false;
        if (rouletteTimerRef.current) { clearInterval(rouletteTimerRef.current); rouletteTimerRef.current = null; }
        clearTimeout(rouletteSpinTimeoutRef.current);
        clearTimeout(rouletteResultTimeoutRef.current);
    }, []);
    const closeAb = useCallback(() => {
        setAndarBaharGame(null);
        abHostRef.current = null;
        hasJoinedAb.current = false;
        if (abDealTimerRef.current) { clearInterval(abDealTimerRef.current); abDealTimerRef.current = null; }
        if (abCycleTimerRef.current) { clearTimeout(abCycleTimerRef.current); abCycleTimerRef.current = null; }
        abGenRef.current++;
    }, []);
    const closePm = useCallback(() => {
        setPolymarketGame(null);
        pmHostRef.current = null;
        hasJoinedPm.current = false;
    }, []);
    const closeMystery = useCallback(() => {
        setMysteryGame(null);
        mysteryHostRef.current = null;
        hasJoinedMystery.current = false;
    }, []);
    const closeTtt = useCallback(() => setActiveGame(null), []);
    const helpBj = useCallback(() => openHelp('blackjack'), []);
    const helpRl = useCallback(() => openHelp('roulette'), []);
    const helpAb = useCallback(() => openHelp('andarbahar'), []);
    const helpPm = useCallback(() => openHelp('polymarket'), []);
    const helpMm = useCallback(() => openHelp('mystery'), []);
    const helpTtt = useCallback(() => openHelp('tictactoe'), []);
    const readyBj = useCallback(() => handleReadyUp('blackjack'), [handleReadyUp]);
    const readyRl = useCallback(() => handleReadyUp('roulette'), [handleReadyUp]);
    const readyAb = useCallback(() => handleReadyUp('andarbahar'), [handleReadyUp]);
    const newRoundBj = useCallback(() => handleGameNewRound('blackjack'), [handleGameNewRound]);
    const newRoundRl = useCallback(() => handleGameNewRound('roulette'), [handleGameNewRound]);
    const newRoundAb = useCallback(() => handleGameNewRound('andarbahar'), [handleGameNewRound]);

    return (
        <div className="chat-layout">
            <header className="chat-header">
                <button className="hamburger-btn" onClick={() => setSidebarOpen(v => !v)} aria-label="Toggle sidebar">☰</button>
                <h1>⚡ OpenWire</h1>
                <div className="header-context">
                    {currentRoomName ? (
                        <span className="current-room-indicator">
                            <span className="room-icon">🏠</span>
                            <span className="room-name">{currentRoomName}</span>
                            <button className="leave-room-btn" onClick={() => { safeLeaveRoom(currentRoom); setCurrentRoom(null); }} title="Leave Room">✕</button>
                        </span>
                    ) : (
                        <span className="general-chat-indicator">💬 General Chat</span>
                    )}
                    {roomConstraint && (
                        <span className="constraint-badge">{ROOM_CONSTRAINTS[roomConstraint].badge}</span>
                    )}
                    {chaosEnabled && (
                        <span className="constraint-badge chaos-badge">{CHAOS_PERSONALITIES[chaosPersonality].emoji} Chaos ON</span>
                    )}
                </div>
                <div className="header-status">
                    <span className="header-nick">{myNick}</span>
                    {isCliMode
                        ? <span className="connection-mode-badge connection-mode-cli" title={connectionConfig.cliUrl}>
                            <span className="connection-mode-lock">&#128274;</span> CLI ({cliHost})
                          </span>
                        : <span className="connection-mode-badge connection-mode-relay">Relay</span>
                    }
                    <span className={`status-dot ${connected ? '' : 'offline'}`} />
                    <span className="header-online-count">{connected ? `${peers.length} online` : 'Connecting...'}</span>
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
                    {isAdminRef.current && (
                    <button
                        className={`btn-agent-panel ${agentRunning ? 'active' : ''}`}
                        onClick={() => setShowAgentPanel(v => !v)}
                        title="Pop-Culture Agent Swarm"
                    >🤖</button>
                    )}
                    <div className="mute-agents-wrapper" ref={muteMenuRef}>
                        <button
                            className={`btn-mute-agents ${allAgentsMuted ? 'muted' : ''}`}
                            onClick={() => setShowMuteMenu(v => !v)}
                            title={allAgentsMuted ? 'AI characters muted' : 'Mute AI characters'}
                        >{allAgentsMuted ? '🔇' : '🔊'}</button>
                        {showMuteMenu && (
                            <div className="mute-agents-menu">
                                <div className="mute-menu-header">
                                    <span>AI Characters</span>
                                    <button className="mute-menu-toggle-all" onClick={toggleMuteAll}>
                                        {allAgentsMuted ? 'Unmute All' : 'Mute All'}
                                    </button>
                                </div>
                                {Object.values(CHARACTERS).map(c => (
                                    <label key={c.id} className="mute-menu-row">
                                        <input
                                            type="checkbox"
                                            checked={!mutedAgents[c.id]}
                                            onChange={() => toggleMuteAgent(c.id)}
                                        />
                                        <span>{c.avatar} {c.name}</span>
                                    </label>
                                ))}
                            </div>
                        )}
                    </div>
                    {onLogout && <button className="btn-logout" onClick={onLogout}>Logout</button>}
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

            {/* Poke overlay */}
            {activePoke && <Suspense fallback={null}><PokeOverlay poke={activePoke} onDone={() => setActivePoke(null)} /></Suspense>}

            {/* @mention toasts */}
            {mentionToasts.length > 0 && (
                <div className="mention-toasts">
                    {mentionToasts.map(t => (
                        <div key={t.id} className="mention-toast">
                            <span className="mention-toast-icon">@</span>
                            <span><strong>{t.from}</strong> mentioned you: {t.text.length > 60 ? t.text.slice(0, 60) + '…' : t.text}</span>
                            <button className="mention-toast-close" onClick={() => setMentionToasts(prev => prev.filter(x => x.id !== t.id))}>✕</button>
                        </div>
                    ))}
                </div>
            )}

            {/* Casino Live Ticker — game events only, separate from chat */}
            <LiveTicker items={tickerItems} />

            <div className="messages-area">
                {filteredMessages.length === 0 && (
                    <div className="empty-state">
                        <div className="empty-state-icon">⚡</div>
                        <div className="empty-state-title">Welcome to OpenWire</div>
                        <div className="empty-state-hint">Type a message below or open a game from the sidebar</div>
                    </div>
                )}
                {filteredMessages.map((m) => (
                    <MessageRow
                        key={m.id}
                        msg={m}
                        renderContent={renderContent}
                        onReact={handleReact}
                        onJoinInvite={joinGameFromInvite}
                        onDismissInvite={dismissInvite}
                        myCosmetics={myCosmetics}
                    />
                ))}
                <div ref={messagesEnd} />
            </div>

            <TypingBar typingPeers={typingPeers} agentTyping={agentTyping} myId={myIdRef.current} />

            {whisperTarget && (
                <div className="whisper-mode-bar">
                    🤫 Whispering to <strong>{whisperTarget.nick}</strong>
                    <button onClick={() => setWhisperTarget(null)}>✕ Exit</button>
                </div>
            )}

            <form className="chat-input" onSubmit={(e) => { if (mentionQuery !== null && mentionSuggestions.length > 0) { e.preventDefault(); return; } handleSend(e); }}>
                <div className="chat-input-wrapper" style={{ flex: 1, position: 'relative' }}>
                    {mentionSuggestions.length > 0 && mentionQuery !== null && (
                        <div className="mention-dropdown">
                            {mentionSuggestions.map((m, i) => (
                                <div
                                    key={m.key}
                                    className={`mention-item${i === mentionIndex ? ' mention-item-active' : ''}`}
                                    onMouseDown={(ev) => {
                                        ev.preventDefault();
                                        const el = inputRef.current;
                                        if (!el) return;
                                        const cursorPos = el.selectionStart;
                                        const textBefore = input.slice(0, cursorPos);
                                        const atIdx = textBefore.lastIndexOf('@');
                                        const before = input.slice(0, atIdx);
                                        const after = input.slice(cursorPos);
                                        const newVal = `${before}@${m.display} ${after}`;
                                        setInput(newVal);
                                        setMentionQuery(null);
                                        requestAnimationFrame(() => {
                                            const pos = atIdx + 1 + m.display.length + 1;
                                            el.setSelectionRange(pos, pos);
                                            el.focus();
                                        });
                                    }}
                                >
                                    <span className="mention-avatar">{m.avatar}</span>
                                    <span className="mention-name">{m.display}</span>
                                    <span className="mention-type">{m.type === 'agent' ? 'AI' : 'User'}</span>
                                </div>
                            ))}
                        </div>
                    )}
                    <input
                        ref={inputRef}
                        type="text"
                        className={roomConstraint === 'emoji' ? 'constraint-emoji-input' : roomConstraint === 'nobackspace' ? 'constraint-nobackspace-input' : ''}
                        placeholder={
                            roomConstraint === 'emoji' ? 'Emoji only...'
                            : roomConstraint === '5word' ? 'Max 5 words...'
                            : roomConstraint === 'nobackspace' ? 'Type carefully...'
                            : currentRoom ? `Message #${rooms.find(r => r.room_id === currentRoom)?.name || 'room'}...` : 'Message General Chat... (or /help)'
                        }
                        value={input}
                        onChange={(e) => {
                            handleInputChange(e);
                            const now = Date.now();
                            if (now - lastTypingSentRef.current > 1500 && currentRoomRef.current) {
                                lastTypingSentRef.current = now;
                                socket.sendRoomMessage(currentRoomRef.current, JSON.stringify({
                                    type: 'typing', nick: nickRef.current,
                                }));
                            }
                        }}
                        onKeyDown={handleInputKeyDown}
                        onPaste={handlePaste}
                        autoFocus
                    />
                    {roomConstraint === '5word' && input.trim().length > 0 && (
                        <span className={`word-count-badge ${input.trim().split(/\s+/).filter(Boolean).length > 5 ? 'over-limit' : ''}`}>
                            {input.trim().split(/\s+/).filter(Boolean).length}/5
                        </span>
                    )}
                    {showGifPicker && <Suspense fallback={null}><GifPicker onSelect={handleGifSelect} onClose={() => setShowGifPicker(false)} /></Suspense>}
                </div>
                <button type="button" className="gif-btn" onClick={() => setShowGifPicker(!showGifPicker)}>GIF</button>
                <button
                    type="submit"
                    disabled={roomConstraint === '5word' && input.trim().split(/\s+/).filter(Boolean).length > 5}
                >Send</button>
            </form>

            <div className={`sidebar${sidebarOpen ? ' mobile-open' : ''}`}>
                <button className="sidebar-close-btn" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar">✕</button>
                <div className="sidebar-section">
                    <div className="sidebar-title">Channels</div>
                    <div className={`room-item ${!currentRoom ? 'active' : ''}`} onClick={() => { if (currentRoom) safeLeaveRoom(currentRoom); setCurrentRoom(null); setSidebarOpen(false); }} style={{ cursor: 'pointer' }}>
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
                            {profile && (
                                <div className="wallet-sub" style={{ marginTop: '4px', color: 'var(--brand)', display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                                    ⭐ Karma: {profile.reputation?.karma ?? 0} · {profile.reputation?.tier ?? 'newcomer'}
                                    <button
                                        onClick={() => setShowKarmaGuide(true)}
                                        title="How does karma work?"
                                        style={{ background: 'none', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '50%', width: '16px', height: '16px', fontSize: '0.6rem', color: 'rgba(255,255,255,0.45)', cursor: 'pointer', padding: 0, lineHeight: '14px', flexShrink: 0 }}
                                    >?</button>
                                    {profile.vault?.staked > 0 && (
                                        <span style={{ marginLeft: '6px', color: '#FFD700' }}>
                                            🏦 {profile.vault.staked.toLocaleString()} staked
                                        </span>
                                    )}
                                </div>
                            )}
                            <button className="sidebar-btn" style={{ marginTop: '6px', fontSize: '0.75rem', padding: '3px 8px' }} onClick={() => { setShowVault(true); setSidebarOpen(false); }}>
                                🏦 Vault
                            </button>
                        </div>
                    </div>
                )}

                {/* Jackpot Pool */}
                {jackpotPool.pool > 0 && (
                    <div className="sidebar-section">
                        <div className="sidebar-title">🎰 Jackpot Pool</div>
                        <div className="sidebar-wallet">
                            <div className="wallet-balance" style={{ color: '#FFD700' }}>{jackpotPool.pool.toLocaleString()} <span className="wallet-unit">chips</span></div>
                        </div>
                    </div>
                )}

                <div className="sidebar-section">
                    <div className="sidebar-title">Online ({peers.length})</div>
                    {peers.filter(p => p.peer_id !== myIdRef.current).map((p) => (
                        <div key={p.peer_id} className="peer-item">
                            <span className="peer-dot" />
                            <span className="peer-nick">{p.nick}</span>
                            {p.is_bridge && <span className="peer-bridge-badge" title="CLI bridge node">🔗 CLI</span>}
                            {p.balance > 0 && <span className="peer-chips">{p.balance.toLocaleString()}</span>}
                            <button
                                className="whisper-btn"
                                title={`Whisper to ${p.nick}`}
                                onClick={() => { setWhisperTarget({ peer_id: p.peer_id, nick: p.nick }); setSidebarOpen(false); }}
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
                                    // Send via dedicated relay handler (updates both balances server-side)
                                    socket.send({ type: 'tip', to: p.peer_id, amount });
                                    addMsg('💸', `Tipped ${amount} chips to ${p.nick}!`, 'system');
                                }}
                            >💰</button>
                            <button className="poke-btn" title={`Poke ${p.nick}`}
                                onClick={() => handlePoke(p.peer_id, p.nick, 'snowball')}>👊</button>
                        </div>
                    ))}
                    {peers.filter(p => p.peer_id !== myIdRef.current).length === 0 && (
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>No peers yet…</div>
                    )}
                </div>

                <div className="sidebar-section">
                    <div className="sidebar-title">Rooms ({rooms.length})</div>
                    {rooms.map((r) => (
                        <div key={r.room_id} className={`room-item ${currentRoom === r.room_id ? 'active' : ''}`} onClick={() => { if (currentRoom && currentRoom !== r.room_id) safeLeaveRoom(currentRoom); if (currentRoom !== r.room_id) socket.joinRoom(r.room_id); setCurrentRoom(r.room_id); setSidebarOpen(false); }} style={{ cursor: 'pointer' }}>
                            <span className="room-icon">🏠</span>
                            <span className="room-name">{r.name} {currentRoom === r.room_id && <span style={{ fontSize: '0.7em', color: 'var(--brand)', marginLeft: '4px' }}>(Joined)</span>}</span>
                        </div>
                    ))}
                </div>

                <div className="sidebar-actions">
                    <button className="sidebar-btn" onClick={() => { const name = prompt('Room name:'); if (name) socket.createRoom(name); }}>+ Create Room</button>

                    {rooms.length > 0 && (
                        <>
                            <div className="sidebar-group">
                                <div className="sidebar-group-title">Casino Games</div>
                                <button className="sidebar-btn" onClick={() => {
                                    const roomId = currentRoomRef.current || roomsRef.current[0]?.room_id;
                                    if (!roomId) { addMsg('★', '⚠ Select or create a room first', 'system'); return; }
                                    if (blackjackRef.current) { addMsg('★', '⚠ Blackjack already in progress', 'system'); return; }
                                    startBlackjack(roomId);
                                    setSidebarOpen(false);
                                }}>🃏 Blackjack</button>

                                <button className="sidebar-btn" onClick={() => {
                                    const roomId = currentRoomRef.current || roomsRef.current[0]?.room_id;
                                    if (!roomId) { addMsg('★', '⚠ Select or create a room first', 'system'); return; }
                                    if (rouletteRef.current) { setRouletteGame(rouletteRef.current); setSidebarOpen(false); return; }
                                    startRoulette(roomId);
                                    setSidebarOpen(false);
                                }}>🎰 Roulette</button>

                                <button className="sidebar-btn" onClick={() => {
                                    const roomId = currentRoomRef.current || roomsRef.current[0]?.room_id;
                                    if (!roomId) { addMsg('★', '⚠ Select or create a room first', 'system'); return; }
                                    if (andarBaharRef.current) { setAndarBaharGame(andarBaharRef.current); setSidebarOpen(false); return; }
                                    startAndarBahar(roomId);
                                    setSidebarOpen(false);
                                }}>🃏 Andar Bahar</button>

                                <button className="sidebar-btn" onClick={() => { setShowSlots(true); setSidebarOpen(false); }}>
                                    🍒 Slots
                                </button>

                                <button className="sidebar-btn" onClick={() => { setTambolaGame(true); setSidebarOpen(false); }}>
                                    🎱 Tambola
                                </button>
                            </div>

                            <div className="sidebar-group">
                                <div className="sidebar-group-title">Social</div>
                                <button className="sidebar-btn" onClick={() => {
                                    const roomId = currentRoomRef.current || roomsRef.current[0]?.room_id;
                                    if (!roomId) { addMsg('★', '⚠ Select or create a room first', 'system'); return; }
                                    socket.sendRoomMessage(roomId, game.serializeGameAction({ type: 'Challenge', challenger: myIdRef.current, challenger_nick: nickRef.current, room_id: roomId }));
                                    addMsg('★', '🎮 Game challenge sent!', 'system');
                                    setSidebarOpen(false);
                                }}>🎮 Tic-Tac-Toe</button>

                                <button className="sidebar-btn" onClick={() => {
                                    const roomId = currentRoomRef.current || roomsRef.current[0]?.room_id;
                                    if (!roomId) { addMsg('\u2605', '\u26A0 Select or create a room first', 'system'); return; }
                                    if (mysteryRef.current) { setSidebarOpen(false); return; }
                                    startMystery(roomId);
                                    setSidebarOpen(false);
                                }}>{'\uD83D\uDD0D'} Mystery</button>

                                <button className="sidebar-btn" onClick={() => {
                                    const roomId = currentRoomRef.current || roomsRef.current[0]?.room_id;
                                    if (!roomId) { addMsg('★', '⚠ Select or create a room first', 'system'); return; }
                                    if (polymarketRef.current) { setPolymarketGame(polymarketRef.current); setSidebarOpen(false); return; }
                                    startPolymarket(roomId);
                                    setSidebarOpen(false);
                                }}>📊 Predictions</button>
                            </div>

                            <div className="sidebar-group">
                                <div className="sidebar-group-title">Community</div>
                                <button className="sidebar-btn" onClick={() => { setShowDeadDrops(true); setSidebarOpen(false); }}>
                                    💀 Dead Drops
                                </button>
                                <button className="sidebar-btn" onClick={() => { setShowCosmetics(true); setSidebarOpen(false); }}>
                                    ✨ Cosmetics Shop
                                </button>
                                <button className="sidebar-btn" onClick={() => {
                                    const nick = prompt('Invite nick:');
                                    const roomId = currentRoomRef.current || roomsRef.current[0]?.room_id;
                                    if (nick && roomId) {
                                        const target = peersRef.current.find(p => p.nick === nick);
                                        if (target) { socket.inviteToRoom(roomId, target.peer_id); addMsg('★', `🏠 Invited ${target.nick} to room.`, 'system'); }
                                        else addMsg('★', `⚠ Peer "${nick}" not found.`, 'system');
                                    }
                                    setSidebarOpen(false);
                                }}>✉ Invite to Room</button>
                                <button className="sidebar-btn" onClick={() => {
                                    setChaosEnabled(v => !v);
                                    if (!chaosEnabled) {
                                        addMsg('\u2605', `${CHAOS_PERSONALITIES[chaosPersonality].emoji} Chaos Agent activated! (${CHAOS_PERSONALITIES[chaosPersonality].name})`, 'system');
                                    }
                                    setSidebarOpen(false);
                                }}>{chaosEnabled ? '\uD83E\uDD16 Chaos Agent ON' : '\uD83E\uDD16 Chaos Agent'}</button>
                                {chaosEnabled && (
                                    <button className="sidebar-btn sidebar-btn-sub" onClick={() => {
                                        const next = nextPersonality(chaosPersonality);
                                        setChaosPersonality(next);
                                        addMsg('\u2605', `${CHAOS_PERSONALITIES[next].emoji} Switched to ${CHAOS_PERSONALITIES[next].name}`, 'system');
                                        setSidebarOpen(false);
                                    }}>{CHAOS_PERSONALITIES[chaosPersonality].emoji} {CHAOS_PERSONALITIES[chaosPersonality].name} (tap to switch)</button>
                                )}
                            </div>

                            <div className="sidebar-group">
                                <div className="sidebar-group-title">Room Mode</div>
                                <div className="constraint-selector">
                                    <button className={`constraint-btn${!roomConstraint ? ' active' : ''}`} onClick={() => { setRoomConstraint(null); setSidebarOpen(false); }}>Normal</button>
                                    <button className={`constraint-btn${roomConstraint === '5word' ? ' active' : ''}`} onClick={() => { setRoomConstraint('5word'); addMsg('\u2605', '\uD83E\uDD10 5-Word Mode activated! Keep it short.', 'system'); setSidebarOpen(false); }}>5 Words</button>
                                    <button className={`constraint-btn${roomConstraint === 'emoji' ? ' active' : ''}`} onClick={() => { setRoomConstraint('emoji'); addMsg('\u2605', '\uD83D\uDE00 Emoji Only mode activated!', 'system'); setSidebarOpen(false); }}>Emoji Only</button>
                                    <button className={`constraint-btn${roomConstraint === 'nobackspace' ? ' active' : ''}`} onClick={() => { setRoomConstraint('nobackspace'); addMsg('\u2605', '\u26A0\uFE0F No Backspace mode activated! Type carefully...', 'system'); setSidebarOpen(false); }}>No Backspace</button>
                                </div>
                            </div>
                        </>
                    )}

                    {rooms.length === 0 && (
                        <>
                            <button className="sidebar-btn" onClick={() => { setShowDeadDrops(true); setSidebarOpen(false); }}>
                                💀 Dead Drops
                            </button>
                            <button className="sidebar-btn" onClick={() => { setShowCosmetics(true); setSidebarOpen(false); }}>
                                ✨ Cosmetics Shop
                            </button>
                        </>
                    )}

                    {initialIsAdmin && (
                        <button className="sidebar-btn admin-btn-sidebar" onClick={() => { setShowAdmin(true); setSidebarOpen(false); }}>
                            🔐 Admin Portal
                        </button>
                    )}
                </div>
            </div>

            {/* Game Overlays */}
            <Suspense fallback={null}>
            {activeGame && (
                <GameBoard game={activeGame} myId={myIdRef.current} onMove={handleGameMove} onRematch={handleRematch} onClose={closeTtt} onHelp={helpTtt} />
            )}
            {blackjackGame && (
                <BlackjackBoard game={blackjackGame} myId={myIdRef.current} myNick={myNick} wallet={myWallet} onAction={handleBjAction} onClose={closeBj} onHelp={helpBj} isHost={bjHostRef.current === myIdRef.current} onReady={readyBj} onNewRound={newRoundBj} readyCount={readyPeers.blackjack.size} totalBettors={blackjackGame?.players?.filter(p => p.bet > 0).length || 0} isReady={readyPeers.blackjack.has(myIdRef.current)} />
            )}
            {rouletteGame && (
                <RouletteBoard
                    game={rouletteGame}
                    myId={myIdRef.current}
                    myNick={myNick}
                    wallet={myWallet}
                    onAction={handleRlAction}
                    onClose={closeRl}
                    onHelp={helpRl}
                    isHost={amIHost(rouletteHostRef.current)}
                    onReady={readyRl}
                    onNewRound={newRoundRl}
                    readyCount={readyPeers.roulette.size}
                    totalBettors={[...new Set((rouletteGame?.bets || []).map(b => b.peer_id))].length}
                    isReady={readyPeers.roulette.has(myIdRef.current)}
                />
            )}
            {andarBaharGame && (
                <AndarBaharBoard
                    game={andarBaharGame}
                    myId={myIdRef.current}
                    myNick={myNick}
                    wallet={myWallet}
                    onAction={handleAbAction}
                    onClose={closeAb}
                    onHelp={helpAb}
                    isHost={amIHost(abHostRef.current)}
                    onReady={readyAb}
                    onNewRound={newRoundAb}
                    readyCount={readyPeers.andarbahar.size}
                    totalBettors={[...new Set((andarBaharGame?.bets || []).map(b => b.peer_id))].length}
                    isReady={readyPeers.andarbahar.has(myIdRef.current)}
                />
            )}
            {polymarketGame && (
                <PolymarketBoard
                    game={polymarketGame}
                    myId={myIdRef.current}
                    myNick={myNick}
                    wallet={myWallet}
                    onAction={handlePmAction}
                    onClose={closePm}
                    onHelp={helpPm}
                    isHost={amIHost(pmHostRef.current)}
                />
            )}

            {showHelp && (
                <HowToPlay activeGame={helpGame} onClose={() => setShowHelp(false)} />
            )}

            {showPostSummary && lastPayoutEvent && (
                <PostSessionSummary
                    event={lastPayoutEvent}
                    myId={myIdRef.current}
                    onClose={() => setShowPostSummary(false)}
                />
            )}

            {showAccountHistory && (
                <AccountHistory
                    deviceId={wallet.getDeviceId()}
                    myId={myIdRef.current}
                    onClose={() => setShowAccountHistory(false)}
                />
            )}

            {showAgentPanel && isAdminRef.current && (
                <AgentControlPanel
                    swarm={swarmRef.current}
                    onClose={() => setShowAgentPanel(false)}
                />
            )}

            {showVault && profile && (
                <VaultPanel
                    wallet={myWallet}
                    vaultData={profile.vault || { staked: 0, stakedAt: null }}
                    onClose={() => setShowVault(false)}
                    onStake={(amount) => {
                        const result = vaultLib.stake(profile, myWallet, amount);
                        if (result.success) {
                            setProfile(prev => { const p = { ...prev, vault: result.profile.vault }; saveProfile(p); return p; });
                            updateWallet(result.wallet);
                            addMsg('★', `🏦 Staked ${amount.toLocaleString()} chips in the Vault!`, 'system');
                        } else {
                            addMsg('★', `⚠ Stake failed: ${result.reason}`, 'system');
                        }
                        setShowVault(false);
                    }}
                    onWithdraw={() => {
                        const result = vaultLib.withdraw(profile, myWallet);
                        if (result.success) {
                            setProfile(prev => { const p = { ...prev, vault: { staked: 0, stakedAt: null } }; saveProfile(p); return p; });
                            updateWallet(result.wallet);
                            addMsg('★', `🏦 Withdrew ${result.amount.toLocaleString()} chips from Vault${result.penaltyApplied ? ' (interest forfeited)' : ''}!`, 'system');
                        } else {
                            addMsg('★', `⚠ Withdraw failed: ${result.reason}`, 'system');
                        }
                        setShowVault(false);
                    }}
                />
            )}

            {showDeadDrops && (
                <DeadDropsPanel
                    roomId={currentRoom || 'general'}
                    karma={profile?.reputation?.karma ?? 0}
                    deviceId={wallet.getDeviceId()}
                    onClose={() => setShowDeadDrops(false)}
                />
            )}

            {showCosmetics && profile && (
                <CosmeticsShop
                    wallet={myWallet}
                    profile={profile}
                    catalog={catalog}
                    deviceId={wallet.getDeviceId()}
                    onClose={() => setShowCosmetics(false)}
                    onPurchase={(itemId) => {
                        const result = purchaseItem(catalog, myWallet, itemId, wallet.getDeviceId(), Date.now());
                        if (result.success) {
                            setCatalog(result.catalog);
                            updateWallet(result.wallet);
                            const owned = [...(profile.cosmetics?.owned || []), itemId];
                            setProfile(prev => { const p = { ...prev, cosmetics: { ...prev.cosmetics, owned } }; saveProfile(p); return p; });
                            addMsg('★', `✨ You bought ${result.item.name}!`, 'system');
                        } else {
                            addMsg('★', `⚠ Purchase failed: ${result.reason}`, 'system');
                        }
                    }}
                    onEquip={(itemId) => {
                        const result = equipItem(profile, itemId);
                        if (result.success) {
                            setProfile(prev => { saveProfile(result.profile); return result.profile; });
                            // Broadcast updated cosmetics to all peers
                            const cos = getEquippedClasses(result.profile);
                            socket.send({ type: 'cosmetics_update', cosmetics: cos });
                        }
                    }}
                    onUnequip={(category) => {
                        const updated = unequipItem(profile, category);
                        setProfile(prev => { saveProfile(updated); return updated; });
                        const cos = getEquippedClasses(updated);
                        socket.send({ type: 'cosmetics_update', cosmetics: cos });
                    }}
                />
            )}

            {tambolaGame && (
                <TambolaBoard
                    myId={myIdRef.current}
                    myNick={nickRef.current}
                    wallet={myWallet}
                    onClose={() => setTambolaGame(false)}
                    onWalletUpdate={(updatedWallet) => {
                        updateWallet(updatedWallet);
                        // Add rake to jackpot
                        setJackpotPool(prev => addRake(prev, 'tambola', 100));
                    }}
                />
            )}
            {showSlots && (
                <SlotsBoard
                    wallet={myWallet}
                    onWalletUpdate={(updatedWallet) => {
                        updateWallet(updatedWallet);
                        setJackpotPool(prev => addRake(prev, 'slots', 100));
                    }}
                    onClose={() => setShowSlots(false)}
                    onHelp={() => openHelp('slots')}
                />
            )}
            {showKarmaGuide && (
                <KarmaGuide
                    currentKarma={profile?.reputation?.karma ?? 0}
                    currentTier={profile?.reputation?.tier ?? 'newcomer'}
                    onClose={() => setShowKarmaGuide(false)}
                />
            )}
            {mysteryGame && (
                <MysteryBoard
                    game={mysteryGame}
                    myId={myIdRef.current}
                    myNick={nickRef.current}
                    onAction={handleMysteryLocalAction}
                    onClose={closeMystery}
                    isHost={mysteryHostRef.current === myIdRef.current}
                />
            )}
            </Suspense>

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
                        {filteredMessages.slice(-50).map((m) => (
                            <div key={m.id} className={`msg ${m.type}`}>
                                <span className="msg-time">[{m.time}]</span>
                                {m.sender && <span className={`msg-sender ${m.type}`}>{m.sender}:</span>}
                                {m.gif ? (
                                    <img src={m.gif} alt="GIF" className="msg-gif" style={{ maxWidth: '140px' }} />
                                ) : (
                                    <span className="msg-content"> {renderContent(m.content)}</span>
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
            {showAdmin && initialIsAdmin && (<Suspense fallback={null}>
                <AdminPortal
                    peers={peers}
                    activityLog={activityLog}
                    bannedIps={bannedIps}
                    bankLedger={bankLedger}
                    swarm={swarmRef.current}
                    swarmLogs={swarmLogsRef.current}
                    onKick={handleAdminKick}
                    onBanIp={handleAdminBanIp}
                    onUnbanIp={handleAdminUnbanIp}
                    onAdjustBalance={handleAdminAdjustBalance}
                    onAdjustKarma={handleAdminAdjustKarma}
                    onProviderChange={(provider, defaultModel) => {
                        socket.sendChat(JSON.stringify({
                            type: 'swarm_config', provider, defaultModel,
                        }));
                    }}
                    onSettingChange={(key, value) => {
                        socket.sendChat(JSON.stringify({
                            type: 'admin_setting', key, value,
                        }));
                    }}
                    onClose={() => setShowAdmin(false)}
                />
            </Suspense>)}
        </div>
    );
}
