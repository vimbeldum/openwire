import { useState, useEffect, useRef, useCallback } from 'react';
import * as socket from '../lib/socket';
import * as game from '../lib/game';
import GameBoard from './GameBoard';

function timeStr() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function ChatRoom({ nick: initialNick }) {
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState('');
    const [peers, setPeers] = useState([]);
    const [rooms, setRooms] = useState([]);
    const [connected, setConnected] = useState(false);
    const [activeGame, setActiveGame] = useState(null);
    const messagesEnd = useRef(null);

    // Use refs for values needed inside WS event callbacks to avoid stale closures
    const myIdRef = useRef(null);
    const nickRef = useRef(initialNick);
    const activeGameRef = useRef(null);
    const roomsRef = useRef([]);
    const peersRef = useRef([]);

    // Keep refs in sync
    useEffect(() => { activeGameRef.current = activeGame; }, [activeGame]);
    useEffect(() => { roomsRef.current = rooms; }, [rooms]);
    useEffect(() => { peersRef.current = peers; }, [peers]);

    const addMsg = useCallback((sender, content, type = 'chat') => {
        setMessages(prev => [...prev, { time: timeStr(), sender, content, type, id: Date.now() + Math.random() }]);
    }, []);

    // ── Game action handler (uses refs, no stale closure) ─────────────────────
    const handleGameAction = useCallback((msg, action) => {
        const myId = myIdRef.current;
        const myNick = nickRef.current;

        switch (action.type) {
            case 'Challenge': {
                // Ignore our own challenges
                if (action.challenger === myId) return;
                addMsg('★', `🎮 ${msg.nick} challenges you to Tic-Tac-Toe! Auto-joining...`, 'system');
                const g = game.createGame(
                    { peer_id: action.challenger, nick: action.challenger_nick },
                    { peer_id: myId, nick: myNick },
                    msg.room_id
                );
                setActiveGame(g);
                socket.sendRoomMessage(msg.room_id, game.serializeGameAction({
                    type: 'Accept',
                    accepter: myId,
                    accepter_nick: myNick,
                    room_id: msg.room_id,
                }));
                break;
            }
            case 'Accept': {
                // Challenger receives accept — set up game with challenger as X
                if (action.accepter === myId) return; // ignore our own accept echo
                setActiveGame(prev => {
                    // Only set if we sent the challenge (we are X)
                    if (prev && prev.playerX.peer_id === myId) return prev;
                    return game.createGame(
                        { peer_id: myId, nick: myNick },
                        { peer_id: action.accepter, nick: action.accepter_nick },
                        msg.room_id
                    );
                });
                addMsg('★', `🎮 ${action.accepter_nick} accepted! Game on!`, 'system');
                break;
            }
            case 'Move': {
                setActiveGame(prev => {
                    if (!prev) return null;
                    const result = game.makeMove(prev, action.position, action.player);
                    return result.game || prev;
                });
                break;
            }
            case 'Resign': {
                addMsg('★', `🏳️ ${msg.nick} resigned.`, 'system');
                setActiveGame(null);
                break;
            }
        }
    }, [addMsg]);

    // ── WebSocket event handler ────────────────────────────────────────────────
    useEffect(() => {
        // handleGameAction is stable (uses refs), so fine to capture here
        const onEvent = (msg) => {
            switch (msg.type) {
                case 'welcome':
                    myIdRef.current = msg.peer_id;
                    // Server may have suffixed nick if duplicate — sync it
                    if (msg.nick && msg.nick !== nickRef.current) {
                        nickRef.current = msg.nick;
                        addMsg('★', `Your nickname was taken — assigned "${msg.nick}"`, 'system');
                    }
                    setConnected(true);
                    setPeers(msg.peers || []);
                    setRooms(msg.rooms || []);
                    addMsg('★', `Connected! Your ID: ${msg.peer_id}`, 'system');
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
                    setRooms(prev => {
                        const updated = [...prev, { room_id: msg.room_id, name: msg.name, members: 1 }];
                        roomsRef.current = updated;
                        return updated;
                    });
                    addMsg('★', `🏠 Room "${msg.name}" created! ID: ${msg.room_id}`, 'system');
                    break;
                case 'room_joined':
                    setRooms(prev => {
                        const updated = [...prev.filter(r => r.room_id !== msg.room_id), { room_id: msg.room_id, name: msg.name }];
                        roomsRef.current = updated;
                        return updated;
                    });
                    addMsg('★', `🏠 Joined room "${msg.name}"`, 'system');
                    break;
                case 'room_invite':
                    addMsg('★', `🏠 ${msg.from_nick} invited you to "${msg.room_name}"! Joining...`, 'system');
                    socket.joinRoom(msg.room_id);
                    break;
                case 'room_message': {
                    if (game.isGameMessage(msg.data)) {
                        const action = game.parseGameAction(msg.data);
                        if (action) handleGameAction(msg, action);
                    } else {
                        addMsg(`[${msg.room_id?.slice(5, 17)}] ${msg.nick}`, msg.data, 'peer');
                    }
                    break;
                }
                case 'room_peer_joined':
                    addMsg('★', `${msg.nick} joined the room`, 'system');
                    break;
                case 'room_peer_left':
                    addMsg('★', `${msg.nick} left the room`, 'system');
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
        };

        socket.connect(nickRef.current, onEvent);
        return () => socket.disconnect();
    }, [addMsg, handleGameAction]);

    // Auto-scroll
    useEffect(() => {
        messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // ── Command handler ────────────────────────────────────────────────────────
    const handleSend = (e) => {
        e.preventDefault();
        const text = input.trim();
        if (!text) return;
        setInput('');

        const myId = myIdRef.current;
        const myNick = nickRef.current;
        const currentRooms = roomsRef.current;
        const currentPeers = peersRef.current;

        if (text === '/help') {
            addMsg('★', '── COMMANDS ──────────────────────', 'system');
            addMsg('★', '/room create <name>  — create a room', 'system');
            addMsg('★', '/room invite <nick> <room_id>  — invite peer', 'system');
            addMsg('★', '/room list  — list rooms', 'system');
            addMsg('★', '/game tictactoe  — challenge room to game', 'system');
            addMsg('★', '/game rematch  — play again', 'system');
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
                const target = currentPeers.find(p => p.nick === parts[0] || p.peer_id.startsWith(parts[0]));
                if (target) {
                    socket.inviteToRoom(parts[1], target.peer_id);
                    addMsg('★', `🏠 Invited ${target.nick} to room.`, 'system');
                } else {
                    addMsg('★', `⚠ Peer "${parts[0]}" not found. Online: ${currentPeers.map(p => p.nick).join(', ')}`, 'system');
                }
            } else {
                addMsg('★', 'Usage: /room invite <nick> <room_id>', 'system');
            }
            return;
        }

        if (text === '/room list') {
            if (currentRooms.length === 0) {
                addMsg('★', '🏠 No rooms yet. Try /room create <name>', 'system');
            } else {
                currentRooms.forEach(r => addMsg('★', `  🏠 ${r.name}  |  ${r.room_id}`, 'system'));
            }
            return;
        }

        if (text.startsWith('/game tictactoe') || text === '/game') {
            let roomId = text.slice(15).trim();
            if (!roomId && currentRooms.length > 0) roomId = currentRooms[0].room_id;
            if (!roomId) {
                addMsg('★', '⚠ Create a room first: /room create <name>', 'system');
                return;
            }
            addMsg('★', '🎮 Challenging room to Tic-Tac-Toe...', 'system');
            socket.sendRoomMessage(roomId, game.serializeGameAction({
                type: 'Challenge',
                challenger: myId,
                challenger_nick: myNick,
                room_id: roomId,
            }));
            return;
        }

        if (text === '/game rematch') {
            const g = activeGameRef.current;
            if (g) {
                const ng = game.newRound(g);
                setActiveGame(ng);
                socket.sendRoomMessage(ng.roomId, game.serializeGameAction({
                    type: 'Challenge',
                    challenger: myId,
                    challenger_nick: myNick,
                    room_id: ng.roomId,
                }));
            } else {
                addMsg('★', '⚠ No active game.', 'system');
            }
            return;
        }

        // Regular message (broadcast)
        addMsg(myNick, text, 'self');
        socket.sendChat(text);
    };

    // ── Game move ──────────────────────────────────────────────────────────────
    const handleGameMove = (position) => {
        const myId = myIdRef.current;
        if (!activeGame || !game.isMyTurn(activeGame, myId)) return;
        const result = game.makeMove(activeGame, position, myId);
        if (result.error) { addMsg('★', `⚠ ${result.error}`, 'system'); return; }
        setActiveGame(result.game);
        socket.sendRoomMessage(result.game.roomId, game.serializeGameAction({
            type: 'Move',
            position,
            room_id: result.game.roomId,
            player: myId,
        }));
    };

    const handleRematch = () => {
        const myId = myIdRef.current;
        const myNick = nickRef.current;
        const g = activeGameRef.current;
        if (!g) return;
        const ng = game.newRound(g);
        setActiveGame(ng);
        socket.sendRoomMessage(ng.roomId, game.serializeGameAction({
            type: 'Challenge',
            challenger: myId,
            challenger_nick: myNick,
            room_id: ng.roomId,
        }));
    };

    const myNick = nickRef.current;

    return (
        <div className="chat-layout">
            <header className="chat-header">
                <h1>⚡ OpenWire</h1>
                <div className="header-status">
                    <span className={`status-dot ${connected ? '' : 'offline'}`} />
                    <span>{connected ? `${myNick} — ${peers.length} online` : 'Connecting...'}</span>
                </div>
            </header>

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

            <div className="sidebar">
                <div className="sidebar-section">
                    <div className="sidebar-title">Online ({peers.length})</div>
                    {peers.filter(p => p.peer_id !== myIdRef.current).map((p) => (
                        <div key={p.peer_id} className="peer-item">
                            <span className="peer-dot" />
                            <span className="peer-nick">{p.nick}</span>
                        </div>
                    ))}
                    {peers.filter(p => p.peer_id !== myIdRef.current).length === 0 && (
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
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
                            const r = roomsRef.current[0];
                            if (!r) return;
                            socket.sendRoomMessage(r.room_id, game.serializeGameAction({
                                type: 'Challenge',
                                challenger: myIdRef.current,
                                challenger_nick: nickRef.current,
                                room_id: r.room_id,
                            }));
                            addMsg('★', '🎮 Game challenge sent!', 'system');
                        }}>🎮 Challenge to Game</button>
                    )}
                </div>
            </div>

            {activeGame && (
                <GameBoard
                    game={activeGame}
                    myId={myIdRef.current}
                    onMove={handleGameMove}
                    onRematch={handleRematch}
                    onClose={() => setActiveGame(null)}
                />
            )}
        </div>
    );
}
