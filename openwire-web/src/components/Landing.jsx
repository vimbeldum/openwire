import { useState } from 'react';
import { AdminPasswordGate } from './AdminPasswordGate';
import Badge from './ui/Badge';
import Button from './ui/Button';
import Input from './ui/Input';
import Panel from './ui/Panel';
import { sanitizeNick } from '../lib/utils/sanitizeNick';

const CLI_NODE_URL_KEY = 'openwire_cli_node_url';
const DEFAULT_CLI_URL = import.meta.env.VITE_CLI_BRIDGE_URL || 'ws://localhost:18080';

export default function Landing({ onJoin }) {
    const [name, setName] = useState('');
    const [showAdminGate, setShowAdminGate] = useState(false);
    const [connectMode, setConnectMode] = useState('relay');
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
            return;
        }

        onJoin(nick, false, { mode: 'relay' });
    };

    const handleAdminSuccess = () => {
        setShowAdminGate(false);
        const nick = sanitizeNick(name, 'Admin');
        onJoin(nick, true, { mode: 'relay' });
    };

    const usingCliNode = connectMode === 'cli-node';

    return (
        <main className="landing" aria-labelledby="landing-title">
            <section className="landing-shell">
                <Panel className="landing-hero" padding="lg" tone="subtle">
                    <div className="landing-eyebrow">
                        <Badge tone="info">Browser-first encrypted chat</Badge>
                        <span className="landing-eyebrow-text">OpenWire keeps the active conversation front and center.</span>
                    </div>
                    <div className="landing-copy">
                        <p className="landing-kicker">OpenWire</p>
                        <h1 id="landing-title">Join a room fast, keep the conversation primary.</h1>
                        <p className="landing-sub">
                            Start with the hosted relay for the fastest path, or point at your own local CLI node when you need direct control.
                            No account setup, just a nickname and a route into the network.
                        </p>
                    </div>
                    <ul className="landing-highlights" aria-label="OpenWire highlights">
                        <li>Join from any browser with the same room behavior already in use.</li>
                        <li>Use relay mode by default or remember a custom CLI node endpoint locally.</li>
                        <li>Keep admin access protected behind the existing gate.</li>
                    </ul>
                </Panel>

                <Panel as="form" className="landing-card" padding="lg" onSubmit={handleSubmit}>
                    <div className="landing-card-header">
                        <div>
                            <p className="landing-card-kicker">Get connected</p>
                            <h2>Join the network</h2>
                            <p className="landing-card-subtitle">
                                Your nickname stays local to this join flow. Leave it blank to continue as Anonymous.
                            </p>
                        </div>
                        <Badge tone={usingCliNode ? 'success' : 'info'}>
                            {usingCliNode ? 'CLI node selected' : 'Relay default'}
                        </Badge>
                    </div>

                    <Input
                        id="landing-name"
                        type="text"
                        placeholder="Enter your nickname..."
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        autoFocus
                        maxLength={24}
                        label="Nickname"
                        hint="Names are sanitized to 24 visible characters before joining."
                    />

                    <fieldset className="landing-connect-via">
                        <legend className="landing-connect-via-label">Connect via</legend>
                        <p className="landing-connect-help">
                            Choose the relay for the default hosted path, or switch to a local CLI node and reuse its WebSocket URL next time.
                        </p>
                        <div className="landing-connect-via-options">
                            <label className="landing-radio-option">
                                <input
                                    type="radio"
                                    name="connectMode"
                                    value="relay"
                                    checked={!usingCliNode}
                                    onChange={() => setConnectMode('relay')}
                                />
                                <span>
                                    <strong>OpenWire Relay</strong>
                                    <small>Best for most sessions. Uses the standard hosted route.</small>
                                </span>
                            </label>
                            <label className="landing-radio-option">
                                <input
                                    type="radio"
                                    name="connectMode"
                                    value="cli-node"
                                    checked={usingCliNode}
                                    onChange={() => setConnectMode('cli-node')}
                                />
                                <span>
                                    <strong>Local CLI Node</strong>
                                    <small>Use your own bridge endpoint and keep it stored in this browser.</small>
                                </span>
                            </label>
                        </div>
                        {usingCliNode ? (
                            <Input
                                id="landing-cli-url"
                                className="landing-cli-url-input"
                                type="text"
                                placeholder="ws://192.168.1.x:18080"
                                value={cliUrl}
                                onChange={(e) => setCliUrl(e.target.value)}
                                spellCheck={false}
                                label="Node WebSocket URL"
                                hint="Stored locally so repeat CLI-node joins keep using the same endpoint."
                            />
                        ) : null}
                    </fieldset>

                    <div className="landing-actions">
                        <Button type="submit" fullWidth trailingIcon="→">
                            Join OpenWire
                        </Button>
                        <p className="landing-action-note">Joining keeps the current room behavior intact and does not change your admin access path.</p>
                    </div>
                </Panel>
            </section>

            <Button
                className="admin-access-link"
                variant="ghost"
                size="sm"
                onClick={() => setShowAdminGate(true)}
                leadingIcon="🔐"
            >
                Admin Access
            </Button>

            {showAdminGate ? (
                <AdminPasswordGate
                    onSuccess={handleAdminSuccess}
                    onCancel={() => setShowAdminGate(false)}
                />
            ) : null}
        </main>
    );
}
