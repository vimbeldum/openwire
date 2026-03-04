import { useState, useEffect } from 'react';
import Landing from './components/Landing';
import ChatRoom from './components/ChatRoom';

const SESSION_KEY = 'openwire_session';

export default function App() {
    const [session, setSession] = useState(() => {
        try {
            const stored = localStorage.getItem(SESSION_KEY);
            return stored ? JSON.parse(stored) : null;
        } catch { return null; }
    });

    const handleJoin = (nick, isAdmin) => {
        const newSession = { nick, isAdmin };
        setSession(newSession);
        localStorage.setItem(SESSION_KEY, JSON.stringify(newSession));
    };

    const handleLogout = () => {
        setSession(null);
        localStorage.removeItem(SESSION_KEY);
    };

    if (!session) {
        return <Landing onJoin={handleJoin} />;
    }

    return (
        <div className="app-container">
            {/* Minimal top bar for logout */}
            <div className="global-header">
                <span>Logged in as <strong>{session.nick}</strong></span>
                <button className="btn-logout" onClick={handleLogout}>Logout</button>
            </div>
            <ChatRoom nick={session.nick} isAdmin={session.isAdmin} />
        </div>
    );
}
