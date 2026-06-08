/**
 * Shared test helpers for Playwright E2E tests.
 * Handles WebSocket mocking and common navigation.
 */
import { expect } from '@playwright/test';

/**
 * Mock WebSocket connections so the app doesn't need a real relay.
 * Intercepts the WebSocket constructor and provides a fake that
 * immediately fires 'open' and handles send/close.
 */
export async function mockWebSocket(page) {
    await page.addInitScript(() => {
        const originalWebSocket = window.WebSocket;
        window.__wsMock = {
            instances: [],
            lastSent: [],
            /** Return the most recent (active) WebSocket instance.
             *  React StrictMode re-runs effects, creating multiple instances;
             *  the last one is always the active connection. */
            get active() { return this.instances[this.instances.length - 1]; },
        };

        window.WebSocket = class MockWebSocket {
            constructor(url) {
                this.url = url;
                this.readyState = 0; // CONNECTING
                this._listeners = {};
                window.__wsMock.instances.push(this);

                // Simulate connection open after a tick
                setTimeout(() => {
                    this.readyState = 1; // OPEN
                    this._emit('open', new Event('open'));
                }, 50);
            }

            addEventListener(type, fn) {
                if (!this._listeners[type]) this._listeners[type] = [];
                this._listeners[type].push(fn);
            }

            removeEventListener(type, fn) {
                if (!this._listeners[type]) return;
                this._listeners[type] = this._listeners[type].filter(f => f !== fn);
            }

            set onopen(fn) { this._onopen = fn; }
            set onmessage(fn) { this._onmessage = fn; }
            set onclose(fn) { this._onclose = fn; }
            set onerror(fn) { this._onerror = fn; }

            _emit(type, event) {
                const handler = this[`_on${type}`];
                if (handler) handler(event);
                (this._listeners[type] || []).forEach(fn => fn(event));
            }

            send(data) {
                window.__wsMock.lastSent.push(data);
            }

            close() {
                this.readyState = 3; // CLOSED
                this._emit('close', new CloseEvent('close'));
            }

            // Inject a message from "server" into the app
            _injectMessage(data) {
                this._emit('message', new MessageEvent('message', { data }));
            }
        };

        // Copy static constants
        window.WebSocket.CONNECTING = 0;
        window.WebSocket.OPEN = 1;
        window.WebSocket.CLOSING = 2;
        window.WebSocket.CLOSED = 3;
    });
}

/**
 * Set up a session in localStorage so the app skips the Landing page
 * and goes directly to ChatRoom.
 */
export async function loginAs(page, nick = 'TestUser', isAdmin = false) {
    await page.addInitScript(({ nick, isAdmin }) => {
        localStorage.setItem('openwire_session', JSON.stringify({ nick, isAdmin }));
    }, { nick, isAdmin });
}

/**
 * Clear all session and storage state.
 */
export async function clearSession(page) {
    await page.addInitScript(() => {
        localStorage.clear();
        sessionStorage.clear();
    });
}

/**
 * Set up a wallet with a given balance in localStorage.
 */
export async function setWallet(page, balance = 1000) {
    await page.addInitScript(({ balance }) => {
        const deviceId = 'test-device-e2e';
        localStorage.setItem('openwire_device_id', deviceId);
        // Use en-CA locale to match wallet.js getISTDateString() → YYYY-MM-DD
        const today = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Kolkata',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(new Date());
        localStorage.setItem(`openwire_wallet_dev_${deviceId}`, JSON.stringify({
            deviceId,
            nick: 'TestUser',
            baseBalance: balance,
            adminBonus: 0,
            lastRefreshDate: today,
            history: [{ time: Date.now(), reason: 'Test setup', amount: balance, balance }],
        }));
    }, { balance });
}

/**
 * Inject a peer list message into the WebSocket mock.
 */
export async function injectPeers(page, peers) {
    await page.evaluate((peersData) => {
        const ws = window.__wsMock?.active;
        if (ws) {
            ws._injectMessage(JSON.stringify({
                type: 'peers',
                peers: peersData,
            }));
        }
    }, peers);
}

/**
 * Inject a welcome message into the WebSocket mock to transition
 * the session state to CONNECTED (enables chat input, etc.).
 */
export async function injectWelcome(page, opts = {}) {
    const { nick = 'TestUser' } = opts;
    await page.evaluate(({ nick }) => {
        const ws = window.__wsMock?.active;
        if (!ws) return;
        ws._injectMessage(JSON.stringify({
            type: 'welcome',
            peer_id: 'test-peer-001',
            nick,
            peers: [{ peer_id: 'test-peer-001', nick }],
            rooms: [{ room_id: 'room-general', name: 'General Chat' }],
        }));
    }, { nick });
}

/**
 * Known mock-noise patterns to suppress from runtime-error monitoring.
 * Tests can extend via options.extraExpectedPatterns.
 */
const DEFAULT_EXPECTED_PATTERNS = [
    'WebSocket',
    'ws://',
    'wss://',
    'net::ERR_',
    'Failed to fetch',
    'favicon',
];

/**
 * Set up runtime error monitoring on the page.
 *
 * Call in beforeEach, after mockWebSocket(page). Registers listeners that
 * capture unexpected console errors and unhandled page exceptions. Expected
 * mock noise (WebSocket, network-did-not-succeed, favicon) is filtered out.
 *
 * State is stored on page.__runtimeGuard for retrieval by
 * expectNoRuntimeErrors() in afterEach.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ extraExpectedPatterns?: string[] }} options
 */
export async function setupRuntimeGuard(page, options = {}) {
    const { extraExpectedPatterns = [] } = options;
    const expectedPatterns = [
        ...DEFAULT_EXPECTED_PATTERNS,
        ...extraExpectedPatterns,
    ];

    const consoleErrors = [];
    const pageErrors = [];

    const handleConsole = (msg) => {
        if (msg.type() === 'error') {
            const text = msg.text();
            if (!expectedPatterns.some((p) => text.includes(p))) {
                consoleErrors.push(text);
            }
        }
    };

    const handlePageError = (err) => {
        const text = err.message || String(err);
        if (!expectedPatterns.some((p) => text.includes(p))) {
            pageErrors.push({ message: text });
        }
    };

    page.on('console', handleConsole);
    page.on('pageerror', handlePageError);

    // Store for retrieval by expectNoRuntimeErrors
    page.__runtimeGuard = {
        consoleErrors,
        pageErrors,
        cleanup: () => {
            page.removeListener('console', handleConsole);
            page.removeListener('pageerror', handlePageError);
        },
    };
}

/**
 * Assert no unexpected runtime errors occurred since setupRuntimeGuard.
 *
 * Checks:
 *   1. The ErrorBoundary fallback text ("Runtime error") is NOT visible.
 *   2. No unexpected console.error calls were recorded.
 *   3. No unhandled page exceptions were recorded.
 *
 * Call in afterEach, or at critical checkpoints within a test.
 * Silently passes if no guard was set up.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function expectNoRuntimeErrors(page) {
    const guard = page.__runtimeGuard;
    if (!guard) return; // no guard set up, silently pass

    const { consoleErrors, pageErrors } = guard;

    // Check ErrorBoundary fallback is not visible
    const errorFallback = page.locator('text=Runtime error');
    await expect(errorFallback).not.toBeVisible();

    // Fail on unexpected console errors
    expect(
        consoleErrors,
        consoleErrors.length > 0
            ? `Unexpected console errors: ${JSON.stringify(consoleErrors)}`
            : undefined,
    ).toEqual([]);

    // Fail on unexpected page errors
    expect(
        pageErrors,
        pageErrors.length > 0
            ? `Unexpected page errors: ${JSON.stringify(pageErrors)}`
            : undefined,
    ).toEqual([]);
}

/**
 * Clear the runtime guard state from the page.
 * Removes listeners and resets tracked errors.
 * Safe to call even if no guard was set up.
 *
 * @param {import('@playwright/test').Page} page
 */
export function clearRuntimeGuard(page) {
    if (page.__runtimeGuard) {
        page.__runtimeGuard.cleanup();
        delete page.__runtimeGuard;
    }
}

/* ═══════════════════════════════════════════════════════════
   SHASN-specific helpers
   ═══════════════════════════════════════════════════════════ */

/**
 * Create a minimal deterministic Shashn game state for test injection.
 * Players are provided as [{ peer_id, nick, hand, tricksWon, score }, ...]
 */
export function makeShashnGame(overrides = {}) {
    const defaultGame = {
        type: 'shashn',
        roomId: 'test-room-001',
        phase: 'deal',
        players: [
            { peer_id: null, nick: null, hand: [], tricksWon: 0, score: 0 },
            { peer_id: null, nick: null, hand: [], tricksWon: 0, score: 0 },
        ],
        currentPlayer: 0,
        currentTrick: { cards: [], leadSuit: null, winner: null },
        deck: null,
        trumpSuit: null,
        round: 1,
        trickNumber: 1,
        log: [],
        winner: null,
        ...overrides,
    };
    // If overrides provides players, they replace the default ones entirely
    if (overrides.players) {
        defaultGame.players = overrides.players;
    }
    return defaultGame;
}

/**
 * Inject a shashn_start message via the WebSocket mock.
 * Triggers the game_invite card in chat.
 */
export async function injectShashnStart(page, opts = {}) {
    const {
        roomId = 'test-room-001',
        host = 'host-peer-999',
        hostNick = 'HostUser',
    } = opts;
    await page.evaluate(({ roomId, host, hostNick }) => {
        const ws = window.__wsMock?.active;
        if (ws) {
            ws._injectMessage(JSON.stringify({
                type: 'room_message',
                room_id: roomId,
                peer_id: host,
                data: JSON.stringify({
                    type: 'shashn_start',
                    room_id: roomId,
                    host,
                    host_nick: hostNick,
                }),
            }));
        }
    }, { roomId, host, hostNick });
}

/**
 * Inject a shashn_state message via the WebSocket mock.
 * The state parameter should be a game object created with makeShashnGame().
 */
export async function injectShashnState(page, opts = {}) {
    const {
        roomId = 'test-room-001',
        peerId = 'host-peer-999',
        state = makeShashnGame(),
    } = opts;
    await page.evaluate(({ roomId, peerId, state }) => {
        const ws = window.__wsMock?.active;
        if (ws) {
            ws._injectMessage(JSON.stringify({
                type: 'room_message',
                room_id: roomId,
                peer_id: peerId,
                data: JSON.stringify({
                    type: 'shashn_state',
                    state: JSON.stringify(state),
                }),
            }));
        }
    }, { roomId, peerId, state });
}

/**
 * Inject a shashn_join message (simulates a peer joining the game).
 */
export async function injectShashnJoin(page, opts = {}) {
    const {
        roomId = 'test-room-001',
        peerId = 'opponent-peer-002',
        nick = 'OpponentUser',
    } = opts;
    await page.evaluate(({ roomId, peerId, nick }) => {
        const ws = window.__wsMock?.active;
        if (ws) {
            ws._injectMessage(JSON.stringify({
                type: 'room_message',
                room_id: roomId,
                peer_id: peerId,
                data: JSON.stringify({
                    type: 'shashn_join',
                    peer_id: peerId,
                    nick,
                }),
            }));
        }
    }, { roomId, peerId, nick });
}
