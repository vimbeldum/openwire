/* ═══════════════════════════════════════════════════════════
   OpenWire — Presentation: Typing Indicator
   Shows who is currently typing in the active room.
   Supports both peer and AI agent typing indicators.
   Appears between message list and input area.
   ═══════════════════════════════════════════════════════════ */

export default function TypingBar({ typingPeers, agentTyping, myId }) {
    const peerActive = Object.entries(typingPeers || {})
        .filter(([pid, v]) => pid !== myId && Date.now() - v.ts < 3000);

    const agentActive = Object.entries(agentTyping || {})
        .filter(([, v]) => Date.now() - v.ts < 15000); // agents can take up to 15s

    const totalActive = peerActive.length + agentActive.length;
    if (!totalActive) return <div className="typing-bar typing-bar-empty" />;

    // Build label with agent avatars
    const peerNicks = peerActive.map(([, v]) => v.nick);
    const agentLabels = agentActive.map(([, v]) => `${v.avatar} ${v.nick}`);
    const allLabels = [...agentLabels, ...peerNicks];

    const label =
        allLabels.length === 1 ? `${allLabels[0]} is typing` :
        allLabels.length === 2 ? `${allLabels[0]} and ${allLabels[1]} are typing` :
        `${allLabels[0]} and ${allLabels.length - 1} others are typing`;

    return (
        <div className="typing-bar">
            <span className="typing-dots">
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
            </span>
            <span className="typing-text">{label}…</span>
        </div>
    );
}
