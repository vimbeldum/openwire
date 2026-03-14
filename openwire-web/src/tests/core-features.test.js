import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ═══════════════════════════════════════════════════════════════
   Mock WebSocket — identical pattern to socket.test.js
   ═══════════════════════════════════════════════════════════════ */

class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url) {
        this.url = url;
        this.readyState = MockWebSocket.CONNECTING;
        this.onopen = null;
        this.onclose = null;
        this.onmessage = null;
        this.onerror = null;
        this.sent = [];
        MockWebSocket.instances.push(this);
    }

    send(data) {
        this.sent.push(data);
    }

    close() {
        this.readyState = MockWebSocket.CLOSED;
    }

    // Test helpers
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

    _simulateError() {
        if (this.onerror) this.onerror(new Event('error'));
    }
}

MockWebSocket.instances = [];

// Install WebSocket mock globally before any module loads
vi.stubGlobal('WebSocket', MockWebSocket);

/* ═══════════════════════════════════════════════════════════════
   Mock localStorage — Map-backed, same interface as the real API
   ═══════════════════════════════════════════════════════════════ */

function createLocalStorageMock() {
    const store = new Map();
    return {
        getItem(key) {
            return store.has(key) ? store.get(key) : null;
        },
        setItem(key, value) {
            store.set(key, String(value));
        },
        removeItem(key) {
            store.delete(key);
        },
        clear() {
            store.clear();
        },
        get length() {
            return store.size;
        },
        key(index) {
            return Array.from(store.keys())[index] ?? null;
        },
        // Expose the backing store for assertion convenience
        _store: store,
    };
}

const mockLocalStorage = createLocalStorageMock();
vi.stubGlobal('localStorage', mockLocalStorage);

/* ═══════════════════════════════════════════════════════════════
   Module state — fresh import per test to reset module-level vars
   ═══════════════════════════════════════════════════════════════ */

let socketModule;
let casinoModule;

beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    MockWebSocket.instances = [];
    mockLocalStorage.clear();

    vi.resetModules();
    [socketModule, casinoModule] = await Promise.all([
        import('../lib/socket.js'),
        import('../lib/casinoState.js'),
    ]);
});

afterEach(() => {
    if (socketModule) socketModule.disconnect();
    vi.useRealTimers();
});

/* ═══════════════════════════════════════════════════════════════
   Helper: most recently created WebSocket instance
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
   PART A — Socket Transport Layer (socket.js)
   ═══════════════════════════════════════════════════════════════ */

/* ─── A-1: Default state getters ───────────────────────────── */

describe('A-1: getConnectionMode() and getCliNodeHost() defaults', () => {
    it('getConnectionMode() returns "relay" by default', () => {
        expect(socketModule.getConnectionMode()).toBe('relay');
    });

    it('getCliNodeHost() returns null by default', () => {
        expect(socketModule.getCliNodeHost()).toBe(null);
    });
});

/* ─── A-2: isBridgePeer() ───────────────────────────────────── */

describe('A-2: isBridgePeer()', () => {
    it('returns true when is_bridge === true', () => {
        expect(socketModule.isBridgePeer({ is_bridge: true })).toBe(true);
    });

    it('returns false when is_bridge === false', () => {
        expect(socketModule.isBridgePeer({ is_bridge: false })).toBe(false);
    });

    it('returns false when is_bridge property is absent', () => {
        expect(socketModule.isBridgePeer({ nick: 'peer' })).toBe(false);
    });

    it('returns false for null peer argument', () => {
        expect(socketModule.isBridgePeer(null)).toBe(false);
    });

    it('returns false for undefined peer argument', () => {
        expect(socketModule.isBridgePeer(undefined)).toBe(false);
    });

    it('returns false when is_bridge is truthy but not strictly true (e.g. 1)', () => {
        expect(socketModule.isBridgePeer({ is_bridge: 1 })).toBe(false);
    });

    it('returns false when is_bridge is the string "true"', () => {
        expect(socketModule.isBridgePeer({ is_bridge: 'true' })).toBe(false);
    });
});

/* ─── A-3: Rate limiting — queue and drop behaviour ─────────── */

describe('A-3: send() — rate limiting and queue', () => {
    it('queues messages when all 40 tokens are exhausted', () => {
        const { ws } = connectAndOpen();
        // join message was sent directly in onopen, tokens untouched
        // exhaust all 40 tokens
        for (let i = 0; i < 40; i++) {
            socketModule.send({ type: 'bulk', i });
        }
        // 40 direct sends + 1 join = 41 total on ws.sent
        expect(ws.sent).toHaveLength(41);

        // 41st send() call should be queued, NOT immediately transmitted
        socketModule.send({ type: 'queued_msg' });
        expect(ws.sent).toHaveLength(41);
    });

    it('queues >40 messages without throwing', () => {
        const { ws } = connectAndOpen();
        // Send 55 messages through send()
        for (let i = 0; i < 55; i++) {
            socketModule.send({ type: 'bulk', i });
        }
        // First 40 are direct sends, remaining 15 queued
        expect(ws.sent.length).toBe(41); // 40 + join
    });

    it('drops oldest queued message when queue exceeds MAX_QUEUE_SIZE (100)', () => {
        const { ws } = connectAndOpen();

        // Exhaust all tokens
        for (let i = 0; i < 40; i++) {
            socketModule.send({ type: 'initial', i });
        }

        // Fill queue to exactly MAX_QUEUE_SIZE with a sentinel at position 0
        socketModule.send({ type: 'OLDEST' });
        for (let i = 0; i < 99; i++) {
            socketModule.send({ type: 'filler', i });
        }
        // Queue now has 100 items; push one more to force the drop
        socketModule.send({ type: 'NEW_TRIGGER' });

        // Drain the queue by advancing time well past the refill window.
        // With refillRate=30/s, 4 seconds = 120 tokens — enough to drain all 101
        // queued items (but the oldest was already dropped from 100).
        vi.advanceTimersByTime(4000);

        const allSent = ws.sent.map(s => JSON.parse(s));
        const oldestFound = allSent.some(m => m.type === 'OLDEST');
        // OLDEST should have been dropped when the 101st item was enqueued
        expect(oldestFound).toBe(false);
    });
});

/* ─── A-4: disconnect() ─────────────────────────────────────── */

describe('A-4: disconnect()', () => {
    it('clears the message queue (no pending sends after close)', () => {
        const { ws } = connectAndOpen();

        // Exhaust tokens then queue a message
        for (let i = 0; i < 40; i++) socketModule.send({ type: 'bulk', i });
        socketModule.send({ type: 'pending' });

        socketModule.disconnect();

        // Advance well past refill time — queue should not drain
        vi.advanceTimersByTime(5000);

        const allSent = ws.sent.map(s => JSON.parse(s));
        expect(allSent.some(m => m.type === 'pending')).toBe(false);
    });

    it('clears listeners so no further events are delivered', () => {
        const { ws, onEvent } = connectAndOpen();
        onEvent.mockClear();

        socketModule.disconnect();
        // Manually trigger close on ws — listener array should be empty
        if (ws.onclose) ws.onclose();

        // onEvent should NOT have been called because listeners were cleared
        // (disconnect sets ws.onclose = null before closing, so this is a
        //  belt-and-braces check on the listener array)
        expect(onEvent).not.toHaveBeenCalled();
    });

    it('prevents the reconnect timer from firing after disconnect', () => {
        const { ws } = connectAndOpen();
        ws._simulateClose();      // schedules reconnect timer

        // Disconnect cancels the timer
        socketModule.disconnect();

        vi.advanceTimersByTime(35000);

        // Only the original instance should exist — no reconnect occurred
        expect(MockWebSocket.instances).toHaveLength(1);
    });

    it('can be called multiple times without throwing', () => {
        expect(() => {
            socketModule.disconnect();
            socketModule.disconnect();
        }).not.toThrow();
    });
});

/* ─── A-5: Convenience send helpers ─────────────────────────── */

describe('A-5: Convenience send helpers', () => {
    let ws;

    beforeEach(() => {
        ({ ws } = connectAndOpen());
    });

    it('sendChat sends { type: "message", data: text }', () => {
        socketModule.sendChat('hello world');
        const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
        expect(msg).toEqual({ type: 'message', data: 'hello world' });
    });

    it('createRoom sends { type: "room_create", name }', () => {
        socketModule.createRoom('lobby');
        const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
        expect(msg).toEqual({ type: 'room_create', name: 'lobby' });
    });

    it('joinRoom sends { type: "room_join", room_id: roomId }', () => {
        socketModule.joinRoom('room-42');
        const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
        expect(msg).toEqual({ type: 'room_join', room_id: 'room-42' });
    });

    it('leaveRoom sends { type: "room_leave", room_id: roomId }', () => {
        socketModule.leaveRoom('room-42');
        const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
        expect(msg).toEqual({ type: 'room_leave', room_id: 'room-42' });
    });

    it('sendRoomMessage sends { type: "room_message", room_id, data }', () => {
        socketModule.sendRoomMessage('room-42', 'hi there');
        const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
        expect(msg).toEqual({ type: 'room_message', room_id: 'room-42', data: 'hi there' });
    });
});

/* ─── A-6: onopen — join message ────────────────────────────── */

describe('A-6: onopen join messages', () => {
    it('sends { type: "join", nick } as the first message on open', () => {
        socketModule.connect('Alice', vi.fn());
        const ws = latestWs();
        ws._simulateOpen();

        expect(ws.sent).toHaveLength(1);
        expect(JSON.parse(ws.sent[0])).toEqual({ type: 'join', nick: 'Alice' });
    });

    it('includes admin_secret when adminSecret is provided', () => {
        socketModule.connect('Admin', vi.fn(), { isAdmin: true, adminSecret: 'sekr3t' });
        const ws = latestWs();
        ws._simulateOpen();

        const join = JSON.parse(ws.sent[0]);
        expect(join).toEqual({ type: 'join', nick: 'Admin', admin_secret: 'sekr3t' });
    });

    it('omits admin_secret when adminSecret is empty string', () => {
        socketModule.connect('User', vi.fn(), { isAdmin: false, adminSecret: '' });
        const ws = latestWs();
        ws._simulateOpen();

        const join = JSON.parse(ws.sent[0]);
        expect(join).not.toHaveProperty('admin_secret');
    });
});

/* ─── A-7: onclose — disconnected event ─────────────────────── */

describe('A-7: onclose emits disconnected event', () => {
    it('emits { type: "disconnected" } to listener on close', () => {
        const { ws, onEvent } = connectAndOpen();
        onEvent.mockClear();

        ws._simulateClose();

        expect(onEvent).toHaveBeenCalledWith({ type: 'disconnected' });
    });
});

/* ─── A-8: onmessage — parsing and filtering ─────────────────── */

describe('A-8: onmessage — parsing and filtering', () => {
    it('parses JSON and dispatches to listeners', () => {
        const { ws, onEvent } = connectAndOpen();
        ws._simulateMessage({ type: 'chat', text: 'yo' });
        expect(onEvent).toHaveBeenCalledWith({ type: 'chat', text: 'yo' });
    });

    it('does not dispatch pong messages to listeners', () => {
        const { ws, onEvent } = connectAndOpen();
        onEvent.mockClear();
        ws._simulateMessage({ type: 'pong' });
        expect(onEvent).not.toHaveBeenCalled();
    });

    it('does not dispatch rate_limited messages to listeners', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { ws, onEvent } = connectAndOpen();
        onEvent.mockClear();
        ws._simulateMessage({ type: 'rate_limited' });
        expect(onEvent).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('handles malformed JSON without throwing', () => {
        const { ws } = connectAndOpen();
        expect(() => {
            ws.onmessage({ data: '{{not valid json' });
        }).not.toThrow();
    });
});

/* ─── A-9: Reconnect — exponential backoff ───────────────────── */

describe('A-9: Reconnect with exponential backoff', () => {
    it('schedules reconnect within ~2s after first close (attempt 0)', () => {
        const onEvent = vi.fn();
        socketModule.connect('User', onEvent);
        const ws = latestWs();
        ws._simulateOpen();
        ws._simulateClose();

        // Reconnect attempt 0: delay = BASE(1000) * 2^0 + random(0-1000) = 1000-2000ms
        vi.advanceTimersByTime(2500);
        expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(2);
    });

    it('uses longer backoff for the second attempt (~2000-3000ms)', () => {
        const onEvent = vi.fn();
        socketModule.connect('User', onEvent);

        const ws1 = latestWs();
        ws1._simulateOpen();
        ws1._simulateClose();  // attempt 0 → delay ~1-2s

        // Trigger first reconnect
        vi.advanceTimersByTime(2500);
        const ws2 = latestWs();
        expect(MockWebSocket.instances).toHaveLength(2);

        ws2._simulateClose(); // attempt 1 → delay ~2-3s

        // Should NOT reconnect at 1000ms from second close
        vi.advanceTimersByTime(1000);
        expect(MockWebSocket.instances).toHaveLength(2);

        // Should reconnect within the full window
        vi.advanceTimersByTime(2500);
        expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(3);
    });
});

/* ─── A-10: Max reconnect attempts ─────────────────────────── */

describe('A-10: reconnect_failed after 25 attempts', () => {
    it('emits { type: "reconnect_failed" } after MAX_RECONNECT_ATTEMPTS', () => {
        const onEvent = vi.fn();
        socketModule.connect('User', onEvent);

        // Simulate 25 close-without-open cycles to exhaust attempt counter
        for (let i = 0; i < 25; i++) {
            const ws = latestWs();
            ws._simulateClose();
            vi.advanceTimersByTime(35000);
        }

        // The 26th close should trigger reconnect_failed
        const ws26 = latestWs();
        ws26._simulateClose();

        const failures = onEvent.mock.calls.filter(([msg]) => msg.type === 'reconnect_failed');
        expect(failures.length).toBeGreaterThanOrEqual(1);
    });
});

/* ─── A-11: connectToCliNode() ──────────────────────────────── */

describe('A-11: connectToCliNode()', () => {
    it('falls back to relay mode when URL is invalid', () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const onEvent = vi.fn();
        socketModule.connectToCliNode('not-a-valid-url!!!', 'User', onEvent);

        expect(socketModule.getConnectionMode()).toBe('relay');
        expect(socketModule.getCliNodeHost()).toBeNull();
        errorSpy.mockRestore();
    });

    it('normalises a URL without a path by appending /ws', () => {
        const onEvent = vi.fn();
        socketModule.connectToCliNode('ws://192.168.1.5:18080', 'User', onEvent);
        const ws = latestWs();
        expect(ws.url).toContain('/ws');
    });

    it('emits cli_node_connecting event immediately', () => {
        const onEvent = vi.fn();
        socketModule.connectToCliNode('ws://192.168.1.5:18080', 'User', onEvent);
        const events = onEvent.mock.calls.map(([e]) => e.type);
        expect(events).toContain('cli_node_connecting');
    });

    it('sets connection mode to cli-node on valid URL', () => {
        const onEvent = vi.fn();
        socketModule.connectToCliNode('ws://192.168.1.5:18080', 'User', onEvent);
        expect(socketModule.getConnectionMode()).toBe('cli-node');
    });

    it('stores the CLI node host when mode is cli-node', () => {
        const onEvent = vi.fn();
        socketModule.connectToCliNode('ws://192.168.1.5:18080', 'User', onEvent);
        expect(socketModule.getCliNodeHost()).toBe('192.168.1.5:18080');
    });
});

/* ═══════════════════════════════════════════════════════════════
   PART B — Casino State P2P Sync (casinoState.js)
   ═══════════════════════════════════════════════════════════════ */

/* ─── B-1: createCasinoState() ──────────────────────────────── */

describe('B-1: createCasinoState()', () => {
    it('returns an object with a housePnl sub-object', () => {
        const state = casinoModule.createCasinoState();
        expect(state).toHaveProperty('housePnl');
        expect(typeof state.housePnl).toBe('object');
    });

    it('housePnl contains roulette initialized to 0', () => {
        const state = casinoModule.createCasinoState();
        expect(state.housePnl.roulette).toBe(0);
    });

    it('housePnl contains blackjack initialized to 0', () => {
        const state = casinoModule.createCasinoState();
        expect(state.housePnl.blackjack).toBe(0);
    });

    it('housePnl contains andarbahar initialized to 0', () => {
        const state = casinoModule.createCasinoState();
        expect(state.housePnl.andarbahar).toBe(0);
    });

    it('housePnl contains slots initialized to 0', () => {
        const state = casinoModule.createCasinoState();
        expect(state.housePnl.slots).toBe(0);
    });

    it('includes a _ts timestamp greater than 0', () => {
        const state = casinoModule.createCasinoState();
        expect(state._ts).toBeGreaterThan(0);
        expect(state.housePnl._ts).toBeGreaterThan(0);
    });
});

/* ─── B-2: mergeCasinoStates() — LWW semantics ──────────────── */

describe('B-2: mergeCasinoStates() — LWW semantics', () => {
    it('remote wins when remote.housePnl._ts is higher', () => {
        const local = {
            _ts: 100,
            housePnl: { _ts: 100, roulette: 0, blackjack: 0, andarbahar: 0, slots: 0 },
        };
        const remote = {
            _ts: 200,
            housePnl: { _ts: 200, roulette: 500, blackjack: 0, andarbahar: 0, slots: 0 },
        };

        const merged = casinoModule.mergeCasinoStates(local, remote);
        expect(merged.housePnl.roulette).toBe(500);
        expect(merged.housePnl._ts).toBe(200);
    });

    it('local wins when local.housePnl._ts is higher', () => {
        const local = {
            _ts: 300,
            housePnl: { _ts: 300, roulette: 999, blackjack: 0, andarbahar: 0, slots: 0 },
        };
        const remote = {
            _ts: 100,
            housePnl: { _ts: 100, roulette: 1, blackjack: 0, andarbahar: 0, slots: 0 },
        };

        const merged = casinoModule.mergeCasinoStates(local, remote);
        expect(merged.housePnl.roulette).toBe(999);
    });

    it('returns local unchanged when remote is null', () => {
        const local = casinoModule.createCasinoState();
        const merged = casinoModule.mergeCasinoStates(local, null);
        expect(merged).toBe(local);
    });

    it('returns remote when local is null', () => {
        const remote = casinoModule.createCasinoState();
        const merged = casinoModule.mergeCasinoStates(null, remote);
        expect(merged).toBe(remote);
    });

    it('top-level _ts is set to the maximum of both sides', () => {
        const local  = { _ts: 50,  housePnl: { _ts: 50,  roulette: 0, blackjack: 0, andarbahar: 0, slots: 0 } };
        const remote = { _ts: 150, housePnl: { _ts: 40,  roulette: 0, blackjack: 0, andarbahar: 0, slots: 0 } };

        const merged = casinoModule.mergeCasinoStates(local, remote);
        expect(merged._ts).toBe(150);
    });

    it('top-level _ts is max even when local _ts is higher', () => {
        const local  = { _ts: 400, housePnl: { _ts: 400, roulette: 0, blackjack: 0, andarbahar: 0, slots: 0 } };
        const remote = { _ts: 200, housePnl: { _ts: 200, roulette: 0, blackjack: 0, andarbahar: 0, slots: 0 } };

        const merged = casinoModule.mergeCasinoStates(local, remote);
        expect(merged._ts).toBe(400);
    });
});

/* ─── B-3: updateHousePnl() ─────────────────────────────────── */

describe('B-3: updateHousePnl()', () => {
    it('adds 150 to house roulette PnL when players lose -100 and -50', () => {
        const state = casinoModule.createCasinoState();
        const updated = casinoModule.updateHousePnl(state, 'roulette', { p1: -100, p2: -50 });
        // houseGain = -((-100) + (-50)) = 150
        expect(updated.housePnl.roulette).toBe(150);
    });

    it('subtracts 200 from house blackjack PnL when player wins +200', () => {
        const state = casinoModule.createCasinoState();
        const updated = casinoModule.updateHousePnl(state, 'blackjack', { p1: 200 });
        // houseGain = -(200) = -200
        expect(updated.housePnl.blackjack).toBe(-200);
    });

    it('accumulates PnL across multiple rounds', () => {
        let state = casinoModule.createCasinoState();
        state = casinoModule.updateHousePnl(state, 'slots', { p1: -50 });
        state = casinoModule.updateHousePnl(state, 'slots', { p1: -25 });
        // round 1: houseGain = 50; round 2: houseGain = 25; total = 75
        expect(state.housePnl.slots).toBe(75);
    });

    it('does not mutate other game types when updating one', () => {
        const state = casinoModule.createCasinoState();
        const updated = casinoModule.updateHousePnl(state, 'andarbahar', { p1: -100 });
        expect(updated.housePnl.roulette).toBe(0);
        expect(updated.housePnl.blackjack).toBe(0);
        expect(updated.housePnl.slots).toBe(0);
    });

    it('updates housePnl._ts on every call', () => {
        const state = casinoModule.createCasinoState();
        const tsBefore = state.housePnl._ts;
        vi.advanceTimersByTime(10); // ensure clock advances
        const updated = casinoModule.updateHousePnl(state, 'roulette', { p1: -10 });
        expect(updated.housePnl._ts).toBeGreaterThan(0);
        // _ts should be set (monotonically increasing even with same ms)
        expect(updated.housePnl._ts).toBeGreaterThanOrEqual(tsBefore);
    });

    it('persists to localStorage after update', () => {
        const state = casinoModule.createCasinoState();
        casinoModule.updateHousePnl(state, 'roulette', { p1: -300 });
        // saveCasinoState is debounced by 1s; flush the timer
        vi.advanceTimersByTime(1500);
        const stored = mockLocalStorage.getItem('openwire_casino_v1');
        expect(stored).not.toBeNull();
        const parsed = JSON.parse(stored);
        expect(parsed.housePnl.roulette).toBe(300);
    });
});

/* ─── B-4: getTotalHousePnl() ───────────────────────────────── */

describe('B-4: getTotalHousePnl()', () => {
    it('sums all game types and excludes _ts', () => {
        const state = {
            _ts: 999,
            housePnl: { _ts: 999, roulette: 100, blackjack: -50, andarbahar: 25, slots: 75 },
        };
        expect(casinoModule.getTotalHousePnl(state)).toBe(150);
    });

    it('returns 0 when all game PnLs are zero', () => {
        const state = casinoModule.createCasinoState();
        expect(casinoModule.getTotalHousePnl(state)).toBe(0);
    });

    it('handles negative total correctly', () => {
        const state = {
            _ts: 1,
            housePnl: { _ts: 1, roulette: -200, blackjack: -100, andarbahar: 0, slots: 0 },
        };
        expect(casinoModule.getTotalHousePnl(state)).toBe(-300);
    });
});

/* ─── B-5: Serialization / deserialization ───────────────────── */

describe('B-5: serializeCasinoState()', () => {
    it('returns a string prefixed with "CS:"', () => {
        const state = casinoModule.createCasinoState();
        const serialized = casinoModule.serializeCasinoState(state);
        expect(serialized.startsWith('CS:')).toBe(true);
    });

    it('the payload after "CS:" is valid JSON containing the state', () => {
        const state = casinoModule.createCasinoState();
        const serialized = casinoModule.serializeCasinoState(state);
        const payload = JSON.parse(serialized.slice(3));
        expect(payload).toHaveProperty('housePnl');
    });
});

describe('B-6: isCasinoStateMessage()', () => {
    it('returns true for a "CS:"-prefixed string', () => {
        expect(casinoModule.isCasinoStateMessage('CS:{"foo":1}')).toBe(true);
    });

    it('returns false for a string with a different prefix', () => {
        expect(casinoModule.isCasinoStateMessage('OTHER:{"foo":1}')).toBe(false);
    });

    it('returns false for a plain JSON string without prefix', () => {
        expect(casinoModule.isCasinoStateMessage('{"foo":1}')).toBe(false);
    });

    it('returns false for a non-string value', () => {
        expect(casinoModule.isCasinoStateMessage(42)).toBe(false);
        expect(casinoModule.isCasinoStateMessage(null)).toBe(false);
    });
});

describe('B-7: parseCasinoState()', () => {
    it('parses a valid CS: message back to the original object', () => {
        const state = casinoModule.createCasinoState();
        const serialized = casinoModule.serializeCasinoState(state);
        const parsed = casinoModule.parseCasinoState(serialized);
        expect(parsed).toMatchObject({ housePnl: { roulette: 0 } });
    });

    it('returns null for a non-CS string', () => {
        expect(casinoModule.parseCasinoState('NOT_CS_DATA')).toBeNull();
    });

    it('returns null for a CS: prefix with invalid JSON payload', () => {
        expect(casinoModule.parseCasinoState('CS:{{bad json')).toBeNull();
    });
});

/* ─── B-8: loadCasinoState() ────────────────────────────────── */

describe('B-8: loadCasinoState()', () => {
    it('returns a fresh state with all game keys when localStorage is empty', () => {
        const state = casinoModule.loadCasinoState();
        expect(state.housePnl).toHaveProperty('roulette');
        expect(state.housePnl).toHaveProperty('blackjack');
        expect(state.housePnl).toHaveProperty('andarbahar');
        expect(state.housePnl).toHaveProperty('slots');
    });

    it('merges stored data with defaults so all game keys are present', () => {
        // Store a state that only has roulette (simulates old schema)
        mockLocalStorage.setItem(
            'openwire_casino_v1',
            JSON.stringify({ _ts: 1, housePnl: { _ts: 1, roulette: 777 } })
        );

        const state = casinoModule.loadCasinoState();
        // Existing value preserved
        expect(state.housePnl.roulette).toBe(777);
        // Missing keys filled in from defaults
        expect(state.housePnl).toHaveProperty('blackjack');
        expect(state.housePnl).toHaveProperty('andarbahar');
        expect(state.housePnl).toHaveProperty('slots');
    });

    it('returns fresh default state when localStorage contains corrupt JSON', () => {
        mockLocalStorage.setItem('openwire_casino_v1', '{{CORRUPT{{');
        const state = casinoModule.loadCasinoState();
        expect(state.housePnl.roulette).toBe(0);
    });
});
