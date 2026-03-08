/* ═══════════════════════════════════════════════════════════
   OpenWire Web — WebSocket client for the relay server
   ═══════════════════════════════════════════════════════════ */

const RELAY_URL = import.meta.env.VITE_RELAY_URL || 'ws://localhost:8787';

let ws = null;
let listeners = [];
let reconnectTimer = null;
let pingTimer = null;
let reconnectAttempt = 0;
const MAX_RECONNECT_ATTEMPTS = 25;
const BASE_RECONNECT_MS = 1000;
const MAX_RECONNECT_MS = 30000;

// Token bucket rate limiter
const RATE_LIMIT = { maxTokens: 40, refillRate: 30, refillMs: 1000 };
let _rateTokens = RATE_LIMIT.maxTokens;
let _rateLastRefill = Date.now();
let _messageQueue = [];
let _drainTimer = null;

function refillTokens() {
    const now = Date.now();
    const elapsed = now - _rateLastRefill;
    if (elapsed >= 100) { // refill every 100ms
        _rateTokens = Math.min(RATE_LIMIT.maxTokens, _rateTokens + RATE_LIMIT.refillRate * (elapsed / RATE_LIMIT.refillMs));
        _rateLastRefill = now;
    }
}

function drainQueue() {
    refillTokens();
    while (_messageQueue.length > 0 && _rateTokens >= 1) {
        const entry = _messageQueue.shift();
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(entry.data);
        }
        _rateTokens--;
    }
    // Drop messages older than 2s
    const cutoff = Date.now() - 2000;
    _messageQueue = _messageQueue.filter(m => m.queuedAt > cutoff);
    if (_messageQueue.length > 0) {
        _drainTimer = setTimeout(drainQueue, 50);
    } else {
        _drainTimer = null;
    }
}

export function connect(nick, onEvent, { isAdmin = false, adminSecret = '' } = {}) {
    if (pingTimer) clearInterval(pingTimer);
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.CLOSING)) return;

    // Only keep the most recent listener to prevent duplicates on reconnect
    listeners = [onEvent];

    if (typeof window !== 'undefined' && window.location.protocol === 'https:' && !RELAY_URL.startsWith('wss://')) {
        console.warn('[OpenWire] Security warning: WebSocket relay is using an unencrypted connection (ws://) on an https:// page. Set VITE_RELAY_URL to a wss:// endpoint.');
    }

    ws = new WebSocket(RELAY_URL);

    ws.onopen = () => {
        reconnectAttempt = 0; // Reset on successful connection
        const joinMsg = { type: 'join', nick };
        if (adminSecret) joinMsg.admin_secret = adminSecret;
        ws.send(JSON.stringify(joinMsg));
        if (pingTimer) clearInterval(pingTimer);
        const PING_BASE = 14000;
        const PING_JITTER = 2000;
        pingTimer = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'ping' }));
            }
        }, PING_BASE + Math.random() * PING_JITTER);
    };

    ws.onmessage = (e) => {
        try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'pong') return; // ignore keep-alive acks
            if (msg.type === 'rate_limited') {
                console.warn('[OpenWire] Rate limited by server');
                return;
            }
            listeners.forEach((fn) => fn(msg));
        } catch { /* ignore */ }
    };

    ws.onclose = () => {
        if (pingTimer) clearInterval(pingTimer);
        if (_drainTimer) { clearTimeout(_drainTimer); _drainTimer = null; }
        _messageQueue = [];
        listeners.forEach((fn) => fn({ type: 'disconnected' }));
        ws = null;
        // Exponential backoff with jitter — prevents reconnect storm at scale
        if (reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
            listeners.forEach((fn) => fn({ type: 'reconnect_failed' }));
            return;
        }
        clearTimeout(reconnectTimer);
        const delay = Math.min(
            BASE_RECONNECT_MS * Math.pow(2, reconnectAttempt) + Math.random() * 1000,
            MAX_RECONNECT_MS
        );
        reconnectAttempt++;
        reconnectTimer = setTimeout(() => connect(nick, onEvent, { isAdmin, adminSecret }), delay);
    };

    ws.onerror = () => { };
}

export function disconnect() {
    clearTimeout(reconnectTimer);
    if (pingTimer) clearInterval(pingTimer);
    if (_drainTimer) { clearTimeout(_drainTimer); _drainTimer = null; }
    _messageQueue = [];
    listeners = [];
    if (ws) {
        ws.onclose = null; // Prevent the reconnect loop from firing
        ws.close();
        ws = null;
    }
}

export function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        refillTokens();
        const data = JSON.stringify(msg);
        if (_rateTokens >= 1) {
            ws.send(data);
            _rateTokens--;
        } else {
            _messageQueue.push({ data, queuedAt: Date.now() });
            if (!_drainTimer) _drainTimer = setTimeout(drainQueue, 50);
        }
    }
}

export function sendChat(text) {
    send({ type: 'message', data: text });
}

export function createRoom(name) {
    send({ type: 'room_create', name });
}

export function joinRoom(roomId) {
    send({ type: 'room_join', room_id: roomId });
}

export function leaveRoom(roomId) {
    send({ type: 'room_leave', room_id: roomId });
}

export function sendRoomMessage(roomId, data) {
    send({ type: 'room_message', room_id: roomId, data });
}

export function inviteToRoom(roomId, peerId) {
    send({ type: 'room_invite', room_id: roomId, peer_id: peerId });
}

export function sendStateSnapshot(roomId, state) {
    send({ type: 'room_state_snapshot', room_id: roomId, state });
}

// Pause pings when tab is hidden
if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            // Pause ping timer
            if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
        } else {
            // Resume ping timer if connected
            if (ws && ws.readyState === WebSocket.OPEN && !pingTimer) {
                const PING_BASE = 14000;
                const PING_JITTER = 2000;
                pingTimer = setInterval(() => {
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'ping' }));
                    }
                }, PING_BASE + Math.random() * PING_JITTER);
            }
        }
    });
}

if (import.meta.hot) {
    import.meta.hot.dispose(() => disconnect());
}
