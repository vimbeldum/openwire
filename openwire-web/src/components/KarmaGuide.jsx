/* ═══════════════════════════════════════════════════════════
   OpenWire — KarmaGuide
   Overlay explaining karma: tiers, how to earn/lose, anti-gaming.
   Presentation domain only — no side-effects.
   ═══════════════════════════════════════════════════════════ */

import { TIERS } from '../lib/reputation.js';

/* ── Data ─────────────────────────────────────────────────── */

const EARN = [
    { icon: '💸', label: 'Receive a tip',        detail: '+2 per 100 chips received (e.g. 500-chip tip → +10)' },
    { icon: '🎰', label: 'Win a game',            detail: '+3 per game type win (1 h cooldown per game type)' },
    { icon: '😄', label: 'Get a reaction',        detail: '+1 when someone reacts to your message (unique per reactor + message)' },
    { icon: '💀', label: 'Dead Drop upvoted',     detail: '+2 per 5 upvotes your anonymous post earns' },
    { icon: '🏆', label: 'Win a bounty',          detail: '+5 for solving a community bounty' },
    { icon: '🔥', label: '7-day login streak',    detail: '+1 for maintaining a 7+ day consecutive login streak' },
];

const LOSE = [
    { icon: '👢', label: 'Getting kicked',   detail: '−10 per kick from a room' },
    { icon: '🚫', label: 'Getting banned',   detail: '−50 and tier resets to newcomer' },
    { icon: '😴', label: 'Idle decay',       detail: '−1 applied when you have been idle too long' },
];

const ANTI_GAMING = [
    { icon: '🔄', label: 'No self-tipping',     detail: 'Tipping yourself does not award karma' },
    { icon: '⏱', label: 'Tip-cycling blocked', detail: 'If you tip someone who tipped you within 10 minutes, the karma is blocked' },
    { icon: '⏳', label: 'Game win cooldown',   detail: 'Only 1 karma award per game type per hour' },
    { icon: '🔒', label: 'Reaction dedup',      detail: 'Each unique user can only award karma once per message' },
];

/* ── Component ─────────────────────────────────────────────── */

export default function KarmaGuide({ currentKarma = 0, currentTier = 'newcomer', onClose }) {
    return (
        <div className="game-overlay" style={styles.overlay} onClick={e => e.target === e.currentTarget && onClose?.()}>
            <div className="game-card" style={styles.panel}>

                {/* Header */}
                <div style={styles.header}>
                    <span style={styles.title}>⭐ Karma Guide</span>
                    <button onClick={onClose} style={styles.closeBtn}>✕</button>
                </div>

                <div style={styles.body}>

                    {/* Your standing */}
                    <div style={styles.standingBox}>
                        <span style={styles.standingLabel}>Your Karma</span>
                        <span style={styles.standingKarma}>{currentKarma}</span>
                        <TierBadge tier={currentTier} large />
                    </div>

                    {/* Tiers */}
                    <Section title="Karma Tiers">
                        <div style={styles.tierGrid}>
                            {TIERS.map(t => (
                                <div
                                    key={t.name}
                                    style={{
                                        ...styles.tierRow,
                                        background: currentTier === t.name ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)',
                                        border: currentTier === t.name ? '1px solid rgba(255,255,255,0.18)' : '1px solid rgba(255,255,255,0.06)',
                                    }}
                                >
                                    <span style={{ fontSize: '1rem' }}>{t.badge ?? '—'}</span>
                                    <div style={styles.tierInfo}>
                                        <span style={{
                                            fontWeight: 700,
                                            color: t.color === 'rainbow' ? 'transparent' : (t.color ?? 'rgba(255,255,255,0.55)'),
                                            background: t.color === 'rainbow' ? 'linear-gradient(90deg,#f44,#fa0,#ff0,#0f0,#0ff,#a0f)' : undefined,
                                            WebkitBackgroundClip: t.color === 'rainbow' ? 'text' : undefined,
                                            backgroundClip: t.color === 'rainbow' ? 'text' : undefined,
                                            WebkitTextFillColor: t.color === 'rainbow' ? 'transparent' : undefined,
                                            textTransform: 'capitalize',
                                        }}>
                                            {t.name}
                                        </span>
                                        <span style={styles.tierRange}>
                                            {t.max === Infinity ? `${t.min}+` : `${t.min} – ${t.max}`} karma
                                        </span>
                                    </div>
                                    {currentTier === t.name && (
                                        <span style={{ fontSize: '0.65rem', color: '#4ade80', fontWeight: 600 }}>YOU</span>
                                    )}
                                </div>
                            ))}
                        </div>
                    </Section>

                    {/* Earn */}
                    <Section title="How to Earn Karma">
                        {EARN.map(({ icon, label, detail }) => (
                            <EventRow key={label} icon={icon} label={label} detail={detail} color="#4ade80" sign="+" />
                        ))}
                    </Section>

                    {/* Lose */}
                    <Section title="How to Lose Karma">
                        {LOSE.map(({ icon, label, detail }) => (
                            <EventRow key={label} icon={icon} label={label} detail={detail} color="#f87171" sign="−" />
                        ))}
                    </Section>

                    {/* Anti-gaming */}
                    <Section title="Anti-Gaming Rules">
                        {ANTI_GAMING.map(({ icon, label, detail }) => (
                            <EventRow key={label} icon={icon} label={label} detail={detail} color="#fbbf24" />
                        ))}
                    </Section>

                    <p style={styles.footer}>
                        Karma never drops below 0. Higher tiers unlock Dead Drops posting (50+) and Bounty creation (200+).
                    </p>
                </div>
            </div>
        </div>
    );
}

/* ── Sub-components ─────────────────────────────────────────── */

function TierBadge({ tier, large }) {
    const t = TIERS.find(t => t.name === tier) ?? TIERS[0];
    const isRainbow = t.color === 'rainbow';
    return (
        <span style={{
            fontSize: large ? '0.85rem' : '0.7rem',
            fontWeight: 700,
            textTransform: 'capitalize',
            color: isRainbow ? 'transparent' : (t.color ?? 'rgba(255,255,255,0.5)'),
            background: isRainbow
                ? 'linear-gradient(90deg,#f44,#fa0,#ff0,#0f0,#0ff,#a0f)'
                : (t.color ? `${t.color}20` : 'rgba(255,255,255,0.07)'),
            WebkitBackgroundClip: isRainbow ? 'text' : undefined,
            backgroundClip: isRainbow ? 'text' : undefined,
            WebkitTextFillColor: isRainbow ? 'transparent' : undefined,
            padding: large ? '0.2rem 0.5rem' : '0.1rem 0.35rem',
            borderRadius: '999px',
            border: `1px solid ${isRainbow ? '#a855f7' : (t.color ?? 'rgba(255,255,255,0.15)')}40`,
        }}>
            {t.badge ? `${t.badge} ` : ''}{tier}
        </span>
    );
}

function Section({ title, children }) {
    return (
        <div style={styles.section}>
            <p style={styles.sectionTitle}>{title}</p>
            <div style={styles.sectionBody}>{children}</div>
        </div>
    );
}

function EventRow({ icon, label, detail, color, sign }) {
    return (
        <div style={styles.eventRow}>
            <span style={styles.eventIcon}>{icon}</span>
            <div style={styles.eventInfo}>
                <span style={{ fontSize: '0.83rem', fontWeight: 600, color: color ?? 'rgba(255,255,255,0.75)' }}>
                    {sign && <span style={{ marginRight: '2px', opacity: 0.7 }}>{sign}</span>}
                    {label}
                </span>
                <span style={styles.eventDetail}>{detail}</span>
            </div>
        </div>
    );
}

/* ── Inline styles ──────────────────────────────────────────── */

const styles = {
    overlay: { overflow: 'hidden' },
    panel: {
        width: 'min(520px, 96vw)',
        maxHeight: '90dvh',
        padding: 0,
        display: 'flex',
        flexDirection: 'column',
        textAlign: 'left',
    },
    header: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.9rem 1.2rem',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        flexShrink: 0,
    },
    title: {
        fontSize: '1.05rem',
        fontWeight: 700,
        color: 'rgba(255,255,255,0.9)',
    },
    closeBtn: {
        background: 'none', border: 'none',
        color: 'rgba(255,255,255,0.5)', fontSize: '1rem',
        cursor: 'pointer', padding: '0.2rem 0.4rem',
    },
    body: {
        overflowY: 'auto',
        flex: 1,
        padding: '1rem 1.2rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
    },
    standingBox: {
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        background: 'rgba(255,255,255,0.05)',
        borderRadius: '10px',
        padding: '0.75rem 1rem',
        border: '1px solid rgba(255,255,255,0.08)',
    },
    standingLabel: {
        fontSize: '0.75rem',
        color: 'rgba(255,255,255,0.4)',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
    },
    standingKarma: {
        fontSize: '1.6rem',
        fontWeight: 800,
        color: '#fbbf24',
        fontVariantNumeric: 'tabular-nums',
    },
    section: {
        display: 'flex',
        flexDirection: 'column',
        gap: '0.4rem',
    },
    sectionTitle: {
        fontSize: '0.72rem',
        fontWeight: 700,
        color: 'rgba(255,255,255,0.35)',
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        margin: 0,
    },
    sectionBody: {
        display: 'flex',
        flexDirection: 'column',
        gap: '0.3rem',
    },
    eventRow: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.6rem',
        padding: '0.45rem 0.6rem',
        background: 'rgba(255,255,255,0.03)',
        borderRadius: '7px',
    },
    eventIcon: {
        fontSize: '1rem',
        lineHeight: 1.4,
        flexShrink: 0,
    },
    eventInfo: {
        display: 'flex',
        flexDirection: 'column',
        gap: '0.1rem',
    },
    eventDetail: {
        fontSize: '0.73rem',
        color: 'rgba(255,255,255,0.38)',
        lineHeight: 1.4,
    },
    tierGrid: {
        display: 'flex',
        flexDirection: 'column',
        gap: '0.3rem',
    },
    tierRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '0.6rem',
        padding: '0.4rem 0.6rem',
        borderRadius: '7px',
    },
    tierInfo: {
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        gap: '0.05rem',
    },
    tierRange: {
        fontSize: '0.7rem',
        color: 'rgba(255,255,255,0.3)',
    },
    footer: {
        fontSize: '0.75rem',
        color: 'rgba(255,255,255,0.3)',
        lineHeight: 1.5,
        margin: 0,
        borderTop: '1px solid rgba(255,255,255,0.06)',
        paddingTop: '0.75rem',
    },
};
