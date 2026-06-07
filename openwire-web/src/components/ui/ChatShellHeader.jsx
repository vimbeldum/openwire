import { CHAOS_PERSONALITIES, ROOM_CONSTRAINTS } from '../../lib/chaosAgent';
import Badge from './Badge';
import { SessionStatus, getStatusLabel, getStatusVariant } from '../../lib/chatSessionState';

export default function ChatShellHeader({
  /* Navigation */
  sidebarOpen,
  setSidebarOpen,

  /* Room context */
  currentRoom,
  currentRoomName,
  safeLeaveRoom,
  setCurrentRoom,
  roomConstraint,
  chaosEnabled,
  chaosPersonality,

  /* Identity & connection */
  myNick,
  isCliMode,
  connectionConfig,
  cliHost,
  connected,
  peers,
  sessionState,

  /* Wallet */
  myWallet,
  balance,

  /* Actions */
  showAccountHistory,
  setShowAccountHistory,
  isAdminRef,
  agentRunning,
  setShowAgentPanel,

  /* Mute */
  showMuteMenu,
  setShowMuteMenu,
  muteMenuRef,
  allAgentsMuted,
  mutedAgents,
  toggleMuteAgent,
  toggleMuteAll,
  CHARACTERS,

  /* Auth */
  onLogout,

  /* Overlays */
  activePoke,
  setActivePoke,
}) {
  const statusVariant = getStatusVariant(sessionState);
  const statusLabel = getStatusLabel(sessionState);

  // Derive compact room/peer summary for mobile drawer context.
  // Avoid duplicating full statusLabel text here — the header-status block already
  // renders that. The compact summary focuses on room context + a concise peer count.
  const roomLabel = currentRoomName
    ? { icon: '🏠', label: currentRoomName }
    : { icon: '💬', label: 'General Chat' };
  const peerSummary = sessionState.status === SessionStatus.CONNECTED
    ? `${peers.length} online`
    : ''; /* non-CONNECTED state is conveyed by the status-dot color alone */

  return (
    <header className="chat-header">
      <div className="header-brand">
        <button
          className="hamburger-btn"
          onClick={() => setSidebarOpen(v => !v)}
          aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
          aria-expanded={sidebarOpen}
          aria-controls="chat-sidebar"
        >☰</button>
        <div className="header-brand-copy">
          <h1>⚡ OpenWire</h1>
        </div>
      </div>
      <div className="header-context" aria-label="Conversation context">
        <div className="header-context-primary">
          {currentRoomName ? (
            <span className="current-room-indicator">
              <span className="room-icon">🏠</span>
              <span className="room-label">Room</span>
              <span className="room-name">{currentRoomName}</span>
              <button className="leave-room-btn" onClick={() => { safeLeaveRoom(currentRoom); setCurrentRoom(null); }} title="Leave Room">✕</button>
            </span>
          ) : (
            <span className="general-chat-indicator">
              <span className="room-icon">💬</span>
              <span className="room-label">Channel</span>
              <span className="room-name">General Chat</span>
            </span>
          )}
        </div>
        <div className="header-context-badges">
          {roomConstraint && (
            <Badge tone="warning">{ROOM_CONSTRAINTS[roomConstraint].badge}</Badge>
          )}
          {chaosEnabled && (
            <Badge tone="danger">{CHAOS_PERSONALITIES[chaosPersonality].emoji} Chaos ON</Badge>
          )}
        </div>
      </div>

      {/* Compact mobile context summary — visible on narrow screens where .header-context is hidden */}
      <div className="header-context-compact" aria-label="Room and session summary">
        <span className="compact-room-name">{roomLabel.icon} {roomLabel.label}</span>
        <span className="compact-separator" aria-hidden="true">·</span>
        <span className="compact-peer-count">
          <span className={`compact-status-dot status-dot--${statusVariant}`} />
          {peerSummary}
        </span>
      </div>

      <div className="header-status" aria-label="Session status">
        <div className="header-identity-block">
          <span className="header-nick">{myNick}</span>
          {isCliMode
            ? <span className="connection-mode-badge connection-mode-cli" title={connectionConfig.cliUrl}>
                <span className="connection-mode-lock">&#128274;</span> CLI Node ({cliHost})
              </span>
            : <span className="connection-mode-badge connection-mode-relay">OpenWire Relay</span>
          }
        </div>
        <div className="header-presence-block">
          <span className={`status-dot status-dot--${statusVariant}`} />
          <span className="header-online-count">
            {sessionState.status === SessionStatus.CONNECTED
              ? `${peers.length} online`
              : statusLabel
            }
          </span>
        </div>
        {myWallet && (
          <div className="header-wallet-block">
            <button
              className="btn-account-history"
              onClick={() => setShowAccountHistory(true)}
              title="Account History"
            >📊</button>
            <span className="header-chips">💰 {balance.toLocaleString()}</span>
          </div>
        )}
        <div className="header-actions">
          {isAdminRef.current && (
            <button
              className={`btn-agent-panel ${agentRunning ? 'active' : ''}`}
              onClick={() => setShowAgentPanel(v => !v)}
              title="Pop-Culture Agent Swarm"
            >🤖</button>
          )}
          <div className="mute-agents-wrapper" ref={muteMenuRef}>
            <button
              className={`btn-mute-agents ${allAgentsMuted ? 'muted' : ''}`}
              onClick={() => setShowMuteMenu(v => !v)}
              title={allAgentsMuted ? 'AI characters muted' : 'Mute AI characters'}
            >{allAgentsMuted ? '🔇' : '🔊'}</button>
            {showMuteMenu && (
              <div className="mute-agents-menu">
                <div className="mute-menu-header">
                  <span>AI Characters</span>
                  <button className="mute-menu-toggle-all" onClick={toggleMuteAll}>
                    {allAgentsMuted ? 'Unmute All' : 'Mute All'}
                  </button>
                </div>
                {Object.values(CHARACTERS).map(c => (
                  <label key={c.id} className="mute-menu-row">
                    <input
                      type="checkbox"
                      checked={!mutedAgents[c.id]}
                      onChange={() => toggleMuteAgent(c.id)}
                    />
                    <span>{c.avatar} {c.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          {onLogout && <button className="btn-logout" onClick={onLogout}>Logout</button>}
        </div>
      </div>
    </header>
  );
}
