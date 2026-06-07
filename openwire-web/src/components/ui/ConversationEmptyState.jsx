import { SessionStatus, getStatusLabel, getStatusVariant } from '../../lib/chatSessionState';

const EMPTY_STATE_MESSAGES = {
  [SessionStatus.CONNECTING]: {
    icon: '🔌',
    title: 'Connecting to server...',
    hint: 'Establishing a secure connection. You will be able to chat momentarily.',
  },
  [SessionStatus.CONNECTED]: {
    icon: '⚡',
    title: 'Ready for the conversation',
    hint: 'Type a message below, browse peers in the sidebar, or launch a game when your table is ready.',
  },
  [SessionStatus.RECONNECTING]: {
    icon: '🔄',
    title: 'Reconnecting...',
    hint: 'Your session was interrupted. We will restore your connection automatically. Your message draft and history are preserved.',
  },
  [SessionStatus.RECONNECT_FAILED]: {
    icon: '🔌',
    title: 'Connection Lost',
    hint: 'Unable to reconnect to the server. Please check your network or try refreshing the page. Your chat history is still visible.',
  },
  [SessionStatus.CLI_NODE_CONNECTING]: {
    icon: '🔗',
    title: 'Connecting to CLI node...',
    hint: 'Establishing a direct connection to the CLI relay node. Stand by.',
  },
  [SessionStatus.CLI_NODE_FALLBACK]: {
    icon: '⚡',
    title: 'CLI node unreachable — using relay',
    hint: 'The CLI node could not be reached. Messages are being routed through the OpenWire relay instead.',
  },
  [SessionStatus.DISCONNECTED]: {
    icon: '🚫',
    title: 'Disconnected',
    hint: 'You have been disconnected from the server. Please refresh to rejoin. Your chat history is preserved.',
  },
};

export default function ConversationEmptyState({ sessionState }) {
  const state = sessionState || { status: SessionStatus.CONNECTING };
  const msg = EMPTY_STATE_MESSAGES[state.status] || EMPTY_STATE_MESSAGES[SessionStatus.CONNECTING];

  return (
    <div className="empty-state">
      <div className="empty-state-icon">{msg.icon}</div>
      <div className="empty-state-title">{msg.title}</div>
      <div className="empty-state-hint">{msg.hint}</div>
    </div>
  );
}
