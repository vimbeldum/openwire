import { useState, useEffect, useRef, useCallback } from 'react';
import * as socket from '../lib/socket';
import * as game from '../lib/game';
import GameBoard from './GameBoard';

function timeStr() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function ChatRoom({ nick }) {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [peers, setPeers] = useState([]);
    const [rooms, setRooms] = useState([]);
    const [myId, setMyId] = useState(null);
    const [connected, setConnected] = useState(false);
    const [activeGame, setActiveGame] = useState(null);
    const [pendingChallenge, setPendingChallenge] = useState(null);
    const messagesEnd = useRef(null);

    const addMsg = useCallback((sender, content, type = 'chat') => {
        setMessages(prev => [...prev, { time: timeStr(), sender, content, type, id: Date.now() + Math.random() }]);
    }, []);

    // Connect to relay
    useEffect(() => {
        socket.connect(nick, (msg) => {
            switch (msg.type) {
                case 'welcome':
                    setMyId(msg.peer_id);
                    setConnected(true);
                    setPeers(msg.peers || []);
                    setRooms(msg.rooms || []);
                    addMsg('★', 'Connected to OpenWire relay!', 'system');
                    addMsg('★', `Your ID: ${msg.peer_id}`, 'system');
                    addMsg('★', 'Type /help for commands.', 'system');
                    break;
                case 'peers':
                    setPeers(msg.peers || []);
                    if (msg.rooms) setRooms(msg.rooms);
                    break;
                case 'peer_joined':
                    setPeers(prev => [...prev.filter(p => p.peer_id !== msg.peer_id), { peer_id: msg.peer_id, nick: msg.nick }]);
                    addMsg('★', `${msg.nick} joined`, 'system');
                    break;
                case 'peer_left':
                    setPeers(prev => prev.filter(p => p.peer_id !== msg.peer_id));
                    addMsg('★', `${msg.nick} left`, 'system');
                    break;
                case 'message':
                    addMsg(msg.nick, msg.data, 'peer');
                    break;
                case 'room_created':
                    setRooms(prev => [...prev, { room_id: msg.room_id, name: msg.name, members: 1 }]);
                    addMsg('★', `🏠 Room "${msg.name}" created! ID: ${msg.room_id}`, 'system');
                    break;
                case 'room_joined':
                    setRooms(prev => [...prev.filter(r => r.room_id !== msg.room_id), { room_id: msg.room_id, name: msg.name }]);
                    addMsg('★', `🏠 Joined room "${msg.name}"`, 'system');
                    break;
                case 'room_invite':
                    addMsg('★', `🏠 ${msg.from_nick} invited you to "${msg.room_name}"!`, 'system');
                    // Auto-join
                    socket.joinRoom(msg.room_id);
                    break;
                case 'room_message':
                    handleRoomMessage(msg);
                    break;
                case 'room_peer_joined':
                    addMsg('★', `${msg.nick} joined room`, 'system');
                    break;
                case 'room_peer_left':
                    addMsg('★', `${msg.nick} left room`, 'system');
                    break;
                case 'room_list':
                    setRooms(msg.rooms || []);
                    break;
                case 'disconnected':
                    setConnected(false);
                    addMsg('★', '⚠ Disconnected — reconnecting...', 'system');
                    break;
                case 'error':
                    addMsg('★', `⚠ ${msg.message}`, 'system');
                    break;
            }
        });
        return () => socket.disconnect();
    }, [nick, addMsg]);

    // Handle room messages (check for game actions)
    const handleRoomMessage = useCallback((msg) => {
        if (game.isGameMessage(msg.data)) {
            const action = game.parseGameAction(msg.data);
            if (!action) return;
            handleGameAction(msg, action);
        } else {
            addMsg(`[${msg.room_id?.slice(0, 12)}] ${msg.nick}`, msg.data, 'peer');
        }
    }, [addMsg]);

    const handleGameAction = useCallback((msg, action) => {
        switch (action.type) {
            case 'Challenge':
                setPendingChallenge({ ...action, room_id: msg.room_id, from_nick: msg.nick });
                addMsg('★', `🎮 ${msg.nick} challenges you to Tic-Tac-Toe!`, 'system');
                // Auto-accept
                setActiveGame(prev => {
                    const g = game.createGame(
                        { peer_id: action.challenger, nick: action.challenger_nick },
                        { peer_id: myId, nick },
                        msg.room_id
                    );
                    return g;
                });
                socket.sendRoomMessage(msg.room_id, game.serializeGameAction({
                    type: 'Accept',
                    accepter: myId,
                    accepter_nick: nick,
                    room_id: msg.room_id,
                }));
                break;
            case 'Accept':
                if (!activeGame) {
                    setActiveGame(game.createGame(
                        { peer_id: myId, nick },
                        { peer_id: action.accepter, nick: action.accepter_nick },
                        msg.room_id
                    ));
                }
                addMsg('★', `🎮 ${action.accepter_nick} accepted! Game on!`, 'system');
                break;
            case 'Move':
                setActiveGame(prev => {
                    if (!prev) return null;
                    const result = game.makeMove(prev, action.position, action.player);
                    return result.game || prev;
                });
                break;
            case 'Resign':
                addMsg('★', `🏳️ ${msg.nick} resigned!`, 'system');
                setActiveGame(null);
                break;
        }
    }, [myId, nick, activeGame, addMsg]);

    // Auto-scroll
    useEffect(() => {
        messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // Handle user input
    const handleSend = (e) => {
        e.preventDefault();
        const text = input.trim();
        if (!text) return;
        setInput('');

        if (text === '/help') {
            addMsg('★', '── COMMANDS ──', 'system');
            addMsg('★', '/room create <name>  — Create a room', 'system');
            addMsg('★', '/room invite <peer> <room> — Invite peer', 'system');
            addMsg('★', '/room list — List rooms', 'system');
            addMsg('★', '/game tictactoe <room_id> — Start game', 'system');
            addMsg('★', '/game rematch — Play again', 'system');
            return;
        }

        if (text.startsWith('/room create ')) {
            const name = text.slice(13).trim();
            if (name) socket.createRoom(name);
            return;
        }

        if (text.startsWith('/room invite ')) {
            const parts = text.slice(13).trim().split(/\s+/);
            if (parts.length >= 2) {
                const peerId = peers.find(p => p.nick === parts[0] || p.peer_id.startsWith(parts[0]))?.peer_id;
                if (peerId) {
                    socket.inviteToRoom(parts[1], peerId);
                    addMsg('★', `🏠 Inviting ${parts[0]} to ${parts[1]}`, 'system');
                } else {
                    addMsg('★', `⚠ Peer "${parts[0]}" not found`, 'system');
                }
            }
            return;
        }

        if (text === '/room list') {
            socket.send({ type: 'room_list' });
            if (rooms.length === 0) {
                addMsg('★', '🏠 No rooms', 'system');
            } else {
                rooms.forEach(r => addMsg('★', `  🏠 ${r.name} (${r.room_id})`, 'system'));
            }
            return;
        }

        if (text.startsWith('/game tictactoe')) {
            let roomId = text.slice(16).trim();
            if (!roomId && rooms.length > 0) roomId = rooms[0].room_id;
            if (!roomId) {
                addMsg('★', '⚠ Create a room first: /room create <name>', 'system');
                return;
            }
            addMsg('★', '🎮 Starting Tic-Tac-Toe! Waiting for opponent...', 'system');
            socket.sendRoomMessage(roomId, game.serializeGameAction({
                type: 'Challenge',
                challenger: myId,
                challenger_nick: nick,
                room_id: roomId,
            }));
            return;
        }

        if (text === '/game rematch' && activeGame) {
            const g = game.newRound(activeGame);
            setActiveGame(g);
            socket.sendRoomMessage(g.roomId, game.serializeGameAction({
                type: 'Challenge',
                challenger: myId,
                challenger_nick: nick,
                room_id: g.roomId,
            }));
            return;
        }

        // Regular message
        addMsg(nick, text, 'self');
        socket.sendChat(text);
    };

    // Game move handler
    const handleGameMove = (position) => {
        if (!activeGame || !game.isMyTurn(activeGame, myId)) return;
        const result = game.makeMove(activeGame, position, myId);
        if (result.error) {
            addMsg('★', `⚠ ${result.error}`, 'system');
            return;
        }
        setActiveGame(result.game);
        socket.sendRoomMessage(result.game.roomId, game.serializeGameAction({
            type: 'Move',
            position,
            room_id: result.game.roomId,
            player: myId,
        }));
    };

    const handleRematch = () => {
        if (!activeGame) return;
        const g = game.newRound(activeGame);
        setActiveGame(g);
        socket.sendRoomMessage(g.roomId, game.serializeGameAction({
            type: 'Challenge',
            challenger: myId,
            challenger_nick: nick,
            room_id: g.roomId,
        }));
    };

    return (
        <div className="chat-layout">
            {/* Header */}
            <header className="chat-header">
                <h1>⚡ OpenWire</h1>
                <div className="header-status">
                    <span className={`status-dot ${connected ? '' : 'offline'}`} />
                    <span>{connected ? `${nick} — ${peers.length} online` : 'Connecting...'}</span>
                </div>
            </header>

            {/* Messages */}
            <div className="messages-area">
                {messages.map((m) => (
                    <div key={m.id} className={`msg ${m.type}`}>
                        <span className="msg-time">[{m.time}]</span>
                        <span className={`msg-sender ${m.type}`}>{m.sender}:</span>
                        <span className="msg-content"> {m.content}</span>
                    </div>
                ))}
                <div ref={messagesEnd} />
            </div>

            {/* Input */}
            <form className="chat-input" onSubmit={handleSend}>
                <input
                    type="text"
                    placeholder="Type a message or /help..."
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    autoFocus
                />
                <button type="submit">Send</button>
            </form>

            {/* Sidebar */}
            <div className="sidebar">
                <div className="sidebar-section">
                    <div className="sidebar-title">Peers ({peers.length})</div>
                    {peers.filter(p => p.peer_id !== myId).map((p) => (
                        <div key={p.peer_id} className="peer-item">
                            <span className="peer-dot" />
                            <span className="peer-nick">{p.nick}</span>
                        </div>
                    ))}
                    {peers.filter(p => p.peer_id !== myId).length === 0 && (
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', padding: '0.25rem' }}>
                            No peers yet…
                        </div>
                    )}
                </div>

                <div className="sidebar-section">
                    <div className="sidebar-title">Rooms ({rooms.length})</div>
                    {rooms.map((r) => (
                        <div key={r.room_id} className="room-item">
                            <span className="room-icon">🏠</span>
                            <span className="room-name">{r.name}</span>
                        </div>
                    ))}
                </div>

                <div className="sidebar-actions">
                    <button className="sidebar-btn" onClick={() => {
                        const name = prompt('Room name:');
                        if (name) socket.createRoom(name);
                    }}>+ Create Room</button>
                    {rooms.length > 0 && (
                        <button className="sidebar-btn" onClick={() => {
                            if (rooms.length > 0) {
                                socket.sendRoomMessage(rooms[0].room_id, game.serializeGameAction({
                                    type: 'Challenge', challenger: myId, challenger_nick: nick, room_id: rooms[0].room_id,
                                }));
                                addMsg('★', '🎮 Challenge sent!', 'system');
                            }
                        }}>🎮 Tic-Tac-Toe</button>
                    )}
                </div>
            </div>

            {/* Game Overlay */}
            {activeGame && (
                <GameBoard
                    game={activeGame}
                    myId={myId}
                    onMove={handleGameMove}
                    onRematch={handleRematch}
                    onClose={() => setActiveGame(null)}
                />
            )}
        </div>
    );
}
