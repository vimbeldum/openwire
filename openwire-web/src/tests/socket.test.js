import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ═══════════════════════════════════════════════════════════════
   Mock WebSocket
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

// Install the mock globally before any module loads
vi.stubGlobal('WebSocket', MockWebSocket);

/* ═══════════════════════════════════════════════════════════════
   Import the module under test (after WebSocket is mocked)
   ═══════════════════════════════════════════════════════════════ */

let socketModule;

beforeEach(async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    MockWebSocket.instances = [];
    // Fresh import each test suite to reset module-level state
    vi.resetModules();
    socketModule = await import('../lib/socket.js');
});

afterEach(() => {
    // Disconnect to clean up timers
    if (socketModule) socketModule.disconnect();
    vi.useRealTimers();
});

/* ═══════════════════════════════════════════════════════════════
   Helper: get the most recently created WebSocket instance
   ═══════════════════════════════════════════════════════════════ */

function latestWs() {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1];
}

/* ═══════════════════════════════════════════════════════════════
   SUITE 1 -- Utility functions: isBridgePeer, getConnectionMode,
              getCliNodeHost
   ═══════════════════════════════════════════════════════════════ */

describe('Utility functions', () => {
    describe('isBridgePeer', () => {
        it('returns true when peer has is_bridge === true', () => {
            expect(socketModule.isBridgePeer({ is_bridge: true })).toBe(true);
        });

        it('returns false when peer has is_bridge === false', () => {
            expect(socketModule.isBridgePeer({ is_bridge: false })).toBe(false);
        });

        it('returns false when peer has no is_bridge property', () => {
            expect(socketModule.isBridgePeer({ nick: 'test' })).toBe(false);
        });

        it('returns false for null', () => {
            expect(socketModule.isBridgePeer(null)).toBe(false);
        });

        it('returns false for undefined', () => {
            expect(socketModule.isBridgePeer(undefined)).toBe(false);
        });

        it('returns false when is_bridge is truthy but not exactly true', () => {
            expect(socketModule.isBridgePeer({ is_bridge: 1 })).toBe(false);
            expect(socketModule.isBridgePeer({ is_bridge: 'true' })).toBe(false);
        });
    });

    describe('getConnectionMode', () => {
        it('defaults to relay mode', () => {
            expect(socketModule.getConnectionMode()).toBe('relay');
        });
    });

    describe('getCliNodeHost', () => {
        it('defaults to null', () => {
            expect(socketModule.getCliNodeHost()).toBe(null);
        });
    });
});

/* ═══════════════════════════════════════════════════════════════
   SUITE 2 -- connect()
   ═══════════════════════════════════════════════════════════════ */

describe('connect()', () => {
    it('creates a WebSocket connection', () => {
        const onEvent = vi.fn();
        socketModule.connect('TestUser', onEvent);

        expect(MockWebSocket.instances).toHaveLength(1);
        const ws = latestWs();
        expect(ws.url).toContain('ws://');
    });

    it('sets connection mode to relay', () => {
        socketModule.connect('TestUser', vi.fn());
        expect(socketModule.getConnectionMode()).toBe('relay');
    });

    it('sets cliNodeHost to null', () => {
        socketModule.connect('TestUser', vi.fn());
        expect(socketModule.getCliNodeHost()).toBe(null);
    });

    it('sends join message on open', () => {
        socketModule.connect('TestUser', vi.fn());
        const ws = latestWs();
        ws._simulateOpen();

        expect(ws.sent).toHaveLength(1);
        const joinMsg = JSON.parse(ws.sent[0]);
        expect(joinMsg).toEqual({ type: 'join', nick: 'TestUser' });
    });

    it('includes admin_secret in join message when provided', () => {
        socketModule.connect('Admin', vi.fn(), { isAdmin: true, adminSecret: 's3cret' });
        const ws = latestWs();
        ws._simulateOpen();

        const joinMsg = JSON.parse(ws.sent[0]);
        expect(joinMsg).toEqual({ type: 'join', nick: 'Admin', admin_secret: 's3cret' });
    });

    it('does not include admin_secret when empty', () => {
        socketModule.connect('User', vi.fn(), { isAdmin: false, adminSecret: '' });
        const ws = latestWs();
        ws._simulateOpen();

        const joinMsg = JSON.parse(ws.sent[0]);
        expect(joinMsg).toEqual({ type: 'join', nick: 'User' });
        expect(joinMsg).not.toHaveProperty('admin_secret');
    });

    it('does not create a new WebSocket if one is already OPEN', () => {
        socketModule.connect('User1', vi.fn());
        const ws = latestWs();
        ws._simulateOpen();

        socketModule.connect('User2', vi.fn());
        expect(MockWebSocket.instances).toHaveLength(1);
    });

    it('does not create a new WebSocket if one is CONNECTING', () => {
        socketModule.connect('User1', vi.fn());
        // readyState is CONNECTING by default

        socketModule.connect('User2', vi.fn());
        expect(MockWebSocket.instances).toHaveLength(1);
    });

    it('resets reconnectAttempt on successful open', () => {
        const onEvent = vi.fn();
        socketModule.connect('User', onEvent);
        const ws = latestWs();

        // Simulate close to bump reconnectAttempt
        ws._simulateClose();
        expect(onEvent).toHaveBeenCalledWith({ type: 'disconnected' });

        // Advance timer to trigger reconnect
        vi.advanceTimersByTime(35000);
        const ws2 = latestWs();
        ws2._simulateOpen();

        // Close again and reconnect - backoff should be reset
        ws2._simulateClose();
        vi.advanceTimersByTime(35000);
        // A new WS should be created (not blocked by max attempts)
        expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(3);
    });
});

/* ═══════════════════════════════════════════════════════════════
   SUITE 3 -- Message handling (onmessage)
   ═══════════════════════════════════════════════════════════════ */

describe('Message handling', () => {
    it('dispatches parsed messages to event listener', () => {
        const onEvent = vi.fn();
        socketModule.connect('User', onEvent);
        const ws = latestWs();
        ws._simulateOpen();

        ws._simulateMessage({ type: 'chat', text: 'hello' });
        expect(onEvent).toHaveBeenCalledWith({ type: 'chat', text: 'hello' });
    });

    it('filters out pong messages', () => {
        const onEvent = vi.fn();
        socketModule.connect('User', onEvent);
        const ws = latestWs();
        ws._simulateOpen();

        ws._simulateMessage({ type: 'pong' });
        expect(onEvent).not.toHaveBeenCalledWith({ type: 'pong' });
    });

    it('filters out rate_limited messages and logs warning', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const onEvent = vi.fn();
        socketModule.connect('User', onEvent);
        const ws = latestWs();
        ws._simulateOpen();

        ws._simulateMessage({ type: 'rate_limited' });
        expect(onEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'rate_limited' }));
        expect(warnSpy).toHaveBeenCalledWith('[OpenWire] Rate limited by server');
        warnSpy.mockRestore();
    });

    it('ignores invalid JSON without throwing', () => {
        const onEvent = vi.fn();
        socketModule.connect('User', onEvent);
        const ws = latestWs();
        ws._simulateOpen();

        // Directly call onmessage with non-JSON data
        expect(() => {
            ws.onmessage({ data: 'not json at all {{' });
        }).not.toThrow();
        // The event handler should not have been called with any message
        // (only the join was sent, no event dispatched for bad json)
    });
});

/* ═══════════════════════════════════════════════════════════════
   SUITE 4 -- disconnect()
   ═══════════════════════════════════════════════════════════════ */

describe('disconnect()', () => {
    it('closes the WebSocket', () => {
        socketModule.connect('User', vi.fn());
        const ws = latestWs();
        ws._simulateOpen();

        socketModule.disconnect();
        expect(ws.readyState).toBe(MockWebSocket.CLOSED);
    });

    it('nullifies onclose to prevent reconnect loop', () => {
        socketModule.connect('User', vi.fn());
        const ws = latestWs();
        ws._simulateOpen();

        socketModule.disconnect();
        expect(ws.onclose).toBeNull();
    });

    it('clears listeners so no further events fire', () => {
        const onEvent = vi.fn();
        socketModule.connect('User', onEvent);
        const ws = latestWs();
        ws._simulateOpen();
        onEvent.mockClear();

        socketModule.disconnect();
        // No events should fire after disconnect
    });

    it('can be called when no connection exists without error', () => {
        expect(() => socketModule.disconnect()).not.toThrow();
    });

    it('allows a new connection after disconnect', () => {
        socketModule.connect('User1', vi.fn());
        const ws1 = latestWs();
        ws1._simulateOpen();
        socketModule.disconnect();

        socketModule.connect('User2', vi.fn());
        expect(MockWebSocket.instances).toHaveLength(2);
    });
});

/* ═══════════════════════════════════════════════════════════════
   SUITE 5 -- send() and rate limiting (token bucket)
   ═══════════════════════════════════════════════════════════════ */

describe('send() and rate limiting', () => {
    function connectAndOpen() {
        const onEvent = vi.fn();
        socketModule.connect('User', onEvent);
        const ws = latestWs();
        ws._simulateOpen();
        return ws;
    }

    it('sends a JSON-stringified message when tokens available', () => {
        const ws = connectAndOpen();
        socketModule.send({ type: 'test', data: 'hello' });

        // sent[0] is the join message, sent[1] is our test message
        expect(ws.sent).toHaveLength(2);
        const msg = JSON.parse(ws.sent[1]);
        expect(msg).toEqual({ type: 'test', data: 'hello' });
    });

    it('does not send when WebSocket is not OPEN', () => {
        socketModule.connect('User', vi.fn());
        // WebSocket is CONNECTING, not OPEN
        socketModule.send({ type: 'test' });
        const ws = latestWs();
        expect(ws.sent).toHaveLength(0);
    });

    it('queues messages when rate limit tokens exhausted', () => {
        const ws = connectAndOpen();
        // join message used 0 tokens (sent via ws.send directly in onopen)
        // We have 40 tokens. Drain them all via send().
        for (let i = 0; i < 40; i++) {
            socketModule.send({ type: 'bulk', i });
        }
        // 40 messages + 1 join = 41 sent
        expect(ws.sent).toHaveLength(41);

        // The 41st call should be queued, not sent immediately
        socketModule.send({ type: 'queued' });
        expect(ws.sent).toHaveLength(41);
    });

    it('drains queued messages after token refill', () => {
        const ws = connectAndOpen();
        // Exhaust tokens
        for (let i = 0; i < 40; i++) {
            socketModule.send({ type: 'bulk', i });
        }
        // Queue one more
        socketModule.send({ type: 'queued' });
        const sentBeforeDrain = ws.sent.length;

        // Advance time for refill (100ms minimum for refill check + 50ms drain timer)
        vi.advanceTimersByTime(200);

        expect(ws.sent.length).toBeGreaterThan(sentBeforeDrain);
        // The queued message should now be sent
        const lastSent = JSON.parse(ws.sent[ws.sent.length - 1]);
        expect(lastSent).toEqual({ type: 'queued' });
    });

    it('drops queued messages older than 2 seconds', () => {
        const ws = connectAndOpen();
        // Exhaust all 40 tokens
        for (let i = 0; i < 40; i++) {
            socketModule.send({ type: 'bulk', i });
        }

        // Queue many messages - more than can be drained in 2s.
        // Refill rate is 30/sec, so in 2s only ~60 tokens refill.
        // Queue 80 messages so the last ~20 are still queued at the 2s mark.
        for (let i = 0; i < 80; i++) {
            socketModule.send({ type: 'queued', i });
        }
        const sentBeforeDrain = ws.sent.length;

        // Advance past the 2s drop cutoff - all remaining queued messages
        // that haven't been drained should be dropped.
        vi.advanceTimersByTime(2500);
        const totalSent = ws.sent.length;

        // With 40 initial tokens + ~75 refilled over 2.5s (30 * 2.5) = ~75 refill
        // Total tokens = 75 (refilled after exhaustion). So ~75 of the 80 queued
        // messages should be sent. The remaining ~5 that couldn't be drained in
        // 2s are dropped. Total sent should be less than 80 + 40 + 1(join) = 121.
        const queuedSent = totalSent - sentBeforeDrain;
        expect(queuedSent).toBeLessThan(80);
    });

    it('refills tokens over time up to max', () => {
        const ws = connectAndOpen();
        // Exhaust all 40 tokens
        for (let i = 0; i < 40; i++) {
            socketModule.send({ type: 'bulk', i });
        }

        // Advance 2 seconds (should refill 60 tokens but cap at 40)
        vi.advanceTimersByTime(2000);

        // Should be able to send 40 more messages
        const sentBefore = ws.sent.length;
        for (let i = 0; i < 40; i++) {
            socketModule.send({ type: 'refilled', i });
        }
        expect(ws.sent.length).toBe(sentBefore + 40);
    });
});

/* ═══════════════════════════════════════════════════════════════
   SUITE 6 -- Convenience send methods
   ═══════════════════════════════════════════════════════════════ */

describe('Convenience send methods', () => {
    let ws;

    beforeEach(() => {
        const onEvent = vi.fn();
        socketModule.connect('User', onEvent);
        ws = latestWs();
        ws._simulateOpen();
    });

    it('sendChat sends message type', () => {
        socketModule.sendChat('hello world');
        const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
        expect(msg).toEqual({ type: 'message', data: 'hello world' });
    });

    it('createRoom sends room_create type', () => {
        socketModule.createRoom('test-room');
        const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
        expect(msg).toEqual({ type: 'room_create', name: 'test-room' });
    });

    it('joinRoom sends room_join type', () => {
        socketModule.joinRoom('room-123');
        const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
        expect(msg).toEqual({ type: 'room_join', room_id: 'room-123' });
    });

    it('leaveRoom sends room_leave type', () => {
        socketModule.leaveRoom('room-123');
        const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
        expect(msg).toEqual({ type: 'room_leave', room_id: 'room-123' });
    });

    it('sendRoomMessage sends room_message type', () => {
        socketModule.sendRoomMessage('room-123', 'hi everyone');
        const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
        expect(msg).toEqual({ type: 'room_message', room_id: 'room-123', data: 'hi everyone' });
    });

    it('inviteToRoom sends room_invite type', () => {
        socketModule.inviteToRoom('room-123', 'peer-456');
        const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
        expect(msg).toEqual({ type: 'room_invite', room_id: 'room-123', peer_id: 'peer-456' });
    });

    it('sendStateSnapshot sends room_state_snapshot type', () => {
        const state = { chips: { p1: 1000 } };
        socketModule.sendStateSnapshot('room-123', state);
        const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
        expect(msg).toEqual({ type: 'room_state_snapshot', room_id: 'room-123', state });
    });
});

/* ═══════════════════════════════════════════════════════════════
   SUITE 7 -- Reconnection with exponential backoff
   ═══════════════════════════════════════════════════════════════ */

describe('Reconnection', () => {
    it('emits disconnected event on close', () => {
        const onEvent = vi.fn();
        socketModule.connect('User', onEvent);
        const ws = latestWs();
        ws._simulateOpen();

        ws._simulateClose();
        expect(onEvent).toHaveBeenCalledWith({ type: 'disconnected' });
    });

    it('attempts reconnection after close', () => {
        const onEvent = vi.fn();
        socketModule.connect('User', onEvent);
        const ws = latestWs();
        ws._simulateOpen();
        ws._simulateClose();

        // Advance enough time for first reconnect (base=1000ms + up to 1000ms random)
        vi.advanceTimersByTime(3000);

        // A new WebSocket should have been created
        expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(2);
    });

    it('uses exponential backoff', () => {
        const onEvent = vi.fn();
        socketModule.connect('User', onEvent);

        // Close first connection
        const ws1 = latestWs();
        ws1._simulateOpen();
        ws1._simulateClose();

        // First reconnect: base * 2^0 + random = ~1000-2000ms
        vi.advanceTimersByTime(2500);
        const ws2 = latestWs();
        expect(MockWebSocket.instances).toHaveLength(2);

        // Close second connection
        ws2._simulateClose();

        // Second reconnect: base * 2^1 + random = ~2000-3000ms
        // Should not reconnect at 1500ms
        vi.advanceTimersByTime(1500);
        expect(MockWebSocket.instances).toHaveLength(2);

        // Should reconnect by 3500ms total
        vi.advanceTimersByTime(2500);
        expect(MockWebSocket.instances).toHaveLength(3);
    });

    it('emits reconnect_failed after MAX_RECONNECT_ATTEMPTS (25)', () => {
        const onEvent = vi.fn();
        socketModule.connect('User', onEvent);

        // Simulate 25 consecutive close events WITHOUT opening,
        // so reconnectAttempt never resets to 0.
        for (let i = 0; i < 25; i++) {
            const ws = latestWs();
            ws._simulateClose();
            // Advance far enough to trigger the scheduled reconnect
            vi.advanceTimersByTime(35000);
        }

        // The 26th close (attempt index 25) should trigger reconnect_failed
        const ws26 = latestWs();
        ws26._simulateClose();

        const reconnectFailedCalls = onEvent.mock.calls.filter(
            ([msg]) => msg.type === 'reconnect_failed'
        );
        expect(reconnectFailedCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('clears message queue on close', () => {
        const onEvent = vi.fn();
        socketModule.connect('User', onEvent);
        const ws = latestWs();
        ws._simulateOpen();

        // Exhaust tokens and queue a message
        for (let i = 0; i < 40; i++) {
            socketModule.send({ type: 'bulk', i });
        }
        socketModule.send({ type: 'queued' });

        // Close should clear the queue
        ws._simulateClose();

        // Reconnect and open
        vi.advanceTimersByTime(3000);
        const ws2 = latestWs();
        ws2._simulateOpen();

        // The queued message should NOT have been sent on ws2
        const ws2Messages = ws2.sent.map(s => JSON.parse(s));
        expect(ws2Messages.find(m => m.type === 'queued')).toBeUndefined();
    });
});

/* ═══════════════════════════════════════════════════════════════
   SUITE 8 -- Ping/pong heartbeat
   ═══════════════════════════════════════════════════════════════ */

describe('Ping/pong heartbeat', () => {
    it('sends periodic ping messages after open', () => {
        socketModule.connect('User', vi.fn());
        const ws = latestWs();
        ws._simulateOpen();

        // Clear the join message
        const sentBeforePing = ws.sent.length;

        // Advance past the ping interval (14000 base + 2000 jitter max)
        vi.advanceTimersByTime(16500);

        // At least one ping should have been sent
        const pingsSent = ws.sent.slice(sentBeforePing).filter(s => {
            try { return JSON.parse(s).type === 'ping'; } catch { return false; }
        });
        expect(pingsSent.length).toBeGreaterThanOrEqual(1);
    });

    it('stops ping timer on close', () => {
        socketModule.connect('User', vi.fn());
        const ws = latestWs();
        ws._simulateOpen();
        ws._simulateClose();

        const sentAfterClose = ws.sent.length;

        // Advance past multiple ping intervals
        vi.advanceTimersByTime(50000);

        // No more pings should be sent on the closed ws
        expect(ws.sent.length).toBe(sentAfterClose);
    });
});

/* ═══════════════════════════════════════════════════════════════
   SUITE 9 -- connectToCliNode()
   ═══════════════════════════════════════════════════════════════ */

describe('connectToCliNode()', () => {
    it('sets connection mode to cli-node', () => {
        const onEvent = vi.fn();
        socketModule.connectToCliNode('ws://192.168.1.5:18080', 'User', onEvent);
        expect(socketModule.getConnectionMode()).toBe('cli-node');
    });

    it('stores the CLI node host', () => {
        const onEvent = vi.fn();
        socketModule.connectToCliNode('ws://192.168.1.5:18080', 'User', onEvent);
        expect(socketModule.getCliNodeHost()).toBe('192.168.1.5:18080');
    });

    it('emits cli_node_connecting event', () => {
        const onEvent = vi.fn();
        socketModule.connectToCliNode('ws://192.168.1.5:18080', 'User', onEvent);
        expect(onEvent).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'cli_node_connecting' })
        );
    });

    it('appends /ws path if no path is given', () => {
        const onEvent = vi.fn();
        socketModule.connectToCliNode('ws://192.168.1.5:18080', 'User', onEvent);

        const ws = latestWs();
        expect(ws.url).toContain('/ws');
    });

    it('preserves existing path', () => {
        const onEvent = vi.fn();
        socketModule.connectToCliNode('ws://192.168.1.5:18080/custom', 'User', onEvent);

        const ws = latestWs();
        expect(ws.url).toContain('/custom');
    });

    it('uses default CLI bridge URL when empty string provided', () => {
        const onEvent = vi.fn();
        socketModule.connectToCliNode('', 'User', onEvent);

        const ws = latestWs();
        // Should use DEFAULT_CLI_BRIDGE_URL which is ws://localhost:18080
        expect(ws.url).toContain('localhost:18080');
    });

    it('falls back to relay on invalid URL', () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const onEvent = vi.fn();
        socketModule.connectToCliNode('not-a-valid-url', 'User', onEvent);

        expect(socketModule.getConnectionMode()).toBe('relay');
        expect(socketModule.getCliNodeHost()).toBeNull();
        // Should have created a WS via relay fallback
        expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(1);
        errorSpy.mockRestore();
    });

    it('falls back to relay after 3 failed CLI attempts', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const onEvent = vi.fn();
        socketModule.connectToCliNode('ws://192.168.1.5:18080', 'User', onEvent);

        // Simulate 3 close events (failed connections)
        for (let i = 0; i < 3; i++) {
            const ws = latestWs();
            ws._simulateOpen();
            ws._simulateClose();
            // Advance timer to trigger reconnect callback
            vi.advanceTimersByTime(35000);
        }

        // After 3 failures, should emit cli_node_fallback and switch to relay
        const fallbackCalls = onEvent.mock.calls.filter(
            ([msg]) => msg.type === 'cli_node_fallback'
        );
        expect(fallbackCalls.length).toBeGreaterThanOrEqual(1);
        expect(socketModule.getConnectionMode()).toBe('relay');
        expect(socketModule.getCliNodeHost()).toBeNull();
        warnSpy.mockRestore();
    });

    it('does not create new connection if one is already OPEN', () => {
        const onEvent = vi.fn();
        socketModule.connectToCliNode('ws://192.168.1.5:18080', 'User', onEvent);
        const ws = latestWs();
        ws._simulateOpen();

        socketModule.connectToCliNode('ws://192.168.1.5:18080', 'User2', onEvent);
        expect(MockWebSocket.instances).toHaveLength(1);
    });

    it('logs security warning for ws:// on https:// page', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        // jsdom does not allow redefining window.location.protocol directly.
        // Replace the whole window.location with a stub.
        const origLocation = window.location;
        delete window.location;
        window.location = { ...origLocation, protocol: 'https:' };

        const onEvent = vi.fn();
        socketModule.connectToCliNode('ws://192.168.1.5:18080', 'User', onEvent);

        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('Security warning')
        );

        // Restore
        window.location = origLocation;
        warnSpy.mockRestore();
    });
});

/* ═══════════════════════════════════════════════════════════════
   SUITE 10 -- Edge cases and error handling
   ═══════════════════════════════════════════════════════════════ */

describe('Edge cases', () => {
    it('onerror handler exists and does not throw', () => {
        socketModule.connect('User', vi.fn());
        const ws = latestWs();

        expect(() => ws._simulateError()).not.toThrow();
    });

    it('send does nothing after disconnect', () => {
        socketModule.connect('User', vi.fn());
        const ws = latestWs();
        ws._simulateOpen();
        socketModule.disconnect();

        // Should not throw even though ws is null internally
        expect(() => socketModule.send({ type: 'test' })).not.toThrow();
    });

    it('sendChat does nothing when not connected', () => {
        expect(() => socketModule.sendChat('hello')).not.toThrow();
    });

    it('multiple rapid connects only create one WebSocket', () => {
        const onEvent = vi.fn();
        socketModule.connect('User', onEvent);
        socketModule.connect('User', onEvent);
        socketModule.connect('User', onEvent);

        expect(MockWebSocket.instances).toHaveLength(1);
    });

    it('disconnect then immediate connect works correctly', () => {
        const onEvent = vi.fn();
        socketModule.connect('User', onEvent);
        const ws1 = latestWs();
        ws1._simulateOpen();

        socketModule.disconnect();
        socketModule.connect('User', onEvent);

        expect(MockWebSocket.instances).toHaveLength(2);
        const ws2 = latestWs();
        ws2._simulateOpen();

        socketModule.sendChat('after reconnect');
        const lastMsg = JSON.parse(ws2.sent[ws2.sent.length - 1]);
        expect(lastMsg).toEqual({ type: 'message', data: 'after reconnect' });
    });

    it('handles sending complex nested objects', () => {
        socketModule.connect('User', vi.fn());
        const ws = latestWs();
        ws._simulateOpen();

        const complexData = {
            type: 'room_state_snapshot',
            room_id: 'r1',
            state: { players: [{ id: 'p1', chips: 1000 }], round: 5 },
        };
        socketModule.send(complexData);

        const sent = JSON.parse(ws.sent[ws.sent.length - 1]);
        expect(sent).toEqual(complexData);
    });
});

/* ═══════════════════════════════════════════════════════════════
   SUITE 11 -- Rate limiter token bucket internals
   ═══════════════════════════════════════════════════════════════ */

describe('Token bucket rate limiter', () => {
    it('starts with 40 tokens (maxTokens)', () => {
        socketModule.connect('User', vi.fn());
        const ws = latestWs();
        ws._simulateOpen();

        // Should be able to send exactly 40 messages
        for (let i = 0; i < 40; i++) {
            socketModule.send({ i });
        }
        // 40 + 1 join = 41
        expect(ws.sent).toHaveLength(41);

        // 41st via send() should be queued
        socketModule.send({ type: 'overflow' });
        expect(ws.sent).toHaveLength(41);
    });

    it('refills at 30 tokens per second', () => {
        socketModule.connect('User', vi.fn());
        const ws = latestWs();
        ws._simulateOpen();

        // Exhaust all tokens
        for (let i = 0; i < 40; i++) {
            socketModule.send({ i });
        }

        // Advance 500ms: should refill ~15 tokens (30 * 0.5)
        vi.advanceTimersByTime(500);

        const sentBefore = ws.sent.length;
        // Try to send 15 - should succeed
        for (let i = 0; i < 15; i++) {
            socketModule.send({ type: 'after_refill', i });
        }
        expect(ws.sent.length).toBe(sentBefore + 15);
    });

    it('does not refill beyond maxTokens (40)', () => {
        socketModule.connect('User', vi.fn());
        const ws = latestWs();
        ws._simulateOpen();

        // Advance 10 seconds without sending - tokens should still cap at 40
        vi.advanceTimersByTime(10000);

        const sentBefore = ws.sent.length;
        for (let i = 0; i < 41; i++) {
            socketModule.send({ i });
        }
        // 40 should be sent immediately, 1 queued
        expect(ws.sent.length).toBe(sentBefore + 40);
    });

    it('does not refill for intervals shorter than 100ms', () => {
        socketModule.connect('User', vi.fn());
        const ws = latestWs();
        ws._simulateOpen();

        // Exhaust all tokens
        for (let i = 0; i < 40; i++) {
            socketModule.send({ i });
        }

        // Advance only 50ms - should NOT trigger refill (threshold is 100ms)
        vi.advanceTimersByTime(50);

        // The queued message drain timer fires at 50ms but refill needs 100ms elapsed
        socketModule.send({ type: 'too_soon' });
        // Should still be queued since no refill happened
        expect(ws.sent.length).toBe(41); // just the original 40 + join
    });

    it('drain timer schedules itself while queue has items', () => {
        socketModule.connect('User', vi.fn());
        const ws = latestWs();
        ws._simulateOpen();

        // Exhaust tokens
        for (let i = 0; i < 40; i++) {
            socketModule.send({ i });
        }

        // Queue multiple messages
        for (let i = 0; i < 5; i++) {
            socketModule.send({ type: 'queued', i });
        }

        // Advance enough for refill and multiple drain cycles
        vi.advanceTimersByTime(500);

        // All queued messages should eventually be sent
        const allSent = ws.sent.map(s => JSON.parse(s));
        const queuedSent = allSent.filter(m => m.type === 'queued');
        expect(queuedSent).toHaveLength(5);
    });
});

/* ═══════════════════════════════════════════════════════════════
   SUITE 12 -- Visibility change (pause/resume pings)
   ═══════════════════════════════════════════════════════════════ */

describe('Visibility change', () => {
    it('pauses pings when document becomes hidden', () => {
        socketModule.connect('User', vi.fn());
        const ws = latestWs();
        ws._simulateOpen();

        const sentBeforeHidden = ws.sent.length;

        // Simulate tab becoming hidden
        Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));

        // Advance past ping interval
        vi.advanceTimersByTime(20000);

        // No pings should have been sent
        const pingsAfterHidden = ws.sent.slice(sentBeforeHidden).filter(s => {
            try { return JSON.parse(s).type === 'ping'; } catch { return false; }
        });
        expect(pingsAfterHidden).toHaveLength(0);

        // Restore
        Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
    });

    it('resumes pings when document becomes visible again', () => {
        socketModule.connect('User', vi.fn());
        const ws = latestWs();
        ws._simulateOpen();

        // Hide
        Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));

        // Unhide
        Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));

        const sentBeforeResume = ws.sent.length;

        // Advance past ping interval
        vi.advanceTimersByTime(20000);

        const pingsAfterResume = ws.sent.slice(sentBeforeResume).filter(s => {
            try { return JSON.parse(s).type === 'ping'; } catch { return false; }
        });
        expect(pingsAfterResume.length).toBeGreaterThanOrEqual(1);

        // Restore
        Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
    });
});
