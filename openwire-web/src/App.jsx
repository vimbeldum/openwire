import { useState, useEffect, Component } from 'react';
import Landing from './components/Landing';
import ChatRoom from './components/ChatRoom';

const SESSION_KEY = 'openwire_session';

class ErrorBoundary extends Component {
    constructor(props) { super(props); this.state = { error: null }; }
    static getDerivedStateFromError(e) { return { error: e }; }
    render() {
        if (this.state.error) {
            return (
                <div style={{color:'#f88',padding:'2rem',fontFamily:'monospace',whiteSpace:'pre-wrap'}}>
                    <strong>Runtime error — please share this with the dev:</strong>{'\n\n'}
                    {String(this.state.error)}{'\n\n'}
                    {this.state.error?.stack}
                </div>
            );
        }
        return this.props.children;
    }
}

export default function App() {
    const [session, setSession] = useState(() => {
        try {
            const stored = localStorage.getItem(SESSION_KEY);
            return stored ? JSON.parse(stored) : null;
        } catch { return null; }
    });

    // { mode: 'relay' | 'cli-node', cliUrl?: string }
    const [connectionConfig, setConnectionConfig] = useState({ mode: 'relay' });

    const handleJoin = (nick, isAdmin, config = { mode: 'relay' }) => {
        const newSession = { nick, isAdmin };
        setSession(newSession);
        setConnectionConfig(config);
        localStorage.setItem(SESSION_KEY, JSON.stringify(newSession));
    };

    const handleLogout = () => {
        setSession(null);
        localStorage.removeItem(SESSION_KEY);
    };

    if (!session) {
        return <Landing onJoin={handleJoin} />;
    }

    const isCliMode = connectionConfig.mode === 'cli-node';
    const cliHost = isCliMode && connectionConfig.cliUrl
        ? (() => {
            try { return new URL(connectionConfig.cliUrl).host; } catch { return connectionConfig.cliUrl; }
        })()
        : null;

    return (
        <ErrorBoundary>
        <div className="app-container">
            {/* Minimal top bar for logout */}
            <div className="global-header">
                <span>Logged in as <strong>{session.nick}</strong></span>
                {isCliMode
                    ? <span className="connection-mode-badge connection-mode-cli" title={connectionConfig.cliUrl}>
                        <span className="connection-mode-lock">&#128274;</span> CLI Node ({cliHost})
                      </span>
                    : <span className="connection-mode-badge connection-mode-relay">OpenWire Relay</span>
                }
                <button className="btn-logout" onClick={handleLogout}>Logout</button>
            </div>
            <ChatRoom
                nick={session.nick}
                isAdmin={session.isAdmin}
                connectionConfig={connectionConfig}
            />
        </div>
        </ErrorBoundary>
    );
}
