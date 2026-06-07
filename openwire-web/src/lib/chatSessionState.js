/**
 * chatSessionState.js
 *
 * Pure session-state derivation module for OpenWire's chat shell.
 *
 * Transforms raw socket events (welcome, disconnected, reconnect_failed,
 * cli_node_connecting, cli_node_fallback) into a stable, explicit status
 * vocabulary that ChatRoom.jsx can use for truthful UI rendering of
 * connection life-cycle states.
 *
 * This module is intentionally free of React, DOM, and transport dependencies.
 */

/* ─── State vocabulary ─────────────────────────────────────── */

/** @readonly @enum {string} */
export const SessionStatus = {
  /** No connection established yet. */
  INITIAL: 'initial',
  /** WebSocket opened, awaiting welcome message from the relay. */
  CONNECTING: 'connecting',
  /** Welcome received — full read/write session active. */
  CONNECTED: 'connected',
  /** Socket closed; reconnect loop in progress. */
  RECONNECTING: 'reconnecting',
  /** Reconnect attempts exhausted (after MAX_RECONNECT_ATTEMPTS=25). */
  RECONNECT_FAILED: 'reconnect_failed',
  /** Attempting a direct CLI-node WebSocket bridge. */
  CLI_NODE_CONNECTING: 'cli_node_connecting',
  /** CLI node unreachable after MAX_CLI_ATTEMPTS; falling back to relay. */
  CLI_NODE_FALLBACK: 'cli_node_fallback',
  /** Explicitly disconnected (banned, disconnect(), etc.) — no reconnect expected. */
  DISCONNECTED: 'disconnected',
};

/* ─── State shape ──────────────────────────────────────────── */

/**
 * @typedef {Object} SessionState
 * @property {SessionStatus} status
 * @property {'relay'|'cli-node'} connectionMode
 * @property {string|null} cliNodeHost  — displayed host when in cli-node mode
 * @property {number} reconnectAttempt   — current reconnect attempt count
 */

/* ─── Factory ──────────────────────────────────────────────── */

/**
 * Create the initial session state (no socket activity yet).
 * @returns {SessionState}
 */
export function createInitialSessionState() {
  return {
    status: SessionStatus.CONNECTING,
    connectionMode: 'relay',
    cliNodeHost: null,
    reconnectAttempt: 0,
  };
}

/* ─── Pure reducer ─────────────────────────────────────────── */

/**
 * Pure function: given the previous session state and a raw socket event
 * (as delivered by socket.js listeners), return the next session state.
 *
 * Unknown or irrelevant event types are safe no-ops.
 *
 * @param {SessionState} prev
 * @param {{ type: string, [key: string]: any }} event
 * @returns {SessionState}
 */
export function sessionStateReducer(prev, event) {
  switch (event.type) {
    case 'welcome':
      return {
        ...prev,
        status: SessionStatus.CONNECTED,
        reconnectAttempt: 0,
      };

    case 'disconnected':
      return {
        ...prev,
        status: SessionStatus.RECONNECTING,
      };

    case 'reconnect_failed':
      return {
        ...prev,
        status: SessionStatus.RECONNECT_FAILED,
      };

    case 'cli_node_connecting':
      return {
        ...prev,
        status: SessionStatus.CLI_NODE_CONNECTING,
        connectionMode: 'cli-node',
        cliNodeHost: event.url || null,
      };

    case 'cli_node_fallback':
      return {
        ...prev,
        status: SessionStatus.CLI_NODE_FALLBACK,
        connectionMode: 'relay',
        cliNodeHost: null,
      };

    case 'banned':
      return {
        ...prev,
        status: SessionStatus.DISCONNECTED,
      };

    default:
      return prev;
  }
}

/* ─── UI helpers ───────────────────────────────────────────── */

/**
 * Should the message composer (input + send button) be enabled?
 * @param {SessionState} state
 * @returns {boolean}
 */
export function isComposerEnabled(state) {
  return state.status === SessionStatus.CONNECTED;
}

/**
 * Get a human-readable status label for the current session state.
 * @param {SessionState} state
 * @returns {string}
 */
export function getStatusLabel(state) {
  switch (state.status) {
    case SessionStatus.INITIAL:
    case SessionStatus.CONNECTING:
      return 'Connecting...';
    case SessionStatus.CONNECTED:
      return 'Connected';
    case SessionStatus.RECONNECTING:
      return 'Reconnecting...';
    case SessionStatus.RECONNECT_FAILED:
      return 'Connection Lost';
    case SessionStatus.CLI_NODE_CONNECTING:
      return state.cliNodeHost
        ? `Connecting to ${state.cliNodeHost}...`
        : 'Connecting to CLI node...';
    case SessionStatus.CLI_NODE_FALLBACK:
      return 'CLI node unreachable — using relay';
    case SessionStatus.DISCONNECTED:
      return 'Disconnected';
    default:
      return 'Unknown';
  }
}

/**
 * Return a semantic variant string for styling the status indicator.
 * @param {SessionState} state
 * @returns {'success'|'info'|'warning'|'error'}
 */
export function getStatusVariant(state) {
  switch (state.status) {
    case SessionStatus.CONNECTED:
      return 'success';
    case SessionStatus.CONNECTING:
    case SessionStatus.CLI_NODE_CONNECTING:
      return 'info';
    case SessionStatus.RECONNECTING:
    case SessionStatus.RECONNECT_FAILED:
    case SessionStatus.CLI_NODE_FALLBACK:
      return 'warning';
    case SessionStatus.DISCONNECTED:
      return 'error';
    default:
      return 'info';
  }
}
