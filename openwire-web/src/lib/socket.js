/* ═══════════════════════════════════════════════════════════
   OpenWire Web — WebSocket client for the relay server
   or a local CLI node bridge
   ═══════════════════════════════════════════════════════════ */

const RELAY_URL = import.meta.env.VITE_RELAY_URL || 'ws://localhost:8787';
const DEFAULT_CLI_BRIDGE_URL = import.meta.env.VITE_CLI_BRIDGE_URL || 'ws://localhost:18080';

// 'relay' | 'cli-node'
let _connectionMode = 'relay';
// When in cli-node mode, store the host portion for display (e.g. "192.168.1.5:18080")
let _cliNodeHost = null;

let ws = null;
let listeners = [];
let reconnectTimer = null;
let pingTimer = null;
let reconnectAttempt = 0;
const MAX_RECONNECT_ATTEMPTS = 25;
const BASE_RECONNECT_MS = 1000;
const MAX_RECONNECT_MS = 30000;

// Token bucket rate limiter
const MAX_QUEUE_SIZE = 100;
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

/**
 * Returns the current connection mode.
 * @returns {'relay' | 'cli-node'}
 */
export function getConnectionMode() {
    return _connectionMode;
}

/**
 * Returns the CLI node host string (e.g. "192.168.1.5:18080") when in cli-node mode,
 * or null when in relay mode.
 * @returns {string | null}
 */
export function getCliNodeHost() {
    return _cliNodeHost;
}

/**
 * Internal helper that opens a WebSocket to the given url and wires up
 * the standard event handlers. Used by both connect() and connectToCliNode().
 *
 * @param {string} url  Full WebSocket URL
 * @param {string} nick
 * @param {Function} onEvent
 * @param {{ isAdmin?: boolean, adminSecret?: string }} opts
 * @param {Function} reconnectFn  Called after backoff to reconnect
 */
function _openWebSocket(url, nick, onEvent, { isAdmin = false, adminSecret = '' } = {}, reconnectFn) {
    if (pingTimer) clearInterval(pingTimer);

    listeners = [onEvent];

    if (typeof window !== 'undefined' && window.location.protocol === 'https:' && !url.startsWith('wss://')) {
        console.warn('[OpenWire] Security warning: WebSocket is using an unencrypted connection (ws://) on an https:// page.');
    }

    ws = new WebSocket(url);

    ws.onopen = () => {
        reconnectAttempt = 0;
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
            if (msg.type === 'pong') return;
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
        reconnectTimer = setTimeout(reconnectFn, delay);
    };

    ws.onerror = () => { };
}

export function connect(nick, onEvent, { isAdmin = false, adminSecret = '' } = {}) {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.CLOSING)) return;

    _connectionMode = 'relay';
    _cliNodeHost = null;

    _openWebSocket(
        RELAY_URL,
        nick,
        onEvent,
        { isAdmin, adminSecret },
        () => connect(nick, onEvent, { isAdmin, adminSecret })
    );
}

/**
 * Connect directly to a CLI node's WebSocket bridge.
 * Falls back to the main relay if the CLI node connection fails.
 *
 * @param {string} cliUrl   Full WebSocket URL, e.g. "ws://192.168.1.5:18080/ws"
 *                          If no path is given, "/ws" is appended automatically.
 * @param {string} nick
 * @param {Function} onEvent
 * @param {{ isAdmin?: boolean, adminSecret?: string }} opts
 */
export function connectToCliNode(cliUrl, nick, onEvent, { isAdmin = false, adminSecret = '' } = {}) {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.CLOSING)) return;

    // Validate and normalise the URL
    let normalised = cliUrl.trim();
    if (!normalised) normalised = DEFAULT_CLI_BRIDGE_URL;
    // Ensure a path component exists
    try {
        const u = new URL(normalised);
        if (!u.pathname || u.pathname === '/') u.pathname = '/ws';
        normalised = u.toString();
        _cliNodeHost = u.host; // e.g. "192.168.1.5:18080"
    } catch {
        console.error('[OpenWire] Invalid CLI node URL:', normalised, '— falling back to relay');
        _connectionMode = 'relay';
        _cliNodeHost = null;
        connect(nick, onEvent, { isAdmin, adminSecret });
        return;
    }

    _connectionMode = 'cli-node';

    // Notify caller that we are attempting CLI-node connection
    onEvent({ type: 'cli_node_connecting', url: normalised });

    // Attempt CLI node connection; on repeated failure, fall back to relay
    let _cliAttempts = 0;
    const MAX_CLI_ATTEMPTS = 3;

    function attemptCli() {
        _openWebSocket(
            normalised,
            nick,
            onEvent,
            { isAdmin, adminSecret },
            () => {
                _cliAttempts++;
                if (_cliAttempts >= MAX_CLI_ATTEMPTS) {
                    console.warn('[OpenWire] CLI node unreachable after', MAX_CLI_ATTEMPTS, 'attempts — falling back to relay');
                    onEvent({ type: 'cli_node_fallback', url: normalised });
                    _connectionMode = 'relay';
                    _cliNodeHost = null;
                    reconnectAttempt = 0;
                    connect(nick, onEvent, { isAdmin, adminSecret });
                } else {
                    const delay = Math.min(
                        BASE_RECONNECT_MS * Math.pow(2, reconnectAttempt) + Math.random() * 1000,
                        MAX_RECONNECT_MS
                    );
                    reconnectAttempt++;
                    reconnectTimer = setTimeout(attemptCli, delay);
                }
            }
        );
    }

    attemptCli();
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
            if (_messageQueue.length >= MAX_QUEUE_SIZE) {
                _messageQueue.shift(); // drop oldest
            }
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

/**
 * Returns true if a peer object represents a CLI bridge node.
 * Bridge peers connect via WebSocket but relay messages to/from the
 * libp2p gossipsub network. They are identified by `is_bridge: true`
 * in the peer_joined message and in the welcome peer list.
 *
 * @param {{ is_bridge?: boolean }} peer
 * @returns {boolean}
 */
export function isBridgePeer(peer) {
    return peer?.is_bridge === true;
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
