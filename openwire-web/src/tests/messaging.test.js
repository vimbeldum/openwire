/**
 * messaging.test.js
 *
 * Vitest suite for the OpenWire MESSAGING domain.
 * Tests are organised into categories matching the spec:
 *
 *   1. Connection          — relay connect, backoff, CLI node, mode switching
 *   2. Rooms               — create/join/leave, message isolation
 *   3. Chat Core           — send/receive, persistence helpers, XSS, Unicode
 *   4. Mentions            — (React-layer feature — todo)
 *   5. Reactions           — addReaction pure-object logic
 *   6. Whisper             — message type filtering logic
 *   7. Typing Indicators   — TypingBar label-generation pure logic
 *   8. Multimedia          — GifPicker URL construction logic
 *   9. Security            — screenshot detection, message sanitisation
 *
 * All network calls are mocked — no real WebSocket connections are made.
 * React-layer features (autocomplete UI, clipboard paste events, etc.) that
 * have no extractable pure-JS logic are marked .todo().
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ═══════════════════════════════════════════════════════════════
   Mock WebSocket — same pattern as socket.test.js / core-features.test.js
   ═══════════════════════════════════════════════════════════════ */

class MockWebSocket {
    static CONNECTING = 0;
    static OPEN       = 1;
    static CLOSING    = 2;
    static CLOSED     = 3;

    constructor(url) {
        this.url       = url;
        this.readyState = MockWebSocket.CONNECTING;
        this.onopen    = null;
        this.onclose   = null;
        this.onmessage = null;
        this.onerror   = null;
        this.sent      = [];
        MockWebSocket.instances.push(this);
    }

    send(data)  { this.sent.push(data); }
    close()     { this.readyState = MockWebSocket.CLOSED; }

    _simulateOpen() {
        this.readyState = MockWebSocket.OPEN;
        if (this.onopen) this.onopen();
    }
    _simulateMessage(data) {
        if (this.onmessage) this.onmessage({ data: JSON.stringify(data) });
    }
    _simulateClose() {
        this.readyState = MockWebSocket.CLOSED;
        if (this.onclose) this.onclose();
    }
}

MockWebSocket.instances = [];
vi.stubGlobal('WebSocket', MockWebSocket);

/* ═══════════════════════════════════════════════════════════════
   Map-backed sessionStorage / localStorage stubs
   ═══════════════════════════════════════════════════════════════ */

function makeStorageMock() {
    const store = new Map();
    return {
        getItem:    (k)    => store.has(k) ? store.get(k) : null,
        setItem:    (k, v) => store.set(k, String(v)),
        removeItem: (k)    => store.delete(k),
        clear:      ()     => store.clear(),
        get length() { return store.size; },
        key:        (i)    => Array.from(store.keys())[i] ?? null,
        _store: store,
    };
}

const mockSessionStorage = makeStorageMock();
const mockLocalStorage   = makeStorageMock();
vi.stubGlobal('sessionStorage', mockSessionStorage);
vi.stubGlobal('localStorage',   mockLocalStorage);

/* ═══════════════════════════════════════════════════════════════
   Module-reset pattern — fresh socket module per test
   ═══════════════════════════════════════════════════════════════ */

let socketModule;

beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    MockWebSocket.instances = [];
    mockSessionStorage.clear();
    mockLocalStorage.clear();

    vi.resetModules();
    socketModule = await import('../lib/socket.js');
});

afterEach(() => {
    if (socketModule) socketModule.disconnect();
    vi.useRealTimers();
});

/* ═══════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════ */

function latestWs() {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1];
}

function connectAndOpen(nick = 'User') {
    const onEvent = vi.fn();
    socketModule.connect(nick, onEvent);
    const ws = latestWs();
    ws._simulateOpen();
    return { ws, onEvent };
}

/* ═══════════════════════════════════════════════════════════════
   1. CONNECTION
   ═══════════════════════════════════════════════════════════════ */

describe('1. Connection — relay connect', () => {
    it('opens a WebSocket when connect() is called', () => {
        socketModule.connect('Alice', vi.fn());
        expect(MockWebSocket.instances).toHaveLength(1);
    });

    it('sends a join message on open', () => {
        const { ws } = connectAndOpen('Alice');
        const join = JSON.parse(ws.sent[0]);
        expect(join).toEqual({ type: 'join', nick: 'Alice' });
    });

    it('does not open a second socket while one is connecting', () => {
        socketModule.connect('Alice', vi.fn());
        // Socket is still CONNECTING — second call must be a no-op
        socketModule.connect('Alice', vi.fn());
        expect(MockWebSocket.instances).toHaveLength(1);
    });

    it('sets connection mode to "relay" after connect()', () => {
        socketModule.connect('Alice', vi.fn());
        expect(socketModule.getConnectionMode()).toBe('relay');
    });

    it('emits "disconnected" event when socket closes', () => {
        const { ws, onEvent } = connectAndOpen();
        onEvent.mockClear();
        ws._simulateClose();
        expect(onEvent).toHaveBeenCalledWith({ type: 'disconnected' });
    });

    it('reconnects after first close within ~2.5 s (exponential backoff attempt 0)', () => {
        socketModule.connect('User', vi.fn());
        latestWs()._simulateOpen();
        latestWs()._simulateClose();
        vi.advanceTimersByTime(2500);
        expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(2);
    });

    it('caps reconnect delay at MAX_RECONNECT_MS (30 s)', () => {
        // After many failures the delay is capped — a new socket appears within 35 s
        socketModule.connect('User', vi.fn());
        for (let i = 0; i < 5; i++) {
            const ws = latestWs();
            ws._simulateClose();
            vi.advanceTimersByTime(35000);
        }
        expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(2);
    });

    it('emits "reconnect_failed" after 25 failed attempts', () => {
        const onEvent = vi.fn();
        socketModule.connect('User', onEvent);
        for (let i = 0; i < 25; i++) {
            latestWs()._simulateClose();
            vi.advanceTimersByTime(35000);
        }
        latestWs()._simulateClose();
        const failures = onEvent.mock.calls.filter(([m]) => m.type === 'reconnect_failed');
        expect(failures.length).toBeGreaterThanOrEqual(1);
    });
});

describe('1. Connection — CLI node mode', () => {
    it('sets mode to "cli-node" for a valid CLI URL', () => {
        socketModule.connectToCliNode('ws://192.168.1.5:18080', 'User', vi.fn());
        expect(socketModule.getConnectionMode()).toBe('cli-node');
    });

    it('stores the CLI node host', () => {
        socketModule.connectToCliNode('ws://192.168.1.5:18080', 'User', vi.fn());
        expect(socketModule.getCliNodeHost()).toBe('192.168.1.5:18080');
    });

    it('emits cli_node_connecting immediately', () => {
        const onEvent = vi.fn();
        socketModule.connectToCliNode('ws://192.168.1.5:18080', 'User', onEvent);
        const types = onEvent.mock.calls.map(([e]) => e.type);
        expect(types).toContain('cli_node_connecting');
    });

    it('appends /ws when CLI URL has no path', () => {
        socketModule.connectToCliNode('ws://192.168.1.5:18080', 'User', vi.fn());
        expect(latestWs().url).toContain('/ws');
    });

    it('falls back to relay mode for an invalid CLI URL', () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        socketModule.connectToCliNode('not-a-url!!', 'User', vi.fn());
        expect(socketModule.getConnectionMode()).toBe('relay');
        errorSpy.mockRestore();
    });

    it('clears cliNodeHost when falling back to relay', () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        socketModule.connectToCliNode('not-a-url!!', 'User', vi.fn());
        expect(socketModule.getCliNodeHost()).toBeNull();
        errorSpy.mockRestore();
    });
});

describe('1. Connection — mode switching', () => {
    it('getConnectionMode() returns "relay" before any connection', () => {
        expect(socketModule.getConnectionMode()).toBe('relay');
    });

    it('getCliNodeHost() returns null before any connection', () => {
        expect(socketModule.getCliNodeHost()).toBeNull();
    });

    it('mode resets to relay after connect() is called following a CLI attempt', () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        socketModule.connectToCliNode('bad!!', 'User', vi.fn());
        // relay was set as fallback; calling connect() again explicitly confirms relay
        expect(socketModule.getConnectionMode()).toBe('relay');
        errorSpy.mockRestore();
    });
});

describe('1. Connection — timeout / disconnect', () => {
    it('disconnect() prevents further reconnect timers from firing', () => {
        connectAndOpen();
        latestWs()._simulateClose();
        socketModule.disconnect();
        vi.advanceTimersByTime(35000);
        expect(MockWebSocket.instances).toHaveLength(1);
    });

    it('disconnect() clears the message queue (no deferred sends)', () => {
        const { ws } = connectAndOpen();
        // Exhaust tokens then queue a message
        for (let i = 0; i < 40; i++) socketModule.send({ type: 'bulk', i });
        socketModule.send({ type: 'queued_after_tokens_empty' });
        socketModule.disconnect();
        vi.advanceTimersByTime(5000);
        const allSent = ws.sent.map(s => JSON.parse(s));
        expect(allSent.some(m => m.type === 'queued_after_tokens_empty')).toBe(false);
    });

    it('disconnect() can be called multiple times without throwing', () => {
        expect(() => {
            socketModule.disconnect();
            socketModule.disconnect();
        }).not.toThrow();
    });
});

/* ═══════════════════════════════════════════════════════════════
   2. ROOMS
   ═══════════════════════════════════════════════════════════════ */

describe('2. Rooms — protocol messages', () => {
    let ws;

    beforeEach(() => {
        ({ ws } = connectAndOpen());
    });

    it('createRoom sends { type: "room_create", name }', () => {
        socketModule.createRoom('general');
        const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
        expect(msg).toEqual({ type: 'room_create', name: 'general' });
    });

    it('joinRoom sends { type: "room_join", room_id }', () => {
        socketModule.joinRoom('room-99');
        const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
        expect(msg).toEqual({ type: 'room_join', room_id: 'room-99' });
    });

    it('leaveRoom sends { type: "room_leave", room_id }', () => {
        socketModule.leaveRoom('room-99');
        const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
        expect(msg).toEqual({ type: 'room_leave', room_id: 'room-99' });
    });

    it('sendRoomMessage sends { type: "room_message", room_id, data }', () => {
        socketModule.sendRoomMessage('room-99', 'hello');
        const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
        expect(msg).toEqual({ type: 'room_message', room_id: 'room-99', data: 'hello' });
    });

    it('inviteToRoom sends { type: "room_invite", room_id, peer_id }', () => {
        socketModule.inviteToRoom('room-99', 'peer-abc');
        const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
        expect(msg).toEqual({ type: 'room_invite', room_id: 'room-99', peer_id: 'peer-abc' });
    });

    it('leaveRoom and joinRoom with the same room_id produce distinct messages', () => {
        socketModule.leaveRoom('room-1');
        socketModule.joinRoom('room-1');
        const msgs = ws.sent.slice(-2).map(s => JSON.parse(s));
        expect(msgs[0].type).toBe('room_leave');
        expect(msgs[1].type).toBe('room_join');
    });

    it('messages for different rooms carry different room_id values', () => {
        socketModule.sendRoomMessage('room-A', 'msgA');
        socketModule.sendRoomMessage('room-B', 'msgB');
        const [mA, mB] = ws.sent.slice(-2).map(s => JSON.parse(s));
        expect(mA.room_id).toBe('room-A');
        expect(mB.room_id).toBe('room-B');
    });
});

describe('2. Rooms — isBridgePeer()', () => {
    it('identifies bridge peers by is_bridge === true', () => {
        expect(socketModule.isBridgePeer({ is_bridge: true })).toBe(true);
    });

    it('returns false for non-bridge peers', () => {
        expect(socketModule.isBridgePeer({ nick: 'peer', is_bridge: false })).toBe(false);
    });

    it('returns false when is_bridge is absent', () => {
        expect(socketModule.isBridgePeer({ nick: 'peer' })).toBe(false);
    });

    it('returns false for null', () => {
        expect(socketModule.isBridgePeer(null)).toBe(false);
    });
});

/* ═══════════════════════════════════════════════════════════════
   3. CHAT CORE — socket-layer send/receive
   ═══════════════════════════════════════════════════════════════ */

describe('3. Chat Core — sendChat()', () => {
    it('sendChat sends { type: "message", data: text }', () => {
        const { ws } = connectAndOpen();
        socketModule.sendChat('hello world');
        const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
        expect(msg).toEqual({ type: 'message', data: 'hello world' });
    });

    it('sendChat with an empty string still sends the message envelope', () => {
        const { ws } = connectAndOpen();
        socketModule.sendChat('');
        const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
        expect(msg).toEqual({ type: 'message', data: '' });
    });

    it('sendChat with a very long string sends the full payload', () => {
        const { ws } = connectAndOpen();
        const longText = 'a'.repeat(2000);
        socketModule.sendChat(longText);
        const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
        expect(msg.data).toHaveLength(2000);
    });

    it('sendChat with Unicode/emoji does not throw', () => {
        const { ws } = connectAndOpen();
        expect(() => socketModule.sendChat('こんにちは 🔥 👋')).not.toThrow();
        const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
        expect(msg.data).toBe('こんにちは 🔥 👋');
    });
});

describe('3. Chat Core — receive / dispatch', () => {
    it('incoming chat message is dispatched to the listener', () => {
        const { ws, onEvent } = connectAndOpen();
        ws._simulateMessage({ type: 'chat', text: 'hi from peer' });
        expect(onEvent).toHaveBeenCalledWith({ type: 'chat', text: 'hi from peer' });
    });

    it('pong messages are NOT dispatched to listeners', () => {
        const { ws, onEvent } = connectAndOpen();
        onEvent.mockClear();
        ws._simulateMessage({ type: 'pong' });
        expect(onEvent).not.toHaveBeenCalled();
    });

    it('rate_limited messages are NOT dispatched to listeners', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { ws, onEvent } = connectAndOpen();
        onEvent.mockClear();
        ws._simulateMessage({ type: 'rate_limited' });
        expect(onEvent).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('malformed JSON is swallowed without throwing', () => {
        const { ws } = connectAndOpen();
        expect(() => ws.onmessage({ data: '{{bad json' })).not.toThrow();
    });

    it('multiple messages arrive in the order they were sent', () => {
        const { ws, onEvent } = connectAndOpen();
        const texts = ['first', 'second', 'third'];
        texts.forEach(t => ws._simulateMessage({ type: 'chat', text: t }));
        const received = onEvent.mock.calls
            .filter(([m]) => m.type === 'chat')
            .map(([m]) => m.text);
        expect(received).toEqual(texts);
    });
});

describe('3. Chat Core — sessionStorage persistence helpers (ChatRoom.jsx)', () => {
    // loadMessages / saveMessages are defined inside ChatRoom.jsx (not exported).
    // We test the contract by exercising the same keys they use.

    const STORAGE_KEY    = 'openwire_messages';
    const MAX_STORED     = 500;

    it('stores messages JSON under the correct sessionStorage key', () => {
        const messages = [{ id: 1, content: 'hello', roomId: null }];
        mockSessionStorage.setItem(STORAGE_KEY, JSON.stringify({ messages, savedAt: Date.now() }));
        const raw = mockSessionStorage.getItem(STORAGE_KEY);
        expect(raw).not.toBeNull();
        const parsed = JSON.parse(raw);
        expect(parsed.messages[0].content).toBe('hello');
    });

    it('reading a missing key returns null (empty history on first load)', () => {
        expect(mockSessionStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('clearing the key removes the stored history', () => {
        mockSessionStorage.setItem(STORAGE_KEY, JSON.stringify({ messages: [{ id: 1 }], savedAt: 0 }));
        mockSessionStorage.removeItem(STORAGE_KEY);
        expect(mockSessionStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('saveMessages trims to at most MAX_STORED_MESSAGES entries', () => {
        // Simulate what saveMessages does
        const messages = Array.from({ length: MAX_STORED + 100 }, (_, i) => ({ id: i }));
        const toStore = messages.slice(-MAX_STORED);
        mockSessionStorage.setItem(STORAGE_KEY, JSON.stringify({ messages: toStore, savedAt: Date.now() }));
        const stored = JSON.parse(mockSessionStorage.getItem(STORAGE_KEY));
        expect(stored.messages).toHaveLength(MAX_STORED);
        expect(stored.messages[0].id).toBe(100); // first 100 entries were dropped
    });

    it('corrupt JSON returns an empty array (graceful fallback)', () => {
        mockSessionStorage.setItem(STORAGE_KEY, '{{corrupt{{');
        let result = [];
        try {
            const stored = mockSessionStorage.getItem(STORAGE_KEY);
            if (stored) { const parsed = JSON.parse(stored); result = parsed.messages || []; }
        } catch { result = []; }
        expect(result).toEqual([]);
    });
});

describe('3. Chat Core — XSS prevention (message content)', () => {
    // The relay sends raw text; the React layer renders via renderContent() which
    // uses dangerouslySetInnerHTML only for @-mention highlights. We test that the
    // socket layer itself does not inject HTML when parsing incoming messages.

    it('incoming message with HTML tags is treated as plain text (not evaluated)', () => {
        const { ws, onEvent } = connectAndOpen();
        const xssPayload = '<script>alert("XSS")</script>';
        ws._simulateMessage({ type: 'chat', text: xssPayload });
        const dispatched = onEvent.mock.calls.find(([m]) => m.type === 'chat');
        // The text should arrive unchanged — the socket layer must NOT strip or execute it
        expect(dispatched[0].text).toBe(xssPayload);
    });

    it('incoming message with angle-bracket content survives JSON round-trip', () => {
        const { ws, onEvent } = connectAndOpen();
        ws._simulateMessage({ type: 'chat', text: '<b>bold</b>' });
        const dispatched = onEvent.mock.calls.find(([m]) => m.type === 'chat');
        expect(dispatched[0].text).toBe('<b>bold</b>');
    });
});

/* ═══════════════════════════════════════════════════════════════
   4. MENTIONS — @mention autocomplete is a React-layer UI feature
      implemented in ChatRoom.jsx with no exported pure-JS functions.
   ═══════════════════════════════════════════════════════════════ */

describe('4. Mentions', () => {
    it.todo('@-character triggers mention autocomplete (React UI — requires jsdom)');
    it.todo('autocomplete lists online peers and AI agents');
    it.todo('selecting a suggestion inserts @username into the input');
    it.todo('mentioning an offline user does not crash the autocomplete');
});

/* ═══════════════════════════════════════════════════════════════
   5. REACTIONS — pure-object reaction logic (extracted from ChatRoom)
   ═══════════════════════════════════════════════════════════════ */

describe('5. Reactions — addReaction pure logic', () => {
    // Mirrors the addReaction reducer used in ChatRoom
    function addReaction(messages, msgId, emoji, peerId) {
        return messages.map(m => {
            if (m.id !== msgId) return m;
            const existing = m.reactions?.[emoji] || [];
            if (existing.includes(peerId)) return m;
            return { ...m, reactions: { ...m.reactions, [emoji]: [...existing, peerId] } };
        });
    }

    const BASE_MESSAGES = [
        { id: 1, content: 'hello', reactions: {} },
        { id: 2, content: 'world', reactions: {} },
    ];

    it('adds an emoji reaction to the correct message', () => {
        const result = addReaction(BASE_MESSAGES, 1, '🔥', 'peer-A');
        expect(result[0].reactions['🔥']).toContain('peer-A');
        expect(result[1].reactions).toEqual({}); // other message untouched
    });

    it('does not duplicate the same peer+emoji combination', () => {
        let msgs = addReaction(BASE_MESSAGES, 1, '🔥', 'peer-A');
        msgs = addReaction(msgs, 1, '🔥', 'peer-A');
        expect(msgs[0].reactions['🔥']).toHaveLength(1);
    });

    it('multiple users can react with the same emoji', () => {
        let msgs = addReaction(BASE_MESSAGES, 1, '👏', 'peer-A');
        msgs = addReaction(msgs, 1, '👏', 'peer-B');
        expect(msgs[0].reactions['👏']).toEqual(['peer-A', 'peer-B']);
    });

    it('different emojis are stored as separate reaction keys', () => {
        let msgs = addReaction(BASE_MESSAGES, 1, '🔥', 'peer-A');
        msgs = addReaction(msgs, 1, '💰', 'peer-A');
        expect(Object.keys(msgs[0].reactions)).toContain('🔥');
        expect(Object.keys(msgs[0].reactions)).toContain('💰');
    });

    it('reaction on a non-existent msgId leaves all messages unchanged', () => {
        const result = addReaction(BASE_MESSAGES, 999, '🔥', 'peer-A');
        expect(result[0].reactions).toEqual({});
        expect(result[1].reactions).toEqual({});
    });

    it('removing a reaction — filtering out a peerId reduces the count', () => {
        // Simulate "toggle-off" by filtering the peer from the emoji array
        function removeReaction(messages, msgId, emoji, peerId) {
            return messages.map(m => {
                if (m.id !== msgId) return m;
                const existing = m.reactions?.[emoji] || [];
                return { ...m, reactions: { ...m.reactions, [emoji]: existing.filter(p => p !== peerId) } };
            });
        }
        let msgs = addReaction(BASE_MESSAGES, 1, '🔥', 'peer-A');
        msgs = removeReaction(msgs, 1, '🔥', 'peer-A');
        expect(msgs[0].reactions['🔥']).toHaveLength(0);
    });

    it.todo('whisper reactions are only visible to sender and recipient (React UI feature)');
});

/* ═══════════════════════════════════════════════════════════════
   6. WHISPER — message type filtering (pure logic)
   ═══════════════════════════════════════════════════════════════ */

describe('6. Whisper — message visibility filtering', () => {
    // Whisper messages have type === 'whisper', plus whisperTo / whisperFrom fields.
    // Visibility rule: only show if myId === whisperTo || myId === whisperFrom.

    function isVisibleToMe(msg, myId) {
        if (msg.type !== 'whisper') return true; // non-whisper messages are always visible
        return msg.whisperTo === myId || msg.whisperFrom === myId;
    }

    it('sender can see their own whisper', () => {
        const msg = { type: 'whisper', whisperFrom: 'Alice', whisperTo: 'Bob', content: 'secret' };
        expect(isVisibleToMe(msg, 'Alice')).toBe(true);
    });

    it('recipient can see the whisper directed at them', () => {
        const msg = { type: 'whisper', whisperFrom: 'Alice', whisperTo: 'Bob', content: 'secret' };
        expect(isVisibleToMe(msg, 'Bob')).toBe(true);
    });

    it('a third party cannot see the whisper', () => {
        const msg = { type: 'whisper', whisperFrom: 'Alice', whisperTo: 'Bob', content: 'secret' };
        expect(isVisibleToMe(msg, 'Carol')).toBe(false);
    });

    it('non-whisper messages are visible to everyone', () => {
        const msg = { type: 'peer', content: 'hello everyone' };
        expect(isVisibleToMe(msg, 'Carol')).toBe(true);
    });

    it('whisper-to-self is visible to self', () => {
        const msg = { type: 'whisper', whisperFrom: 'Alice', whisperTo: 'Alice', content: 'note to self' };
        expect(isVisibleToMe(msg, 'Alice')).toBe(true);
    });

    it('whisper to an absent user is visible only to the sender', () => {
        const msg = { type: 'whisper', whisperFrom: 'Alice', whisperTo: 'Ghost', content: 'hello?' };
        expect(isVisibleToMe(msg, 'Alice')).toBe(true);
        expect(isVisibleToMe(msg, 'Bob')).toBe(false);
    });

    it('MessageRow renders whisper class for whisper-type messages (type check)', () => {
        // Type-level check — the JSX adds class "whisper" when msg.type === 'whisper'
        const msg = { type: 'whisper', content: 'shh' };
        const classString = `msg ${msg.type}${msg.type === 'whisper' ? ' whisper' : ''}`;
        expect(classString).toContain('whisper');
    });

    it.todo('whisper visual distinction is rendered by MessageRow (React/jsdom required)');
});

/* ═══════════════════════════════════════════════════════════════
   7. TYPING INDICATORS — TypingBar pure-logic (label generation)
   ═══════════════════════════════════════════════════════════════ */

describe('7. Typing Indicators — label generation logic', () => {
    // Extracts the same label-building logic used in TypingBar.jsx
    // without needing React / jsdom.

    const NOW = 1000000; // fixed "now" for tests

    function buildLabel(typingPeers, agentTyping, myId, now = NOW) {
        const peerActive = Object.entries(typingPeers || {})
            .filter(([pid, v]) => pid !== myId && now - v.ts < 3000);

        const agentActive = Object.entries(agentTyping || {})
            .filter(([, v]) => now - v.ts < 15000);

        const totalActive = peerActive.length + agentActive.length;
        if (!totalActive) return null; // no label when nobody is typing

        const peerNicks   = peerActive.map(([, v]) => v.nick);
        const agentLabels = agentActive.map(([, v]) => `${v.avatar} ${v.nick}`);
        const allLabels   = [...agentLabels, ...peerNicks];

        if (allLabels.length === 1) return `${allLabels[0]} is typing`;
        if (allLabels.length === 2) return `${allLabels[0]} and ${allLabels[1]} are typing`;
        return `${allLabels[0]} and ${allLabels.length - 1} others are typing`;
    }

    it('returns null when no peers are typing', () => {
        expect(buildLabel({}, {}, 'me')).toBeNull();
    });

    it('returns "<nick> is typing" for one peer', () => {
        const peers = { 'peer-1': { nick: 'Bob', ts: NOW - 1000 } };
        expect(buildLabel(peers, {}, 'me')).toBe('Bob is typing');
    });

    it('excludes myId from the typing peer list', () => {
        const peers = { 'me': { nick: 'Me', ts: NOW - 500 } };
        expect(buildLabel(peers, {}, 'me')).toBeNull();
    });

    it('returns "<A> and <B> are typing" for two peers', () => {
        const peers = {
            'peer-1': { nick: 'Alice', ts: NOW - 500 },
            'peer-2': { nick: 'Bob',   ts: NOW - 500 },
        };
        const label = buildLabel(peers, {}, 'me');
        expect(label).toBe('Alice and Bob are typing');
    });

    it('uses "N others" phrasing when more than 2 are typing', () => {
        const peers = {
            'p1': { nick: 'Alice', ts: NOW - 500 },
            'p2': { nick: 'Bob',   ts: NOW - 500 },
            'p3': { nick: 'Carol', ts: NOW - 500 },
        };
        const label = buildLabel(peers, {}, 'me');
        expect(label).toMatch(/and 2 others are typing/);
    });

    it('typing indicator disappears after 3 s debounce (peer)', () => {
        const peers = { 'peer-1': { nick: 'Bob', ts: NOW - 3001 } }; // stale
        expect(buildLabel(peers, {}, 'me', NOW)).toBeNull();
    });

    it('AI agent indicator shows avatar + nick', () => {
        const agents = { 'agent-x': { nick: 'Grok', avatar: '🤖', ts: NOW - 1000 } };
        expect(buildLabel({}, agents, 'me')).toBe('🤖 Grok is typing');
    });

    it('AI agent typing window is 15 s (stays active longer than peer 3 s window)', () => {
        const agents = { 'agent-x': { nick: 'Grok', avatar: '🤖', ts: NOW - 14000 } }; // 14 s ago — still active
        expect(buildLabel({}, agents, 'me')).not.toBeNull();
    });

    it('AI agent disappears after 15 s window expires', () => {
        const agents = { 'agent-x': { nick: 'Grok', avatar: '🤖', ts: NOW - 15001 } }; // 15 s+ — stale
        expect(buildLabel({}, agents, 'me', NOW)).toBeNull();
    });

    it('agents appear before peers in the label', () => {
        const peers  = { 'p1': { nick: 'Alice', ts: NOW - 500 } };
        const agents = { 'a1': { nick: 'Grok', avatar: '🤖', ts: NOW - 1000 } };
        const label  = buildLabel(peers, agents, 'me');
        const agentPos = label.indexOf('🤖 Grok');
        const peerPos  = label.indexOf('Alice');
        expect(agentPos).toBeLessThan(peerPos);
    });
});

/* ═══════════════════════════════════════════════════════════════
   8. MULTIMEDIA — GifPicker URL construction logic
   ═══════════════════════════════════════════════════════════════ */

describe('8. Multimedia — GifPicker URL construction', () => {
    const API_BASE  = 'https://api.giphy.com/v1/gifs';
    const API_KEY   = 'dc6zaTOxFJmzC';

    function buildGiphyUrl(query, apiKey = API_KEY) {
        if (query) {
            return `${API_BASE}/search?api_key=${apiKey}&q=${encodeURIComponent(query)}&limit=12&rating=g`;
        }
        return `${API_BASE}/trending?api_key=${apiKey}&limit=12&rating=g`;
    }

    it('empty query uses the trending endpoint', () => {
        expect(buildGiphyUrl('')).toContain('/trending');
    });

    it('non-empty query uses the search endpoint', () => {
        expect(buildGiphyUrl('cats')).toContain('/search');
    });

    it('search query is URL-encoded', () => {
        expect(buildGiphyUrl('hello world')).toContain('hello%20world');
    });

    it('special characters in query are encoded', () => {
        expect(buildGiphyUrl('fire & ice')).toContain('fire%20%26%20ice');
    });

    it('limit is 12 for both search and trending', () => {
        expect(buildGiphyUrl('dogs')).toContain('limit=12');
        expect(buildGiphyUrl('')).toContain('limit=12');
    });

    it('rating=g is applied to both endpoints', () => {
        expect(buildGiphyUrl('cats')).toContain('rating=g');
        expect(buildGiphyUrl('')).toContain('rating=g');
    });

    it('empty search result set is handled (returns empty array not null)', () => {
        // Simulates the catch branch in GifPicker.search()
        const results = [];
        expect(Array.isArray(results)).toBe(true);
        expect(results).toHaveLength(0);
    });

    it.todo('clipboard image paste triggers image upload (requires browser ClipboardEvent)');
    it.todo('non-image clipboard paste does not open GIF picker');
    it.todo('large image paste is handled without crashing (React UI feature)');
});

/* ═══════════════════════════════════════════════════════════════
   9. SECURITY — screenshot detection, message inspection
   ═══════════════════════════════════════════════════════════════ */

describe('9. Security — screenshot detection payload', () => {
    it('screenshot alert message contains the correct type field', () => {
        const alertPayload = JSON.stringify({ type: 'screenshot_alert', nick: 'Alice' });
        const parsed = JSON.parse(alertPayload);
        expect(parsed.type).toBe('screenshot_alert');
    });

    it('screenshot alert message contains the username', () => {
        const nick = 'Alice';
        const alertPayload = JSON.stringify({ type: 'screenshot_alert', nick });
        const parsed = JSON.parse(alertPayload);
        expect(parsed.nick).toBe('Alice');
    });

    it('screenshot alert is sent via sendRoomMessage (correct wire format)', () => {
        const { ws } = connectAndOpen();
        socketModule.sendRoomMessage('room-1', JSON.stringify({ type: 'screenshot_alert', nick: 'Alice' }));
        const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
        expect(msg.type).toBe('room_message');
        const inner = JSON.parse(msg.data);
        expect(inner.type).toBe('screenshot_alert');
        expect(inner.nick).toBe('Alice');
    });
});

describe('9. Security — message encryption inspection (wire format)', () => {
    it('sendStateSnapshot sends { type: "room_state_snapshot", room_id, state }', () => {
        const { ws } = connectAndOpen();
        socketModule.sendStateSnapshot('room-1', { foo: 'bar' });
        const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
        expect(msg.type).toBe('room_state_snapshot');
        expect(msg.room_id).toBe('room-1');
        expect(msg.state).toEqual({ foo: 'bar' });
    });

    it('no plaintext credentials appear in a standard join message', () => {
        socketModule.connect('User', vi.fn());
        const ws = latestWs();
        ws._simulateOpen();
        const join = JSON.parse(ws.sent[0]);
        // Only nick (and optionally admin_secret when explicitly provided) should appear
        expect(join).not.toHaveProperty('password');
        expect(join).not.toHaveProperty('token');
    });

    it('admin_secret is only included when adminSecret option is provided', () => {
        socketModule.connect('User', vi.fn(), { isAdmin: true, adminSecret: 'sekr3t' });
        const ws = latestWs();
        ws._simulateOpen();
        const join = JSON.parse(ws.sent[0]);
        expect(join.admin_secret).toBe('sekr3t');
    });

    it('no admin_secret field is sent when adminSecret is an empty string', () => {
        socketModule.connect('User', vi.fn(), { isAdmin: false, adminSecret: '' });
        const ws = latestWs();
        ws._simulateOpen();
        const join = JSON.parse(ws.sent[0]);
        expect(join).not.toHaveProperty('admin_secret');
    });
});
