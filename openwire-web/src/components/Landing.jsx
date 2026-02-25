import { useState } from 'react';

export default function Landing({ onJoin }) {
    const [name, setName] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        const nick = name.trim() || 'Anonymous';
        onJoin(nick);
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
        </div>
    );
}
