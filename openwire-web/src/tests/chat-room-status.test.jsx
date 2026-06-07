/**
 * chat-room-status.test.jsx
 *
 * Vitest suite covering the session-state-aware UI layer:
 *   A. ChatShellHeader — truthful status dot, label, and mode badge
 *   B. ConversationEmptyState — state-appropriate copy
 *   C. Composer gating — input disabled, send button disabled
 *
 * Uses @testing-library/react for component rendering.
 * Session state objects are constructed inline rather than going through
 * the reducer, because this suite tests the *presentation* layer, not
 * the state derivation model (which is covered by chat-session-state.test.js).
 */

import { describe, it, expect } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SessionStatus } from '../lib/chatSessionState';

/* ─────────────────────────────────────────────────────────────
   A. ChatShellHeader — status visibility
   ───────────────────────────────────────────────────────────── */

describe('ChatShellHeader — status rendering', () => {
  let ChatShellHeader;

  beforeAll(async () => {
    // Dynamic import avoids stale-browser-global issues at module level
    const mod = await import('../components/ui/ChatShellHeader');
    ChatShellHeader = mod.default;
  });

  function renderHeader(sessionState, overrides = {}) {
    return render(
      <ChatShellHeader
        sidebarOpen={false}
        setSidebarOpen={() => {}}
        currentRoom={null}
        currentRoomName={null}
        safeLeaveRoom={() => {}}
        setCurrentRoom={() => {}}
        roomConstraint={null}
        chaosEnabled={false}
        chaosPersonality="instigator"
        myNick="TestUser"
        isCliMode={false}
        connectionConfig={{}}
        cliHost={null}
        connected={sessionState.status === SessionStatus.CONNECTED}
        sessionState={sessionState}
        peers={[]}
        myWallet={null}
        balance={0}
        showAccountHistory={false}
        setShowAccountHistory={() => {}}
        isAdminRef={{ current: false }}
        agentRunning={false}
        setShowAgentPanel={() => {}}
        showMuteMenu={false}
        setShowMuteMenu={() => {}}
        muteMenuRef={{ current: null }}
        allAgentsMuted={false}
        mutedAgents={{}}
        toggleMuteAgent={() => {}}
        toggleMuteAll={() => {}}
        CHARACTERS={{}}
        onLogout={null}
        activePoke={null}
        setActivePoke={() => {}}
        {...overrides}
      />
    );
  }

  afterEach(() => cleanup());

  it('shows peer online count when CONNECTED', () => {
    const state = { status: SessionStatus.CONNECTED, connectionMode: 'relay', cliNodeHost: null, reconnectAttempt: 0 };
    renderHeader(state, { peers: [{ peer_id: 'a' }, { peer_id: 'b' }] });
    expect(screen.getByText('2 online')).toBeTruthy();
  });

  it('shows status-dot--success class when CONNECTED', () => {
    const state = { status: SessionStatus.CONNECTED, connectionMode: 'relay', cliNodeHost: null, reconnectAttempt: 0 };
    const { container } = renderHeader(state);
    const dot = container.querySelector('.status-dot--success');
    expect(dot).toBeTruthy();
  });

  it('shows "Connecting..." when CONNECTING', () => {
    const state = { status: SessionStatus.CONNECTING, connectionMode: 'relay', cliNodeHost: null, reconnectAttempt: 0 };
    renderHeader(state);
    expect(screen.getByText('Connecting...')).toBeTruthy();
  });

  it('shows status-dot--info class when CONNECTING', () => {
    const state = { status: SessionStatus.CONNECTING, connectionMode: 'relay', cliNodeHost: null, reconnectAttempt: 0 };
    const { container } = renderHeader(state);
    const dot = container.querySelector('.status-dot--info');
    expect(dot).toBeTruthy();
  });

  it('shows "Reconnecting..." when RECONNECTING', () => {
    const state = { status: SessionStatus.RECONNECTING, connectionMode: 'relay', cliNodeHost: null, reconnectAttempt: 3 };
    renderHeader(state);
    expect(screen.getByText('Reconnecting...')).toBeTruthy();
  });

  it('shows status-dot--warning class when RECONNECTING', () => {
    const state = { status: SessionStatus.RECONNECTING, connectionMode: 'relay', cliNodeHost: null, reconnectAttempt: 3 };
    const { container } = renderHeader(state);
    const dot = container.querySelector('.status-dot--warning');
    expect(dot).toBeTruthy();
  });

  it('shows "Connection Lost" when RECONNECT_FAILED', () => {
    const state = { status: SessionStatus.RECONNECT_FAILED, connectionMode: 'relay', cliNodeHost: null, reconnectAttempt: 25 };
    renderHeader(state);
    expect(screen.getByText('Connection Lost')).toBeTruthy();
  });

  it('shows "Disconnected" when DISCONNECTED', () => {
    const state = { status: SessionStatus.DISCONNECTED, connectionMode: 'relay', cliNodeHost: null, reconnectAttempt: 0 };
    renderHeader(state);
    expect(screen.getByText('Disconnected')).toBeTruthy();
  });

  it('shows status-dot--error class when DISCONNECTED', () => {
    const state = { status: SessionStatus.DISCONNECTED, connectionMode: 'relay', cliNodeHost: null, reconnectAttempt: 0 };
    const { container } = renderHeader(state);
    const dot = container.querySelector('.status-dot--error');
    expect(dot).toBeTruthy();
  });

  it('shows CLI node host when CLI_NODE_CONNECTING with host', () => {
    const state = { status: SessionStatus.CLI_NODE_CONNECTING, connectionMode: 'cli-node', cliNodeHost: 'localhost:8080', reconnectAttempt: 0 };
    renderHeader(state);
    expect(screen.getByText('Connecting to localhost:8080...')).toBeTruthy();
  });

  it('shows fallback label when CLI_NODE_FALLBACK', () => {
    const state = { status: SessionStatus.CLI_NODE_FALLBACK, connectionMode: 'relay', cliNodeHost: null, reconnectAttempt: 0 };
    renderHeader(state);
    expect(screen.getByText('CLI node unreachable \u2014 using relay')).toBeTruthy();
  });

  it('shows status-dot--warning class when RECONNECT_FAILED', () => {
    const state = { status: SessionStatus.RECONNECT_FAILED, connectionMode: 'relay', cliNodeHost: null, reconnectAttempt: 25 };
    const { container } = renderHeader(state);
    const dot = container.querySelector('.status-dot--warning');
    expect(dot).toBeTruthy();
  });

  it('shows status-dot--info class when CLI_NODE_CONNECTING', () => {
    const state = { status: SessionStatus.CLI_NODE_CONNECTING, connectionMode: 'cli-node', cliNodeHost: 'localhost:8080', reconnectAttempt: 0 };
    const { container } = renderHeader(state);
    const dot = container.querySelector('.status-dot--info');
    expect(dot).toBeTruthy();
  });

  it('shows status-dot--warning class when CLI_NODE_FALLBACK', () => {
    const state = { status: SessionStatus.CLI_NODE_FALLBACK, connectionMode: 'relay', cliNodeHost: null, reconnectAttempt: 0 };
    const { container } = renderHeader(state);
    const dot = container.querySelector('.status-dot--warning');
    expect(dot).toBeTruthy();
  });
});

/* ─────────────────────────────────────────────────────────────
   B. ConversationEmptyState — truthful copy per session state
   ───────────────────────────────────────────────────────────── */

describe('ConversationEmptyState — copy per session state', () => {
  let ConversationEmptyState;

  beforeAll(async () => {
    const mod = await import('../components/ui/ConversationEmptyState');
    ConversationEmptyState = mod.default;
  });

  afterEach(() => cleanup());

  function renderEmptyState(sessionState) {
    return render(<ConversationEmptyState sessionState={sessionState} />);
  }

  it('shows "Connecting to server..." when CONNECTING', () => {
    const state = { status: SessionStatus.CONNECTING, connectionMode: 'relay', cliNodeHost: null, reconnectAttempt: 0 };
    renderEmptyState(state);
    expect(screen.getByText('Connecting to server...')).toBeTruthy();
  });

  it('shows "Ready for the conversation" when CONNECTED', () => {
    const state = { status: SessionStatus.CONNECTED, connectionMode: 'relay', cliNodeHost: null, reconnectAttempt: 0 };
    renderEmptyState(state);
    expect(screen.getByText('Ready for the conversation')).toBeTruthy();
  });

  it('shows "Reconnecting..." when RECONNECTING', () => {
    const state = { status: SessionStatus.RECONNECTING, connectionMode: 'relay', cliNodeHost: null, reconnectAttempt: 3 };
    renderEmptyState(state);
    expect(screen.getByText('Reconnecting...')).toBeTruthy();
  });

  it('shows "Connection Lost" when RECONNECT_FAILED', () => {
    const state = { status: SessionStatus.RECONNECT_FAILED, connectionMode: 'relay', cliNodeHost: null, reconnectAttempt: 25 };
    renderEmptyState(state);
    expect(screen.getByText('Connection Lost')).toBeTruthy();
  });

  it('shows "Disconnected" when DISCONNECTED', () => {
    const state = { status: SessionStatus.DISCONNECTED, connectionMode: 'relay', cliNodeHost: null, reconnectAttempt: 0 };
    renderEmptyState(state);
    expect(screen.getByText('Disconnected')).toBeTruthy();
  });

  it('shows hint about draft preservation when RECONNECTING', () => {
    const state = { status: SessionStatus.RECONNECTING, connectionMode: 'relay', cliNodeHost: null, reconnectAttempt: 3 };
    renderEmptyState(state);
    expect(screen.getByText(/Your message draft and history are preserved/)).toBeTruthy();
  });

  it('shows CLI node message when CLI_NODE_CONNECTING', () => {
    const state = { status: SessionStatus.CLI_NODE_CONNECTING, connectionMode: 'cli-node', cliNodeHost: 'example.com', reconnectAttempt: 0 };
    renderEmptyState(state);
    expect(screen.getByText('Connecting to CLI node...')).toBeTruthy();
  });

  it('shows relay fallback message when CLI_NODE_FALLBACK', () => {
    const state = { status: SessionStatus.CLI_NODE_FALLBACK, connectionMode: 'relay', cliNodeHost: null, reconnectAttempt: 0 };
    renderEmptyState(state);
    expect(screen.getByText('CLI node unreachable \u2014 using relay')).toBeTruthy();
  });

  it('shows hint about secure connection when CONNECTING', () => {
    const state = { status: SessionStatus.CONNECTING, connectionMode: 'relay', cliNodeHost: null, reconnectAttempt: 0 };
    renderEmptyState(state);
    expect(screen.getByText(/Establishing a secure connection/)).toBeTruthy();
  });

  it('shows hint about typing a message when CONNECTED', () => {
    const state = { status: SessionStatus.CONNECTED, connectionMode: 'relay', cliNodeHost: null, reconnectAttempt: 0 };
    renderEmptyState(state);
    expect(screen.getByText(/Type a message below/)).toBeTruthy();
  });

  it('shows hint about network check when RECONNECT_FAILED', () => {
    const state = { status: SessionStatus.RECONNECT_FAILED, connectionMode: 'relay', cliNodeHost: null, reconnectAttempt: 25 };
    renderEmptyState(state);
    expect(screen.getByText(/check your network or try refreshing/)).toBeTruthy();
  });

  it('shows hint about direct connection when CLI_NODE_CONNECTING', () => {
    const state = { status: SessionStatus.CLI_NODE_CONNECTING, connectionMode: 'cli-node', cliNodeHost: 'example.com', reconnectAttempt: 0 };
    renderEmptyState(state);
    expect(screen.getByText(/Establishing a direct connection/)).toBeTruthy();
  });

  it('shows hint about relay routing when CLI_NODE_FALLBACK', () => {
    const state = { status: SessionStatus.CLI_NODE_FALLBACK, connectionMode: 'relay', cliNodeHost: null, reconnectAttempt: 0 };
    renderEmptyState(state);
    expect(screen.getByText(/Messages are being routed through the OpenWire relay/)).toBeTruthy();
  });

  it('shows hint about page refresh when DISCONNECTED', () => {
    const state = { status: SessionStatus.DISCONNECTED, connectionMode: 'relay', cliNodeHost: null, reconnectAttempt: 0 };
    renderEmptyState(state);
    expect(screen.getByText(/refresh to rejoin/)).toBeTruthy();
  });

  it('defaults to CONNECTING copy when sessionState is null', () => {
    renderEmptyState(null);
    expect(screen.getByText('Connecting to server...')).toBeTruthy();
    expect(screen.getByText(/Establishing a secure connection/)).toBeTruthy();
  });

  it('defaults to CONNECTING copy when sessionState is undefined', () => {
    renderEmptyState(undefined);
    expect(screen.getByText('Connecting to server...')).toBeTruthy();
  });
});

/* ─────────────────────────────────────────────────────────────
   C. isComposerEnabled — gate logic (pure, no React needed)
   ───────────────────────────────────────────────────────────── */

describe('isComposerEnabled — gate logic', () => {
  let isComposerEnabled;

  beforeAll(async () => {
    const mod = await import('../lib/chatSessionState');
    isComposerEnabled = mod.isComposerEnabled;
  });

  it('returns true only when CONNECTED', () => {
    expect(isComposerEnabled({ status: SessionStatus.CONNECTED })).toBe(true);
  });

  it('returns false when CONNECTING', () => {
    expect(isComposerEnabled({ status: SessionStatus.CONNECTING })).toBe(false);
  });

  it('returns false when RECONNECTING', () => {
    expect(isComposerEnabled({ status: SessionStatus.RECONNECTING })).toBe(false);
  });

  it('returns false when RECONNECT_FAILED', () => {
    expect(isComposerEnabled({ status: SessionStatus.RECONNECT_FAILED })).toBe(false);
  });

  it('returns false when DISCONNECTED', () => {
    expect(isComposerEnabled({ status: SessionStatus.DISCONNECTED })).toBe(false);
  });

  it('returns false when CLI_NODE_CONNECTING', () => {
    expect(isComposerEnabled({ status: SessionStatus.CLI_NODE_CONNECTING })).toBe(false);
  });

  it('returns false when CLI_NODE_FALLBACK', () => {
    expect(isComposerEnabled({ status: SessionStatus.CLI_NODE_FALLBACK })).toBe(false);
  });
});
