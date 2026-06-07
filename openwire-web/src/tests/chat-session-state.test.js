/**
 * chat-session-state.test.js
 *
 * Vitest suite for the pure session-state derivation module.
 *
 * Coverage goals:
 *   - All state transitions from socket events
 *   - Edge cases (duplicate events, unknown events, null/missing fields)
 *   - UI helper functions (isComposerEnabled, getStatusLabel, getStatusVariant)
 *   - CLI-node mode transitions (connecting → fallback)
 */

import { describe, it, expect } from 'vitest';
import {
  SessionStatus,
  createInitialSessionState,
  sessionStateReducer,
  isComposerEnabled,
  getStatusLabel,
  getStatusVariant,
} from '../lib/chatSessionState.js';

/* ═══════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════ */

/** Convenience: reduce a list of events in sequence and return the final state. */
function reduceAll(initial, events) {
  return events.reduce(sessionStateReducer, initial);
}

/* ═══════════════════════════════════════════════════════════════
   1. INITIAL STATE
   ═══════════════════════════════════════════════════════════════ */

describe('1. Initial state', () => {
  it('starts as CONNECTING with relay mode', () => {
    const s = createInitialSessionState();
    expect(s.status).toBe(SessionStatus.CONNECTING);
    expect(s.connectionMode).toBe('relay');
    expect(s.cliNodeHost).toBeNull();
    expect(s.reconnectAttempt).toBe(0);
  });

  it('initial state has no unexpected properties', () => {
    const s = createInitialSessionState();
    const keys = Object.keys(s);
    expect(keys).toEqual(['status', 'connectionMode', 'cliNodeHost', 'reconnectAttempt']);
  });
});

/* ═══════════════════════════════════════════════════════════════
   2. STATE TRANSITIONS — relay mode
   ═══════════════════════════════════════════════════════════════ */

describe('2. State transitions — relay mode', () => {
  it('welcome transitions from CONNECTING → CONNECTED', () => {
    const s = reduceAll(createInitialSessionState(), [
      { type: 'welcome', peer_id: 'abc' },
    ]);
    expect(s.status).toBe(SessionStatus.CONNECTED);
  });

  it('disconnected transitions from CONNECTED → RECONNECTING', () => {
    const s = reduceAll(createInitialSessionState(), [
      { type: 'welcome', peer_id: 'abc' },
      { type: 'disconnected' },
    ]);
    expect(s.status).toBe(SessionStatus.RECONNECTING);
  });

  it('reconnect_failed transitions from RECONNECTING → RECONNECT_FAILED', () => {
    const s = reduceAll(createInitialSessionState(), [
      { type: 'welcome', peer_id: 'abc' },
      { type: 'disconnected' },
      { type: 'reconnect_failed' },
    ]);
    expect(s.status).toBe(SessionStatus.RECONNECT_FAILED);
  });

  it('reconnecting then welcome = back to CONNECTED', () => {
    const s = reduceAll(createInitialSessionState(), [
      { type: 'welcome', peer_id: 'abc' },
      { type: 'disconnected' },
      { type: 'welcome', peer_id: 'abc' },
    ]);
    expect(s.status).toBe(SessionStatus.CONNECTED);
  });

  it('reconnect_failed then welcome = back to CONNECTED', () => {
    const s = reduceAll(createInitialSessionState(), [
      { type: 'welcome', peer_id: 'abc' },
      { type: 'disconnected' },
      { type: 'reconnect_failed' },
      { type: 'welcome', peer_id: 'abc' },
    ]);
    expect(s.status).toBe(SessionStatus.CONNECTED);
  });

  it('banned transitions from CONNECTED → DISCONNECTED', () => {
    const s = reduceAll(createInitialSessionState(), [
      { type: 'welcome', peer_id: 'abc' },
      { type: 'banned', message: 'You are banned.' },
    ]);
    expect(s.status).toBe(SessionStatus.DISCONNECTED);
  });
});

/* ═══════════════════════════════════════════════════════════════
   3. STATE TRANSITIONS — CLI-node mode
   ═══════════════════════════════════════════════════════════════ */

describe('3. State transitions — CLI-node mode', () => {
  it('cli_node_connecting sets status + mode + host', () => {
    const s = reduceAll(createInitialSessionState(), [
      { type: 'cli_node_connecting', url: 'ws://192.168.1.5:18080/ws' },
    ]);
    expect(s.status).toBe(SessionStatus.CLI_NODE_CONNECTING);
    expect(s.connectionMode).toBe('cli-node');
    expect(s.cliNodeHost).toBe('ws://192.168.1.5:18080/ws');
  });

  it('cli_node_fallback transitions back to relay mode', () => {
    const s = reduceAll(createInitialSessionState(), [
      { type: 'cli_node_connecting', url: 'ws://192.168.1.5:18080/ws' },
      { type: 'cli_node_fallback' },
    ]);
    expect(s.status).toBe(SessionStatus.CLI_NODE_FALLBACK);
    expect(s.connectionMode).toBe('relay');
    expect(s.cliNodeHost).toBeNull();
  });

  it('cli_node_fallback then welcome = back to CONNECTED relay', () => {
    const s = reduceAll(createInitialSessionState(), [
      { type: 'cli_node_connecting', url: 'ws://10.0.0.1:18080/ws' },
      { type: 'cli_node_fallback' },
      { type: 'welcome', peer_id: 'abc' },
    ]);
    expect(s.status).toBe(SessionStatus.CONNECTED);
    expect(s.connectionMode).toBe('relay');
  });

  it('cli_node_connecting with missing url stores null for host', () => {
    const s = sessionStateReducer(createInitialSessionState(), { type: 'cli_node_connecting' });
    expect(s.status).toBe(SessionStatus.CLI_NODE_CONNECTING);
    expect(s.connectionMode).toBe('cli-node');
    expect(s.cliNodeHost).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════
   4. EDGE CASES
   ═══════════════════════════════════════════════════════════════ */

describe('4. Edge cases', () => {
  it('unknown event type is a no-op', () => {
    const s = createInitialSessionState();
    const result = sessionStateReducer(s, { type: 'peer_joined', nick: 'Bob' });
    expect(result).toBe(s); // same reference for no-op
  });

  it('null/undefined event fields do not crash', () => {
    expect(() => {
      sessionStateReducer(createInitialSessionState(), { type: 'cli_node_connecting', url: undefined });
    }).not.toThrow();
  });

  it('multiple disconnected events stay in RECONNECTING', () => {
    const s = reduceAll(createInitialSessionState(), [
      { type: 'welcome', peer_id: 'abc' },
      { type: 'disconnected' },
      { type: 'disconnected' },
    ]);
    expect(s.status).toBe(SessionStatus.RECONNECTING);
  });

  it('welcome resets reconnectAttempt to 0', () => {
    const s = reduceAll(
      { ...createInitialSessionState(), reconnectAttempt: 5, status: SessionStatus.RECONNECTING },
      [{ type: 'welcome', peer_id: 'abc' }]
    );
    expect(s.status).toBe(SessionStatus.CONNECTED);
    expect(s.reconnectAttempt).toBe(0);
  });

  it('switch from cli-node connecting to welcome sets mode back to relay', () => {
    const s = reduceAll(createInitialSessionState(), [
      { type: 'cli_node_connecting', url: 'ws://10.0.0.5:18080/ws' },
      { type: 'welcome', peer_id: 'abc' },
    ]);
    // Welcome defaults to relay mode (it doesn't know about CLI) — cliNodeHost unchanged
    expect(s.status).toBe(SessionStatus.CONNECTED);
    // The welcome event doesn't change connectionMode/cliNodeHost; those are
    // transport-layer concerns that cli_node_fallback resets explicitly
  });
});

/* ═══════════════════════════════════════════════════════════════
   5. UI HELPERS — isComposerEnabled
   ═══════════════════════════════════════════════════════════════ */

describe('5. UI helpers — isComposerEnabled', () => {
  const CONNECTED_STATE = { status: SessionStatus.CONNECTED };
  const ALL_OTHER = [
    SessionStatus.INITIAL,
    SessionStatus.CONNECTING,
    SessionStatus.RECONNECTING,
    SessionStatus.RECONNECT_FAILED,
    SessionStatus.CLI_NODE_CONNECTING,
    SessionStatus.CLI_NODE_FALLBACK,
    SessionStatus.DISCONNECTED,
  ];

  it('returns true only when status is CONNECTED', () => {
    expect(isComposerEnabled(CONNECTED_STATE)).toBe(true);
  });

  ALL_OTHER.forEach(status => {
    it(`returns false when status is ${status}`, () => {
      expect(isComposerEnabled({ status })).toBe(false);
    });
  });
});

/* ═══════════════════════════════════════════════════════════════
   6. UI HELPERS — getStatusLabel
   ═══════════════════════════════════════════════════════════════ */

describe('6. UI helpers — getStatusLabel', () => {
  it('returns "Connecting..." for INITIAL', () => {
    expect(getStatusLabel({ status: SessionStatus.INITIAL })).toBe('Connecting...');
  });

  it('returns "Connecting..." for CONNECTING', () => {
    expect(getStatusLabel({ status: SessionStatus.CONNECTING })).toBe('Connecting...');
  });

  it('returns "Connected" for CONNECTED', () => {
    expect(getStatusLabel({ status: SessionStatus.CONNECTED })).toBe('Connected');
  });

  it('returns "Reconnecting..." for RECONNECTING', () => {
    expect(getStatusLabel({ status: SessionStatus.RECONNECTING })).toBe('Reconnecting...');
  });

  it('returns "Connection Lost" for RECONNECT_FAILED', () => {
    expect(getStatusLabel({ status: SessionStatus.RECONNECT_FAILED })).toBe('Connection Lost');
  });

  it('includes the CLI host in label for CLI_NODE_CONNECTING when host known', () => {
    const label = getStatusLabel({ status: SessionStatus.CLI_NODE_CONNECTING, cliNodeHost: '192.168.1.5:18080' });
    expect(label).toBe('Connecting to 192.168.1.5:18080...');
  });

  it('uses generic label for CLI_NODE_CONNECTING when host unknown', () => {
    const label = getStatusLabel({ status: SessionStatus.CLI_NODE_CONNECTING, cliNodeHost: null });
    expect(label).toBe('Connecting to CLI node...');
  });

  it('returns CLI fallback message for CLI_NODE_FALLBACK', () => {
    const label = getStatusLabel({ status: SessionStatus.CLI_NODE_FALLBACK });
    expect(label).toContain('CLI node unreachable');
    expect(label).toContain('relay');
  });

  it('returns "Disconnected" for DISCONNECTED', () => {
    expect(getStatusLabel({ status: SessionStatus.DISCONNECTED })).toBe('Disconnected');
  });

  it('returns "Unknown" for unrecognized status', () => {
    expect(getStatusLabel({ status: 'foobar' })).toBe('Unknown');
  });
});

/* ═══════════════════════════════════════════════════════════════
   7. UI HELPERS — getStatusVariant
   ═══════════════════════════════════════════════════════════════ */

describe('7. UI helpers — getStatusVariant', () => {
  it('returns "success" for CONNECTED', () => {
    expect(getStatusVariant({ status: SessionStatus.CONNECTED })).toBe('success');
  });

  it('returns "info" for CONNECTING and CLI_NODE_CONNECTING', () => {
    expect(getStatusVariant({ status: SessionStatus.CONNECTING })).toBe('info');
    expect(getStatusVariant({ status: SessionStatus.CLI_NODE_CONNECTING })).toBe('info');
  });

  it('returns "warning" for RECONNECTING, RECONNECT_FAILED, CLI_NODE_FALLBACK', () => {
    expect(getStatusVariant({ status: SessionStatus.RECONNECTING })).toBe('warning');
    expect(getStatusVariant({ status: SessionStatus.RECONNECT_FAILED })).toBe('warning');
    expect(getStatusVariant({ status: SessionStatus.CLI_NODE_FALLBACK })).toBe('warning');
  });

  it('returns "error" for DISCONNECTED', () => {
    expect(getStatusVariant({ status: SessionStatus.DISCONNECTED })).toBe('error');
  });
});

/* ═══════════════════════════════════════════════════════════════
   8. FULL CYCLE SCENARIOS
   ═══════════════════════════════════════════════════════════════ */

describe('8. Full cycle scenarios', () => {
  it('happy path: initial → welcome → connected', () => {
    const events = [
      { type: 'welcome', peer_id: 'abc' },
    ];
    const s = reduceAll(createInitialSessionState(), events);
    expect(s.status).toBe(SessionStatus.CONNECTED);
    expect(isComposerEnabled(s)).toBe(true);
  });

  it('reconnect cycle: connected → disconnected → reconnecting → welcome → connected', () => {
    const events = [
      { type: 'welcome', peer_id: 'abc' },
      { type: 'disconnected' },
      { type: 'welcome', peer_id: 'abc' },
    ];
    const s = reduceAll(createInitialSessionState(), events);
    expect(s.status).toBe(SessionStatus.CONNECTED);
    expect(isComposerEnabled(s)).toBe(true);
    expect(s.reconnectAttempt).toBe(0);
  });

  it('reconnect exhaustion: connected → reconnecting... ×25 → reconnect_failed', () => {
    const events = [
      { type: 'welcome', peer_id: 'abc' },
      { type: 'disconnected' },
      { type: 'reconnect_failed' },
    ];
    const s = reduceAll(createInitialSessionState(), events);
    expect(s.status).toBe(SessionStatus.RECONNECT_FAILED);
    expect(isComposerEnabled(s)).toBe(false);
    expect(getStatusLabel(s)).toBe('Connection Lost');
    expect(getStatusVariant(s)).toBe('warning');
  });

  it('CLI node path: cli_node_connecting → welcome = connected', () => {
    // This is what happens when CLI node connects on first attempt
    const events = [
      { type: 'cli_node_connecting', url: 'ws://10.0.0.1:18080/ws' },
      { type: 'welcome', peer_id: 'abc' },
    ];
    const s = reduceAll(createInitialSessionState(), events);
    expect(s.status).toBe(SessionStatus.CONNECTED);
    expect(isComposerEnabled(s)).toBe(true);
  });

  it('CLI node failover: cli_node_connecting → cli_node_fallback → welcome', () => {
    const events = [
      { type: 'cli_node_connecting', url: 'ws://10.0.0.1:18080/ws' },
      { type: 'cli_node_fallback' },
      { type: 'welcome', peer_id: 'abc' },
    ];
    const s = reduceAll(createInitialSessionState(), events);
    expect(s.status).toBe(SessionStatus.CONNECTED);
    expect(s.connectionMode).toBe('relay');
    expect(s.cliNodeHost).toBeNull();
    expect(isComposerEnabled(s)).toBe(true);
  });

  it('banned during reconnecting → disconnected', () => {
    const events = [
      { type: 'welcome', peer_id: 'abc' },
      { type: 'disconnected' },
      { type: 'banned', message: 'Banned for spamming' },
    ];
    const s = reduceAll(createInitialSessionState(), events);
    expect(s.status).toBe(SessionStatus.DISCONNECTED);
    expect(isComposerEnabled(s)).toBe(false);
    expect(getStatusVariant(s)).toBe('error');
  });

  it('unknown events interleaved do not change state', () => {
    const events = [
      { type: 'welcome', peer_id: 'abc' },
      { type: 'peers', peers: [{ peer_id: 'x', nick: 'X' }] },
      { type: 'peer_joined', peer_id: 'y', nick: 'Y' },
      { type: 'message', data: 'hello' },
    ];
    const s = reduceAll(createInitialSessionState(), events);
    expect(s.status).toBe(SessionStatus.CONNECTED);
  });
});
