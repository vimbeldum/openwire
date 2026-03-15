/* ═══════════════════════════════════════════════════════════
   OpenWire — Presentation: Casino Live Ticker
   Separate from the main chat — shows game events, big wins,
   live results as a horizontal ticker tape.
   Casino events NEVER appear in the main message feed.
   ═══════════════════════════════════════════════════════════ */

import { useRef, useEffect, memo } from 'react';

const GAME_ICONS = {
    roulette: '🎰',
    blackjack: '♠',
    andarbahar: '🃏',
    casino: '🏆',
    screenshot: '📸',
};

function LiveTicker({ items }) {
    const scrollRef = useRef(null);

    // Auto-scroll to latest item
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
        }
    }, [items.length]);

    if (!items.length) return null;

    return (
        <div className="live-ticker">
            <span className="ticker-label">LIVE</span>
            <div className="ticker-scroll" ref={scrollRef}>
                {items.map((item, i) => (
                    <span key={i} className={`ticker-item ${item.gameType || 'casino'}`}>
                        {GAME_ICONS[item.gameType] || '🎮'} {item.text}
                        {i < items.length - 1 && <span className="ticker-sep">·</span>}
                    </span>
                ))}
            </div>
        </div>
    );
}

export default memo(LiveTicker);
