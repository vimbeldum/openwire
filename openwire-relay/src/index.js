/* ═══════════════════════════════════════════════════════════
   OpenWire Relay — Cloudflare Worker + Durable Object
   WebSocket relay for auto peer discovery & message relay
   ═══════════════════════════════════════════════════════════ */

export default {
    async fetch(request, env) {
        // Route all WebSocket connections to a single Durable Object
        const id = env.RELAY.idFromName("global");
        const relay = env.RELAY.get(id);
        return relay.fetch(request);
    },
};

export class RelayRoom {
    constructor(state) {
        this.state = state;
        // ws → { peer_id, nick, rooms: Set<string> }
        this.peers = new Map();
        // room_id → { name, members: Set<string> }
        this.rooms = new Map();
    }

    async fetch(request) {
        const url = new URL(request.url);

        // Health check
        if (url.pathname === "/health") {
            return new Response(
                JSON.stringify({ status: "ok", peers: this.peers.size }),
                { headers: { "content-type": "application/json" } }
            );
        }

        // CORS preflight
        if (request.method === "OPTIONS") {
            return new Response(null, {
                headers: corsHeaders(),
            });
        }

        // WebSocket upgrade
        const upgradeHeader = request.headers.get("Upgrade");
        if (!upgradeHeader || upgradeHeader !== "websocket") {
            return new Response("Expected WebSocket", { status: 426, headers: corsHeaders() });
        }

        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);

        this.handleSession(server);

        return new Response(null, {
            status: 101,
            webSocket: client,
            headers: corsHeaders(),
        });
    }

    handleSession(ws) {
        ws.accept();
        let peerInfo = null;

        ws.addEventListener("message", (event) => {
            let msg;
            try {
                msg = JSON.parse(event.data);
            } catch {
                return;
            }

            switch (msg.type) {
                case "join": {
                    const peer_id = msg.peer_id || crypto.randomUUID().slice(0, 16);
                    let nick = (msg.nick || "Anonymous").slice(0, 24);
                    // Enforce unique nick
                    const takenNicks = new Set([...this.peers.values()].map(p => p.nick));
                    let base = nick, counter = 2;
                    while (takenNicks.has(nick)) nick = `${base}${counter++}`;

                    peerInfo = { peer_id, nick, rooms: new Set() };
                    this.peers.set(ws, peerInfo);

                    this.send(ws, {
                        type: "welcome",
                        peer_id,
                        nick, // final (possibly suffixed) nick
                        peers: this.peerList(),
                        rooms: this.roomList(),
                    });

                    this.broadcast(
                        { type: "peer_joined", peer_id, nick },
                        ws
                    );
                    break;
                }

                case "message": {
                    if (!peerInfo) return;
                    this.broadcast(
                        {
                            type: "message",
                            from: peerInfo.peer_id,
                            nick: peerInfo.nick,
                            data: msg.data,
                        },
                        ws
                    );
                    break;
                }

                case "room_create": {
                    if (!peerInfo) return;
                    const room_id = "room-" + crypto.randomUUID().slice(0, 16);
                    const name = (msg.name || "Untitled").slice(0, 50);
                    this.rooms.set(room_id, {
                        name,
                        members: new Set([peerInfo.peer_id]),
                    });
                    peerInfo.rooms.add(room_id);
                    this.send(ws, { type: "room_created", room_id, name });
                    this.broadcastPeerUpdate();
                    break;
                }

                case "room_join": {
                    if (!peerInfo) return;
                    const room = this.rooms.get(msg.room_id);
                    if (!room) {
                        this.send(ws, { type: "error", message: "Room not found" });
                        return;
                    }
                    room.members.add(peerInfo.peer_id);
                    peerInfo.rooms.add(msg.room_id);

                    this.broadcastToRoom(msg.room_id, {
                        type: "room_peer_joined",
                        room_id: msg.room_id,
                        peer_id: peerInfo.peer_id,
                        nick: peerInfo.nick,
                    });
                    this.send(ws, { type: "room_joined", room_id: msg.room_id, name: room.name });
                    break;
                }

                case "room_invite": {
                    if (!peerInfo) return;
                    const invRoom = this.rooms.get(msg.room_id);
                    if (!invRoom) return;

                    for (const [clientWs, info] of this.peers) {
                        if (info.peer_id === msg.peer_id) {
                            this.send(clientWs, {
                                type: "room_invite",
                                room_id: msg.room_id,
                                room_name: invRoom.name,
                                from: peerInfo.peer_id,
                                from_nick: peerInfo.nick,
                            });
                            break;
                        }
                    }
                    break;
                }

                case "room_message": {
                    if (!peerInfo) return;
                    this.broadcastToRoom(
                        msg.room_id,
                        {
                            type: "room_message",
                            room_id: msg.room_id,
                            from: peerInfo.peer_id,
                            nick: peerInfo.nick,
                            data: msg.data,
                        },
                        ws
                    );
                    break;
                }

                case "room_leave": {
                    if (!peerInfo) return;
                    this.leaveRoom(peerInfo, msg.room_id);
                    break;
                }

                case "room_list": {
                    this.send(ws, { type: "room_list", rooms: this.roomList() });
                    break;
                }
            }
        });

        ws.addEventListener("close", () => {
            if (!peerInfo) return;
            for (const room_id of peerInfo.rooms) {
                this.leaveRoom(peerInfo, room_id, true);
            }
            this.peers.delete(ws);
            this.broadcast({
                type: "peer_left",
                peer_id: peerInfo.peer_id,
                nick: peerInfo.nick,
            });
        });

        ws.addEventListener("error", () => {
            this.peers.delete(ws);
        });
    }

    // ── Helpers ──────────────────────────────────────────────

    send(ws, obj) {
        try {
            ws.send(JSON.stringify(obj));
        } catch { /* closed */ }
    }

    broadcast(obj, exclude) {
        const data = JSON.stringify(obj);
        for (const [clientWs] of this.peers) {
            if (clientWs !== exclude) {
                try { clientWs.send(data); } catch { /* closed */ }
            }
        }
    }

    broadcastToRoom(room_id, obj, exclude) {
        const room = this.rooms.get(room_id);
        if (!room) return;
        const data = JSON.stringify(obj);
        for (const [clientWs, info] of this.peers) {
            if (clientWs !== exclude && room.members.has(info.peer_id)) {
                try { clientWs.send(data); } catch { /* closed */ }
            }
        }
    }

    broadcastPeerUpdate() {
        this.broadcast({ type: "peers", peers: this.peerList(), rooms: this.roomList() });
    }

    peerList() {
        return [...this.peers.values()].map((p) => ({
            peer_id: p.peer_id,
            nick: p.nick,
        }));
    }

    roomList() {
        return [...this.rooms.entries()].map(([id, r]) => ({
            room_id: id,
            name: r.name,
            members: r.members.size,
        }));
    }

    leaveRoom(peerInfo, room_id, silent = false) {
        const room = this.rooms.get(room_id);
        if (!room) return;
        room.members.delete(peerInfo.peer_id);
        peerInfo.rooms.delete(room_id);

        if (room.members.size === 0) {
            this.rooms.delete(room_id);
        } else if (!silent) {
            this.broadcastToRoom(room_id, {
                type: "room_peer_left",
                room_id,
                peer_id: peerInfo.peer_id,
                nick: peerInfo.nick,
            });
        }
    }
}

function corsHeaders() {
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Upgrade, Connection, Sec-WebSocket-Key, Sec-WebSocket-Version",
    };
}
