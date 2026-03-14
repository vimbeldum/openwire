/**
 * admin-portal.test.js
 *
 * Targeted tests for admin-portal domain scenarios NOT already covered by:
 *   - security-compliance.test.js  (admin secret isolation, AgentSwarm guardrails,
 *                                   DPDP compliance, XML injection)
 *   - core-features.test.js        (casinoState housePnl, getTotalHousePnl, updateHousePnl,
 *                                   LWW merge, serialization, sendRoomMessage payload shape)
 *   - chat-identity.test.js        (adminAdjust floor-at-0, wallet security, ledger DPDP)
 *
 * New ground covered here:
 *   1. Admin socket command shapes: admin_kick, admin_ban_ip, admin_unban_ip,
 *      admin_adjust_balance — exact { type, peer_id / ip / delta / reason } payloads
 *   2. admin_adjust_balance reason field carries caller-supplied text (no PII injection)
 *   3. Join message does NOT include an `is_admin` field (admin status is server-side only)
 *   4. House P&L: multi-game accumulation + getTotalHousePnl in a single round-trip scenario
 *   5. AgentSwarm: fresh instance has _context reset to [TURN2_ANCHOR] (length 1)
 *   6. AgentSwarm: loadConfig() increments _generation and clears stagger timers
 *   7. AgentSwarm: context buffer truncates at CONTEXT_BUFFER_SIZE (1000)
 *   8. AgentSwarm: queueLength getter mirrors _messageQueue.length
 *   9. DPDP: admin_adjust_balance message does NOT embed real nick in the reason beyond
 *      what the caller explicitly provides (no auto-PII injection by the socket layer)
 *  10. admin_secret is truthy-gated: null / undefined / false all suppress the field
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* ═════════════════════════════════════════════════════════════
   Mock WebSocket — mirrors the pattern from existing test suites
   ═════════════════════════════════════════════════════════════ */

class MockWebSocket {
    static CONNECTING = 0;
    static OPEN       = 1;
    static CLOSING    = 2;
    static CLOSED     = 3;

    constructor(url) {
        this.url = url;
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
    _simulateClose() {
        this.readyState = MockWebSocket.CLOSED;
        if (this.onclose) this.onclose();
    }
}

MockWebSocket.instances = [];
vi.stubGlobal('WebSocket', MockWebSocket);

/* ═════════════════════════════════════════════════════════════
   Map-backed localStorage stub
   ═════════════════════════════════════════════════════════════ */

const _localMap = new Map();
vi.stubGlobal('localStorage', {
    getItem:    vi.fn(k     => _localMap.get(k) ?? null),
    setItem:    vi.fn((k,v) => _localMap.set(k, String(v))),
    removeItem: vi.fn(k     => _localMap.delete(k)),
    clear:      vi.fn(()    => _localMap.clear()),
    get length()  { return _localMap.size; },
    key(i)        { return Array.from(_localMap.keys())[i] ?? null; },
    _store:     _localMap,
});

/* ═════════════════════════════════════════════════════════════
   Mocks for AgentSwarm transitive dependencies
   ═════════════════════════════════════════════════════════════ */

vi.mock('../lib/agents/openrouter.js', () => ({
    fetchFreeModels:  vi.fn().mockResolvedValue([]),
    generateMessage:  vi.fn().mockResolvedValue('mock'),
}));
vi.mock('../lib/agents/gemini.js', () => ({
    fetchGeminiModels:   vi.fn().mockResolvedValue([]),
    generateGeminiMessage: vi.fn().mockResolvedValue('mock'),
}));
vi.mock('../lib/agents/qwen.js', () => ({
    fetchQwenModels:   vi.fn().mockResolvedValue([]),
    generateQwenMessage: vi.fn().mockResolvedValue('mock'),
}));
vi.mock('../lib/agents/haimaker.js', () => ({
    fetchHaimakerModels:   vi.fn().mockResolvedValue([]),
    generateHaimakerMessage: vi.fn().mockResolvedValue('mock'),
}));
vi.mock('../lib/agents/agentStore.js', () => ({
    loadStore:          vi.fn().mockReturnValue({
        characters:   [],
        groups:       [],
        modelFilters: { whitelist: [], blacklist: [] },
        guardrails:   true,
    }),
    getCharactersDict:  vi.fn().mockReturnValue({}),
    getGroupsDict:      vi.fn().mockReturnValue({}),
    getGroupCharacters: vi.fn().mockReturnValue([]),
}));

/* ═════════════════════════════════════════════════════════════
   Helpers
   ═════════════════════════════════════════════════════════════ */

function latestWs() {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1];
}

/* ═════════════════════════════════════════════════════════════
   Section 1 — Admin socket command payload shapes
   These test the socket.send() calls made by ChatRoom admin handlers
   (handleAdminKick, handleAdminBanIp, handleAdminUnbanIp,
   handleAdminAdjustBalance) by verifying that socket.send() would
   produce the correct JSON payload. We test socket.send() directly
   since the handler logic is a thin one-liner.
   ═════════════════════════════════════════════════════════════ */

describe('1 — Admin socket command shapes', () => {
    let socketModule;

    beforeEach(async () => {
        vi.useFakeTimers({ shouldAdvanceTime: false });
        MockWebSocket.instances = [];
        vi.resetModules();
        socketModule = await import('../lib/socket.js');
        socketModule.connect('Admin', vi.fn(), { isAdmin: true, adminSecret: 'test-secret' });
        latestWs()._simulateOpen();
    });

    afterEach(() => {
        socketModule.disconnect();
        vi.useRealTimers();
    });

    it('admin_kick sends { type: "admin_kick", peer_id }', () => {
        const ws = latestWs();
        socketModule.send({ type: 'admin_kick', peer_id: 'peer-abc-123' });
        const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
        expect(msg.type).toBe('admin_kick');
        expect(msg.peer_id).toBe('peer-abc-123');
    });

    it('admin_kick message does NOT include admin_secret', () => {
        const ws = latestWs();
        socketModule.send({ type: 'admin_kick', peer_id: 'peer-abc-123' });
        const raw = ws.sent[ws.sent.length - 1];
        expect(raw).not.toContain('test-secret');
        expect(JSON.parse(raw)).not.toHaveProperty('admin_secret');
    });

    it('admin_ban_ip sends { type: "admin_ban_ip", peer_id }', () => {
        const ws = latestWs();
        socketModule.send({ type: 'admin_ban_ip', peer_id: 'peer-xyz-456' });
        const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
        expect(msg.type).toBe('admin_ban_ip');
        expect(msg.peer_id).toBe('peer-xyz-456');
    });

    it('admin_ban_ip message does NOT include admin_secret', () => {
        const ws = latestWs();
        socketModule.send({ type: 'admin_ban_ip', peer_id: 'peer-xyz-456' });
        expect(ws.sent[ws.sent.length - 1]).not.toContain('test-secret');
    });

    it('admin_unban_ip sends { type: "admin_unban_ip", ip }', () => {
        const ws = latestWs();
        socketModule.send({ type: 'admin_unban_ip', ip: '192.168.1.100' });
        const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
        expect(msg.type).toBe('admin_unban_ip');
        expect(msg.ip).toBe('192.168.1.100');
    });

    it('admin_adjust_balance sends { type, peer_id, delta, reason }', () => {
        const ws = latestWs();
        socketModule.send({
            type:    'admin_adjust_balance',
            peer_id: 'peer-player-789',
            delta:   500,
            reason:  'Admin grant from Shwetanshu',
        });
        const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
        expect(msg.type).toBe('admin_adjust_balance');
        expect(msg.peer_id).toBe('peer-player-789');
        expect(msg.delta).toBe(500);
        expect(msg.reason).toBe('Admin grant from Shwetanshu');
    });

    it('admin_adjust_balance with negative delta sends the exact delta value', () => {
        const ws = latestWs();
        socketModule.send({
            type:    'admin_adjust_balance',
            peer_id: 'peer-player-789',
            delta:   -200,
            reason:  'Penalty',
        });
        const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
        expect(msg.delta).toBe(-200);
    });

    it('admin_get_bans sends { type: "admin_get_bans" }', () => {
        const ws = latestWs();
        socketModule.send({ type: 'admin_get_bans' });
        const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
        expect(msg.type).toBe('admin_get_bans');
    });
});

/* ═════════════════════════════════════════════════════════════
   Section 2 — Join message: is_admin NOT sent; admin_secret
   only when truthy (null / undefined / false / 0 suppressed)
   ═════════════════════════════════════════════════════════════ */

describe('2 — Join message admin field rules', () => {
    let socketModule;

    beforeEach(async () => {
        vi.useFakeTimers({ shouldAdvanceTime: false });
        MockWebSocket.instances = [];
        vi.resetModules();
        socketModule = await import('../lib/socket.js');
    });

    afterEach(() => {
        socketModule.disconnect();
        vi.useRealTimers();
    });

    it('join message does NOT contain is_admin field (admin status is server-only)', () => {
        socketModule.connect('Admin', vi.fn(), { isAdmin: true, adminSecret: 'sekr3t' });
        latestWs()._simulateOpen();
        const join = JSON.parse(latestWs().sent[0]);
        expect(join).not.toHaveProperty('is_admin');
    });

    it('join message omits admin_secret when adminSecret is null', () => {
        socketModule.connect('User', vi.fn(), { isAdmin: false, adminSecret: null });
        latestWs()._simulateOpen();
        const join = JSON.parse(latestWs().sent[0]);
        expect(join).not.toHaveProperty('admin_secret');
    });

    it('join message omits admin_secret when adminSecret is undefined', () => {
        socketModule.connect('User', vi.fn(), { isAdmin: false, adminSecret: undefined });
        latestWs()._simulateOpen();
        const join = JSON.parse(latestWs().sent[0]);
        expect(join).not.toHaveProperty('admin_secret');
    });

    it('join message omits admin_secret when adminSecret is 0 (falsy)', () => {
        socketModule.connect('User', vi.fn(), { isAdmin: false, adminSecret: 0 });
        latestWs()._simulateOpen();
        const join = JSON.parse(latestWs().sent[0]);
        expect(join).not.toHaveProperty('admin_secret');
    });

    it('join message includes admin_secret when truthy non-empty string', () => {
        socketModule.connect('Admin', vi.fn(), { isAdmin: true, adminSecret: 'correct-horse' });
        latestWs()._simulateOpen();
        const join = JSON.parse(latestWs().sent[0]);
        expect(join.admin_secret).toBe('correct-horse');
    });
});

/* ═════════════════════════════════════════════════════════════
   Section 3 — House P&L: multi-game accumulation scenario
   (updateHousePnl per-game + combined getTotalHousePnl)
   Note: individual updateHousePnl and getTotalHousePnl cases are
   already in core-features.test.js B-3 and B-4. We test here the
   admin-specific combined scenario: multiple games played across
   multiple rounds, then a single admin getTotalHousePnl call.
   ═════════════════════════════════════════════════════════════ */

describe('3 — House P&L combined admin read-out', () => {
    let casinoModule;

    beforeEach(async () => {
        vi.useFakeTimers({ shouldAdvanceTime: false });
        _localMap.clear();
        vi.resetModules();
        casinoModule = await import('../lib/casinoState.js');
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('getTotalHousePnl reflects accumulation across roulette + blackjack + andarbahar + slots', () => {
        let state = casinoModule.createCasinoState();

        // Roulette round: players lose 300 total → house +300
        state = casinoModule.updateHousePnl(state, 'roulette',   { p1: -200, p2: -100 });
        // Blackjack round: player wins 150 → house -150
        state = casinoModule.updateHousePnl(state, 'blackjack',  { p1: 150 });
        // Andar Bahar round: player loses 75 → house +75
        state = casinoModule.updateHousePnl(state, 'andarbahar', { p1: -75 });
        // Slots round: player wins 50 → house -50
        state = casinoModule.updateHousePnl(state, 'slots',      { p1: 50 });

        // Individual game checks
        expect(state.housePnl.roulette).toBe(300);
        expect(state.housePnl.blackjack).toBe(-150);
        expect(state.housePnl.andarbahar).toBe(75);
        expect(state.housePnl.slots).toBe(-50);

        // Combined admin total: 300 - 150 + 75 - 50 = 175
        expect(casinoModule.getTotalHousePnl(state)).toBe(175);
    });

    it('getTotalHousePnl is 0 after createCasinoState (no rounds played)', () => {
        const state = casinoModule.createCasinoState();
        expect(casinoModule.getTotalHousePnl(state)).toBe(0);
    });

    it('updateHousePnl with an empty payoutsMap (all-push round) does not change PnL', () => {
        let state = casinoModule.createCasinoState();
        state = casinoModule.updateHousePnl(state, 'roulette', {});
        expect(state.housePnl.roulette).toBe(0);
        expect(casinoModule.getTotalHousePnl(state)).toBe(0);
    });

    it('admin total PnL correctly sums a house loss scenario (negative total)', () => {
        let state = casinoModule.createCasinoState();
        // Players win consistently
        state = casinoModule.updateHousePnl(state, 'roulette',   { p1: 1000 });
        state = casinoModule.updateHousePnl(state, 'blackjack',  { p1: 500  });
        // houseGain = -(1000) + -(500) = -1500
        expect(casinoModule.getTotalHousePnl(state)).toBe(-1500);
    });

    it('updateHousePnl returns a NEW state object (immutable — original unchanged)', () => {
        const original = casinoModule.createCasinoState();
        const originalRoulette = original.housePnl.roulette;
        casinoModule.updateHousePnl(original, 'roulette', { p1: -100 });
        // The original state object must not be mutated
        expect(original.housePnl.roulette).toBe(originalRoulette);
    });
});

/* ═════════════════════════════════════════════════════════════
   Section 4 — AgentSwarm context flush and queue stats
   ═════════════════════════════════════════════════════════════ */

import { AgentSwarm } from '../lib/agents/swarm.js';

describe('4 — AgentSwarm context flush and queue stats', () => {

    it('fresh AgentSwarm instance always starts with _context of length 1 (TURN2_ANCHOR)', () => {
        const swarm = new AgentSwarm({ onMessage: vi.fn() });
        expect(swarm._context).toHaveLength(1);
    });

    it('creating a second swarm after stop() gives a fresh _context (length 1)', () => {
        const swarm1 = new AgentSwarm({ onMessage: vi.fn() });
        swarm1.addContext('User', 'hello there');
        swarm1.addContext('User', 'are you ready?');
        expect(swarm1._context.length).toBeGreaterThan(1);

        swarm1.stop();

        // New swarm should be completely fresh
        const swarm2 = new AgentSwarm({ onMessage: vi.fn() });
        expect(swarm2._context).toHaveLength(1);
        expect(swarm2._context[0].role).toBe('assistant');
    });

    it('queueLength getter returns 0 initially', () => {
        const swarm = new AgentSwarm({ onMessage: vi.fn() });
        expect(swarm.queueLength).toBe(0);
    });

    it('queueLength getter mirrors _messageQueue.length when items are pushed manually', () => {
        const swarm = new AgentSwarm({ onMessage: vi.fn() });
        swarm._messageQueue = [{ characterId: 'char1' }, { characterId: 'char2' }, { characterId: 'char3' }];
        expect(swarm.queueLength).toBe(3);
    });

    it('stop() resets queueLength to 0 even with populated queue', () => {
        const swarm = new AgentSwarm({ onMessage: vi.fn() });
        swarm._messageQueue = [{ characterId: 'char1' }, { characterId: 'char2' }];
        swarm.stop();
        expect(swarm.queueLength).toBe(0);
    });

    it('loadConfig() increments _generation counter to kill stale async chains', () => {
        const swarm = new AgentSwarm({ onMessage: vi.fn() });
        const genBefore = swarm._generation;
        swarm.loadConfig();
        expect(swarm._generation).toBe(genBefore + 1);
    });

    it('loadConfig() clears all stagger timers (no dangling timers)', () => {
        vi.useFakeTimers();
        const swarm = new AgentSwarm({ onMessage: vi.fn() });
        // Simulate stagger timers from a previous start
        swarm._staggerTimers = [setTimeout(() => {}, 99999), setTimeout(() => {}, 99999)];
        swarm.loadConfig();
        expect(swarm._staggerTimers).toHaveLength(0);
        vi.useRealTimers();
    });

    it('_context grows by 1 per addContext() call', () => {
        const swarm = new AgentSwarm({ onMessage: vi.fn() });
        const before = swarm._context.length;
        swarm.addContext('Alice', 'message one');
        expect(swarm._context.length).toBe(before + 1);
        swarm.addContext('Bob', 'message two');
        expect(swarm._context.length).toBe(before + 2);
    });

    it('_context is truncated when it exceeds CONTEXT_BUFFER_SIZE (1000)', () => {
        const swarm = new AgentSwarm({ onMessage: vi.fn() });
        // _context starts at length 1 (TURN2_ANCHOR).
        // Fill to exactly 1000 total so the next addContext push → 1001 > 1000 → shift → 1000.
        for (let i = swarm._context.length; i < 1000; i++) {
            swarm._context.push({ role: 'user', content: `msg ${i}`, _isAgent: false });
        }
        expect(swarm._context.length).toBe(1000);
        swarm.addContext('User', 'overflow message');
        // push → 1001, then shift (1001 > 1000) → 1000
        expect(swarm._context.length).toBeLessThanOrEqual(1000);
    });

    it('stop() followed by loadConfig() on a new swarm does not throw', () => {
        const swarm = new AgentSwarm({ onMessage: vi.fn() });
        expect(() => {
            swarm.stop();
            swarm.loadConfig();
        }).not.toThrow();
    });
});

/* ═════════════════════════════════════════════════════════════
   Section 5 — DPDP: admin messages contain no auto-injected PII
   ═════════════════════════════════════════════════════════════ */

describe('5 — DPDP: admin messages carry no auto-injected PII', () => {
    let socketModule;

    beforeEach(async () => {
        vi.useFakeTimers({ shouldAdvanceTime: false });
        MockWebSocket.instances = [];
        vi.resetModules();
        socketModule = await import('../lib/socket.js');
        socketModule.connect('Admin', vi.fn(), { isAdmin: true, adminSecret: 'safe-secret' });
        latestWs()._simulateOpen();
    });

    afterEach(() => {
        socketModule.disconnect();
        vi.useRealTimers();
    });

    it('admin_adjust_balance reason field is stored verbatim (no extra PII added by socket)', () => {
        const ws = latestWs();
        const reason = 'Admin grant from Admin'; // as ChatRoom constructs it
        socketModule.send({ type: 'admin_adjust_balance', peer_id: 'p-1', delta: 100, reason });
        const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
        // The socket layer must not append IP, timestamp, or any other PII
        expect(msg.reason).toBe(reason);
        expect(Object.keys(msg)).toEqual(
            expect.arrayContaining(['type', 'peer_id', 'delta', 'reason'])
        );
        // No surprise keys that could embed PII
        expect(msg).not.toHaveProperty('ip');
        expect(msg).not.toHaveProperty('email');
        expect(msg).not.toHaveProperty('deviceId');
        expect(msg).not.toHaveProperty('fingerprint');
    });

    it('admin_kick message contains only type and peer_id (no PII fields)', () => {
        const ws = latestWs();
        socketModule.send({ type: 'admin_kick', peer_id: 'peer-target' });
        const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
        expect(Object.keys(msg)).toEqual(['type', 'peer_id']);
    });

    it('admin_ban_ip message contains only type and peer_id (no IP stored client-side)', () => {
        const ws = latestWs();
        socketModule.send({ type: 'admin_ban_ip', peer_id: 'peer-target' });
        const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
        // IP resolution is done server-side; client only sends peer_id
        expect(msg).not.toHaveProperty('ip');
        expect(msg.type).toBe('admin_ban_ip');
        expect(msg.peer_id).toBe('peer-target');
    });

    it('admin_unban_ip message contains only type and ip (no nick or deviceId)', () => {
        const ws = latestWs();
        socketModule.send({ type: 'admin_unban_ip', ip: '10.0.0.1' });
        const msg = JSON.parse(ws.sent[ws.sent.length - 1]);
        expect(msg).not.toHaveProperty('nick');
        expect(msg).not.toHaveProperty('deviceId');
        expect(msg).not.toHaveProperty('email');
        expect(msg.type).toBe('admin_unban_ip');
        expect(msg.ip).toBe('10.0.0.1');
    });
});

/* ═════════════════════════════════════════════════════════════
   React component tests — marked as todo (require jsdom + React)
   ═════════════════════════════════════════════════════════════ */

describe('6 — AdminPortal.jsx component tests (todo: require jsdom)', () => {
    it.todo('renders Players tab by default when opened');
    it.todo('renders Ban List tab with count badge when bannedIps.length > 0');
    it.todo('clicking Kick button calls onKick with the correct peer_id');
    it.todo('clicking IP-Ban button shows a window.confirm prompt');
    it.todo('balance adjust input is pre-populated with 100 chips');
    it.todo('Stats tab renders all four game-type PnL values from casinoState');
    it.todo('admin total PnL is computed via getTotalHousePnl and displayed in Stats');
    it.todo('Agents tab shows swarm running state from swarm.running prop');
    it.todo('swarm toggle button calls swarm.start() when swarm is stopped');
    it.todo('swarm toggle button calls swarm.stop() when swarm is running');
    it.todo('onClose callback is invoked when the close button is clicked');
    it.todo('pnlFilter dropdown filters per-game PnL rows in Stats tab');
});
