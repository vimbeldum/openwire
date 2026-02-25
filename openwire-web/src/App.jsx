import { useState } from 'react';
import Landing from './components/Landing';
import ChatRoom from './components/ChatRoom';

export default function App() {
    const [nick, setNick] = useState(null);

    if (!nick) {
        return <Landing onJoin={setNick} />;
    }

    return <ChatRoom nick={nick} />;
}
