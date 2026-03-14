import { memo, useState, useEffect } from 'react';

const REACTION_EMOJIS = ['\u{1F525}', '\u{1F44F}', '\u{1F4B0}'];
const INVITE_EXPIRE_MS = 60 * 1000; // 60s

function MessageRow({ msg, renderContent, onReact, onJoinInvite, onDismissInvite, myCosmetics }) {
    // Invite expiry: re-check every second
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        if (msg.type !== 'game_invite' || msg.inviteUsed) return;
        const t = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(t);
    }, [msg.type, msg.inviteUsed]);

    if (msg.type === 'game_invite' && !msg.inviteUsed) {
        const expired = msg.ts && (now - msg.ts > INVITE_EXPIRE_MS);
        if (expired) {
            return (
                <div className={`msg ${msg.type}`}>
                    <div className="game-invite-inline used">
                        <span className="game-invite-icon">{msg.sender}</span>
                        <span className="game-invite-text">{msg.content} <em>(expired)</em></span>
                    </div>
                </div>
            );
        }
        return (
            <div className={`msg ${msg.type}`}>
                <div className="game-invite-inline">
                    <span className="game-invite-icon">{msg.sender}</span>
                    <span className="game-invite-text">{msg.content}</span>
                    <button className="game-invite-join" onClick={() => onJoinInvite(msg)}>Join Table</button>
                    <button className="game-invite-dismiss" onClick={() => onDismissInvite(msg.id)}>&#x2715;</button>
                </div>
            </div>
        );
    }

    if (msg.type === 'game_invite' && msg.inviteUsed) {
        return (
            <div className={`msg ${msg.type}`}>
                <div className="game-invite-inline used">
                    <span className="game-invite-icon">{msg.sender}</span>
                    <span className="game-invite-text">{msg.content} <em>(joined)</em></span>
                </div>
            </div>
        );
    }

    // Resolve cosmetic CSS classes for own and peer messages
    const isSelf = msg.type === 'self';
    const isPeer = msg.type === 'peer';
    const cos = isSelf ? myCosmetics : (isPeer ? msg.peerCosmetics : null);
    const bubbleClass = cos?.bubbleStyle || '';
    const nameClass = cos?.nameColor || '';
    const flairClass = cos?.chatFlair || '';
    const contentClasses = ['msg-content', bubbleClass, flairClass].filter(Boolean).join(' ');
    const senderClasses = ['msg-sender', msg.type, nameClass].filter(Boolean).join(' ');

    return (
        <div className={`msg ${msg.type}${msg.type === 'whisper' ? ' whisper' : ''}`}>
            <span className="msg-time">[{msg.time}]</span>
            {msg.sender && <span className={senderClasses}>{msg.sender}:</span>}
            {msg.gif ? (
                <img src={msg.gif} alt="GIF" className="msg-gif" />
            ) : (
                <span className={contentClasses}> {renderContent(msg.content)}</span>
            )}
            {/* Emoji reaction display */}
            {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                <span className="msg-reactions-display">
                    {Object.entries(msg.reactions).map(([emoji, peers]) => (
                        <span key={emoji} className="reaction-badge" onClick={() => onReact(msg.id, emoji)}>
                            {emoji} {peers.length}
                        </span>
                    ))}
                </span>
            )}
            {/* Quick reaction picker -- show on hover via CSS */}
            {(msg.type === 'peer' || msg.type === 'self') && (
                <span className="msg-reaction-bar">
                    {REACTION_EMOJIS.map(e => (
                        <button key={e} className="react-btn" onClick={() => onReact(msg.id, e)}>{e}</button>
                    ))}
                </span>
            )}
        </div>
    );
}

export default memo(MessageRow);
