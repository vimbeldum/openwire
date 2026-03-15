import { useState } from 'react';
import { AdminPasswordGate } from './AdminPasswordGate';
import { sanitizeNick } from '../lib/utils/sanitizeNick';

const CLI_NODE_URL_KEY = 'openwire_cli_node_url';
const DEFAULT_CLI_URL = import.meta.env.VITE_CLI_BRIDGE_URL || 'ws://localhost:18080';

export default function Landing({ onJoin }) {
    const [name, setName] = useState('');
    const [showAdminGate, setShowAdminGate] = useState(false);
    const [connectMode, setConnectMode] = useState('relay'); // 'relay' | 'cli-node'
    const [cliUrl, setCliUrl] = useState(
        () => localStorage.getItem(CLI_NODE_URL_KEY) || DEFAULT_CLI_URL
    );

    const handleSubmit = (e) => {
        e.preventDefault();
        const nick = sanitizeNick(name);
        if (connectMode === 'cli-node') {
            const trimmed = cliUrl.trim() || DEFAULT_CLI_URL;
            localStorage.setItem(CLI_NODE_URL_KEY, trimmed);
            onJoin(nick, false, { mode: 'cli-node', cliUrl: trimmed });
        } else {
            onJoin(nick, false, { mode: 'relay' });
        }
    };

    const handleAdminSuccess = () => {
        setShowAdminGate(false);
        const nick = sanitizeNick(name, 'Admin');
        onJoin(nick, true, { mode: 'relay' });
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

                {/* Connection mode selector */}
                <div className="landing-connect-via">
                    <span className="landing-connect-via-label">Connect via</span>
                    <div className="landing-connect-via-options">
                        <label className="landing-radio-option">
                            <input
                                type="radio"
                                name="connectMode"
                                value="relay"
                                checked={connectMode === 'relay'}
                                onChange={() => setConnectMode('relay')}
                            />
                            <span>OpenWire Relay</span>
                        </label>
                        <label className="landing-radio-option">
                            <input
                                type="radio"
                                name="connectMode"
                                value="cli-node"
                                checked={connectMode === 'cli-node'}
                                onChange={() => setConnectMode('cli-node')}
                            />
                            <span>Local CLI Node</span>
                        </label>
                    </div>
                    {connectMode === 'cli-node' && (
                        <input
                            className="landing-cli-url-input"
                            type="text"
                            placeholder="ws://192.168.1.x:18080"
                            value={cliUrl}
                            onChange={(e) => setCliUrl(e.target.value)}
                            spellCheck={false}
                        />
                    )}
                </div>

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
