/* ═══════════════════════════════════════════════════════════
   OpenWire Web — WebSocket client for the relay server
   ═══════════════════════════════════════════════════════════ */

const RELAY_URL = import.meta.env.VITE_RELAY_URL || 'ws://localhost:8787';

let ws = null;
let listeners = [];
let reconnectTimer = null;
let pingTimer = null;
let reconnectAttempt = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_MS = 1000;
const MAX_RECONNECT_MS = 30000;

export function connect(nick, onEvent, { isAdmin = false } = {}) {
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
        ws.send(JSON.stringify({ type: 'join', nick, peer_id: generateId(), is_admin: isAdmin }));
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
            listeners.forEach((fn) => fn(msg));
        } catch { /* ignore */ }
    };

    ws.onclose = () => {
        if (pingTimer) clearInterval(pingTimer);
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
        reconnectTimer = setTimeout(() => connect(nick, onEvent, { isAdmin }), delay);
    };

    ws.onerror = () => { };
}

export function disconnect() {
    clearTimeout(reconnectTimer);
    if (pingTimer) clearInterval(pingTimer);
    listeners = [];
    if (ws) {
        ws.onclose = null; // Prevent the reconnect loop from firing
        ws.close();
        ws = null;
    }
}

export function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
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

let _peerId = null;
function generateId() {
    if (!_peerId) _peerId = 'web-' + crypto.randomUUID().slice(0, 12);
    return _peerId;
}

if (import.meta.hot) {
    import.meta.hot.dispose(() => disconnect());
}
