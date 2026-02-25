/* ═══════════════════════════════════════════════════════════
   OpenWire Web — WebSocket client for the relay server
   ═══════════════════════════════════════════════════════════ */

const RELAY_URL = import.meta.env.VITE_RELAY_URL || 'ws://localhost:8787';

let ws = null;
let listeners = [];
let reconnectTimer = null;

export function connect(nick, onEvent) {
    if (ws && ws.readyState === WebSocket.OPEN) return;

    listeners.push(onEvent);

    ws = new WebSocket(RELAY_URL);

    ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'join', nick, peer_id: generateId() }));
    };

    ws.onmessage = (e) => {
        try {
            const msg = JSON.parse(e.data);
            listeners.forEach((fn) => fn(msg));
        } catch { /* ignore */ }
    };

    ws.onclose = () => {
        listeners.forEach((fn) => fn({ type: 'disconnected' }));
        reconnectTimer = setTimeout(() => connect(nick, onEvent), 3000);
    };

    ws.onerror = () => { };
}

export function disconnect() {
    clearTimeout(reconnectTimer);
    listeners = [];
    if (ws) {
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
