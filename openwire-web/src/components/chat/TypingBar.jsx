/* ═══════════════════════════════════════════════════════════
   OpenWire — Presentation: Typing Indicator
   Shows who is currently typing in the active room.
   Appears between message list and input area.
   ═══════════════════════════════════════════════════════════ */

export default function TypingBar({ typingPeers, myId }) {
    const active = Object.entries(typingPeers)
        .filter(([pid, v]) => pid !== myId && Date.now() - v.ts < 3000);

    if (!active.length) return <div className="typing-bar typing-bar-empty" />;

    const nicks = active.map(([, v]) => v.nick);
    const label =
        nicks.length === 1 ? `${nicks[0]} is typing` :
        nicks.length === 2 ? `${nicks[0]} and ${nicks[1]} are typing` :
        `${nicks[0]} and ${nicks.length - 1} others are typing`;

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
