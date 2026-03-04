/* ═══════════════════════════════════════════════════════════
   OpenWire Web — WebSocket client for the relay server
   ═══════════════════════════════════════════════════════════ */

const RELAY_URL = import.meta.env.VITE_RELAY_URL || 'ws://localhost:8787';

let ws = null;
let listeners = [];
let reconnectTimer = null;
let pingTimer = null;

export function connect(nick, onEvent) {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    // Only keep the most recent listener to prevent duplicates on reconnect
    listeners = [onEvent];

    ws = new WebSocket(RELAY_URL);

    ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'join', nick, peer_id: generateId() }));
        // Start keep-alive pings (every 15s to beat Cloudflare idle timeout)
        if (pingTimer) clearInterval(pingTimer);
        pingTimer = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'ping' }));
            }
        }, 15000);
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
        reconnectTimer = setTimeout(() => connect(nick, onEvent), 3000);
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

function generateId() {
    return 'web-' + crypto.randomUUID().slice(0, 12);
}
