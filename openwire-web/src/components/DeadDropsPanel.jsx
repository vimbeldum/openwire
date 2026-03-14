/* ═══════════════════════════════════════════════════════════
   OpenWire — Presentation Domain: Dead Drops Panel
   Anonymous message board overlay. Fits within 100dvh × 100vw.
   Internal list scrolls; outer container never overflows.
   ═══════════════════════════════════════════════════════════ */

import { useState, useEffect } from 'react';
import {
    loadFromSession,
    saveToSession,
    createPost,
    vote,
    sortPosts,
} from '../lib/deaddrops.js';

const SORT_TABS = [
    { key: 'hot', label: 'Hot' },
    { key: 'new', label: 'New' },
    { key: 'top', label: 'Top' },
];

function relativeTime(ts) {
    const diffMs = Date.now() - ts;
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} min ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return `${Math.floor(diffHr / 24)}d ago`;
}

function PostCard({ post, deviceId, onVote }) {
    const topReactions = Object.entries(post.reactions || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4);

    return (
        <div className="dd-card">
            <p className="dd-card-body">{post.body}</p>
            <div className="dd-card-meta">
                <div className="dd-vote-row">
                    <button
                        className="dd-vote-btn"
                        onClick={() => onVote(post, 'up')}
                        title="Upvote"
                    >
                        ▲ {post.upvotes}
                    </button>
                    <span className="dd-vote-sep">·</span>
                    <button
                        className="dd-vote-btn"
                        onClick={() => onVote(post, 'down')}
                        title="Downvote"
                    >
                        ▼ {post.downvotes}
                    </button>
                </div>
                {topReactions.length > 0 && (
                    <div className="dd-reactions">
                        {topReactions.map(([emoji, count]) => (
                            <span key={emoji} className="dd-reaction-chip">
                                {emoji} {count}
                            </span>
                        ))}
                    </div>
                )}
                <span className="dd-timestamp">{relativeTime(post.timestamp)}</span>
            </div>
            {post.aiReactions && post.aiReactions.length > 0 && (
                <div className="dd-ai-reactions">
                    {post.aiReactions.map((r, i) => (
                        <em key={i} className="dd-ai-reaction">
                            "{r.reaction}" — {r.characterId}
                        </em>
                    ))}
                </div>
            )}
        </div>
    );
}

export default function DeadDropsPanel({ roomId, karma, deviceId, onClose }) {
    const [posts, setPosts] = useState(() => loadFromSession(roomId));
    const [sortMode, setSortMode] = useState('hot');
    const [newBody, setNewBody] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        setPosts(loadFromSession(roomId));
    }, [roomId]);

    const sorted = sortPosts(posts, sortMode);
    const canPost = karma >= 50;

    function handleVote(post, direction) {
        const updated = vote(post, deviceId, direction);
        const next = posts.map(p => p.id === post.id ? updated : p);
        setPosts(next);
        saveToSession(roomId, next);
    }

    function handleSubmit(e) {
        e.preventDefault();
        setError(null);
        setSubmitting(true);

        const result = createPost(roomId, newBody, deviceId, karma, posts, Date.now());

        setSubmitting(false);

        if (!result.success) {
            setError(result.reason);
            return;
        }

        const next = [result.post, ...posts];
        setPosts(next);
        saveToSession(roomId, next);
        setNewBody('');
    }

    return (
        <div className="ah-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="ah-panel">
                {/* Header */}
                <div className="ah-header">
                    <span className="ah-title">💀 Dead Drops</span>
                    <div className="dd-sort-tabs">
                        {SORT_TABS.map(tab => (
                            <button
                                key={tab.key}
                                className={`dd-sort-btn${sortMode === tab.key ? ' active' : ''}`}
                                onClick={() => setSortMode(tab.key)}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                    <button className="btn-icon-close" onClick={onClose}>✕</button>
                </div>

                {/* Scrollable posts list */}
                <div className="dd-list ah-list">
                    {sorted.length === 0 ? (
                        <div className="ah-empty">
                            No drops yet. Be the first to drop something anonymous.
                        </div>
                    ) : (
                        sorted.map(post => (
                            <PostCard
                                key={post.id}
                                post={post}
                                deviceId={deviceId}
                                onVote={handleVote}
                            />
                        ))
                    )}
                </div>

                {/* New post form */}
                <div className="dd-compose">
                    {!canPost ? (
                        <p className="dd-karma-gate">
                            🔒 Need 50 karma to post (you have {karma})
                        </p>
                    ) : (
                        <form className="dd-form" onSubmit={handleSubmit}>
                            {error && <p className="dd-error">{error}</p>}
                            <textarea
                                className="dd-textarea"
                                placeholder="Drop something anonymous…"
                                maxLength={500}
                                value={newBody}
                                onChange={e => { setNewBody(e.target.value); setError(null); }}
                                rows={3}
                            />
                            <div className="dd-form-footer">
                                <span className="dd-char-count">{newBody.length}/500</span>
                                <button
                                    className="dd-submit-btn"
                                    type="submit"
                                    disabled={submitting || newBody.trim().length === 0}
                                >
                                    {submitting ? 'Dropping…' : 'Drop It'}
                                </button>
                            </div>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
}
