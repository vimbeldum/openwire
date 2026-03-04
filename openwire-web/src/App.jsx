import { useState } from 'react';
import Landing from './components/Landing';
import ChatRoom from './components/ChatRoom';

export default function App() {
    const [session, setSession] = useState(null); // { nick, isAdmin }

    if (!session) {
        return <Landing onJoin={(nick, isAdmin) => setSession({ nick, isAdmin })} />;
    }

    return <ChatRoom nick={session.nick} isAdmin={session.isAdmin} />;
}
