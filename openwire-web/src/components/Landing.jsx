import { useState } from 'react';
import { AdminPasswordGate } from './AdminPortal';

export default function Landing({ onJoin }) {
    const [name, setName] = useState('');
    const [showAdminGate, setShowAdminGate] = useState(false);

    const handleSubmit = (e) => {
        e.preventDefault();
        const nick = name.trim().replace(/[\x00-\x1f\x7f]/g, '').slice(0, 24) || 'Anonymous';
        onJoin(nick, false);
    };

    const handleAdminSuccess = () => {
        setShowAdminGate(false);
        const nick = name.trim() || 'Admin';
        onJoin(nick, true);
    };

    return (
        <div className="landing">
            <div className="landing-logo">⚡ OpenWire</div>
            <p className="landing-sub">
                Decentralized encrypted messenger — right in your browser.
                <br />
                No sign-up, no servers reading your messages.
            </p>
            <form className="landing-card" onSubmit={handleSubmit}>
                <h2>Join the Network</h2>
                <input
                    type="text"
                    placeholder="Enter your nickname..."
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoFocus
                    maxLength={24}
                />
                <button type="submit">Connect →</button>
            </form>
            <button
                className="admin-access-link"
                onClick={() => setShowAdminGate(true)}
            >
                🔐 Admin Access
            </button>
            {showAdminGate && (
                <AdminPasswordGate
                    onSuccess={handleAdminSuccess}
                    onCancel={() => setShowAdminGate(false)}
                />
            )}
        </div>
    );
}
