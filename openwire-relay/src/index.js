/* ═══════════════════════════════════════════════════════════
   OpenWire Relay — Cloudflare Worker + Durable Object
   WebSocket relay for auto peer discovery & message relay
   + Admin: IP-level persistent banning, kick, host_left
   + Rate limiting, connection limits, message size limits
   ═══════════════════════════════════════════════════════════ */

// Admin secret: use Cloudflare Worker env binding (env.ADMIN_SECRET) in production
const FALLBACK_ADMIN_SECRET = 'openwire-admin-2024';

export default {
    async fetch(request, env) {
        const id = env.RELAY.idFromName("global");
        const relay = env.RELAY.get(id);
        // Pass env to DO so it can access ADMIN_SECRET
        return relay.fetch(request, { env });
    },
};

export class RelayRoom {
    constructor(state, env) {
        this.state = state;
        this.env = env;
        // ws → { peer_id, nick, ip, rooms: Set<string>, balance: 0 }
        this.peers = new Map();
        // room_id → { name, members: Set<string>, hostPeerId: string, memberWs: Set<WebSocket>, lastStateSnapshot: null }
        this.rooms = new Map();
        this.bannedIps = null; // loaded lazily from KV
        this.bannedIpSet = null; // Set mirror for O(1) lookups
        this.ipConnectionCount = new Map(); // ip → count for O(1) connection limiting
    }

    // Admin secret accessor — prefers env binding, falls back to constant
    getAdminSecret() {
        return this.env?.ADMIN_SECRET || FALLBACK_ADMIN_SECRET;
    }

    // Constant-time string comparison to prevent timing attacks
    timingSafeEqual(a, b) {
        if (typeof a !== 'string' || typeof b !== 'string') return false;
        if (a.length !== b.length) return false;
        let result = 0;
        for (let i = 0; i < a.length; i++) {
            result |= a.charCodeAt(i) ^ b.charCodeAt(i);
        }
        return result === 0;
    }

    // Load banned IPs from persistent Durable Object storage
    async loadBannedIps() {
        if (this.bannedIps === null) {
            const stored = await this.state.storage.get('banned_ips');
            this.bannedIps = stored ? JSON.parse(stored) : [];
            this.bannedIpSet = new Set(this.bannedIps);
        }
        return this.bannedIps;
    }

    async saveBannedIps() {
        await this.state.storage.put('banned_ips', JSON.stringify(this.bannedIps));
        this.bannedIpSet = new Set(this.bannedIps);
    }

    async fetch(request) {
        const url = new URL(request.url);

        if (url.pathname === "/health") {
            return new Response(
                JSON.stringify({ status: "ok", peers: this.peers.size }),
                { headers: { "content-type": "application/json" } }
            );
        }

        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders() });
        }

        const upgradeHeader = request.headers.get("Upgrade");
        if (!upgradeHeader || upgradeHeader !== "websocket") {
            return new Response("Expected WebSocket", { status: 426, headers: corsHeaders() });
        }

        // Check IP ban BEFORE accepting connection
        const clientIp = request.headers.get('CF-Connecting-IP') ?? 'unknown';
        const banned = await this.loadBannedIps();
        if (this.bannedIpSet ? this.bannedIpSet.has(clientIp) : banned.includes(clientIp)) {
            const pair = new WebSocketPair();
            const [client, server] = Object.values(pair);
            server.accept();
            server.send(JSON.stringify({ type: 'banned', message: 'You are banned from this server.' }));
            server.close(1008, 'Banned');
            return new Response(null, { status: 101, webSocket: client, headers: corsHeaders() });
        }

        // Per-IP connection limit (max 5) — Sybil resistance (O(1) lookup)
        const connectionsFromIp = this.ipConnectionCount.get(clientIp) || 0;
        if (connectionsFromIp >= 5) {
            const pair = new WebSocketPair();
            const [client, server] = Object.values(pair);
            server.accept();
            server.send(JSON.stringify({ type: 'error', message: 'Too many connections from this IP.' }));
            server.close(1008, 'Connection limit');
            return new Response(null, { status: 101, webSocket: client, headers: corsHeaders() });
        }

        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        this.handleSession(server, clientIp);

        return new Response(null, {
            status: 101,
            webSocket: client,
            headers: corsHeaders(),
        });
    }

    handleSession(ws, clientIp) {
        ws.accept();
        let peerInfo = null;

        ws.addEventListener("message", async (event) => {
            // Message size limit: 50KB max
            if (typeof event.data === 'string' && event.data.length > 51200) return;

            let msg;
            try { msg = JSON.parse(event.data); } catch { return; }

            // Rate limiting (skip for join since peerInfo is null at that point)
            if (peerInfo) {
                const now = Date.now();
                if (!peerInfo._rateTokens) { peerInfo._rateTokens = 30; peerInfo._rateLastRefill = now; }
                const elapsed = now - peerInfo._rateLastRefill;
                if (elapsed >= 1000) {
                    peerInfo._rateTokens = Math.min(40, peerInfo._rateTokens + 30 * (elapsed / 1000)); // 30/s refill, 40 burst cap
                    peerInfo._rateLastRefill = now;
                }
                if (peerInfo._rateTokens <= 0) {
                    this.send(ws, { type: 'rate_limited' });
                    return; // drop message
                }
                peerInfo._rateTokens--;
            }

            switch (msg.type) {
                case "join": {
                    const peer_id = crypto.randomUUID().slice(0, 16); // ALWAYS server-generated
                    let nick = (msg.nick || "Anonymous").slice(0, 24);
                    const takenNicks = new Set([...this.peers.values()].map(p => p.nick));
                    let base = nick, counter = 2;
                    while (takenNicks.has(nick)) nick = `${base}${counter++}`;

                    // Admin auth: constant-time comparison prevents timing attacks
                    const is_admin = typeof msg.admin_secret === 'string' && this.timingSafeEqual(msg.admin_secret, this.getAdminSecret());
                    // Bridge peers are CLI nodes relaying between gossipsub and the web
                    const is_bridge = msg.is_bridge === true;

                    peerInfo = { peer_id, nick, ip: clientIp, rooms: new Set(), balance: 0, is_admin, is_bridge };
                    this.peers.set(ws, peerInfo);
                    // Track IP connection count
                    this.ipConnectionCount.set(clientIp, (this.ipConnectionCount.get(clientIp) || 0) + 1);

                    this.send(ws, {
                        type: "welcome",
                        peer_id,
                        nick,
                        peers: this.peerList(),
                        rooms: this.roomList(),
                    });

                    this.broadcast({ type: "peer_joined", peer_id, nick, is_admin: peerInfo.is_admin, is_bridge: peerInfo.is_bridge, ip: clientIp }, ws);
                    break;
                }

                case "message": {
                    if (!peerInfo) return;
                    this.broadcast({
                        type: "message",
                        peer_id: peerInfo.peer_id,
                        nick: peerInfo.nick,
                        data: msg.data,
                    }, ws);
                    break;
                }

                case "balance_update": {
                    if (!peerInfo) return;
                    if (typeof msg.balance !== 'number' || !isFinite(msg.balance) || msg.balance < 0) return;
                    peerInfo.balance = msg.balance;
                    // Broadcast lightweight diff instead of full peerList (O(N) not O(N²))
                    this.broadcast({ type: "peer_balance_update", peer_id: peerInfo.peer_id, balance: peerInfo.balance });
                    break;
                }

                case "room_create": {
                    if (!peerInfo) return;
                    const room_id = "room-" + crypto.randomUUID().slice(0, 16);
                    const name = (msg.name || "Untitled").slice(0, 50);
                    this.rooms.set(room_id, {
                        name,
                        members: new Set([peerInfo.peer_id]),
                        hostPeerId: peerInfo.peer_id,
                        memberWs: new Set([ws]),
                        lastStateSnapshot: null,
                    });
                    peerInfo.rooms.add(room_id);
                    this.send(ws, { type: "room_created", room_id, name });
                    this.broadcastPeerUpdate();
                    break;
                }

                case "room_join": {
                    if (!peerInfo) return;
                    const room = this.rooms.get(msg.room_id);
                    if (!room) { this.send(ws, { type: "error", message: "Room not found", room_id: msg.room_id }); return; }
                    // Cancel pending deletion if someone rejoins
                    if (room._deleteTimer) { clearTimeout(room._deleteTimer); room._deleteTimer = null; }
                    room.members.add(peerInfo.peer_id);
                    room.memberWs.add(ws);
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
                    // Verify sender is a member of the target room
                    const msgRoom = this.rooms.get(msg.room_id);
                    if (!msgRoom || !msgRoom.members.has(peerInfo.peer_id)) return;
                    this.broadcastToRoom(msg.room_id, {
                        type: "room_message",
                        room_id: msg.room_id,
                        from: peerInfo.peer_id,
                        nick: peerInfo.nick,
                        data: msg.data,
                    }, ws);
                    break;
                }

                case "room_leave": {
                    if (!peerInfo) return;
                    this.leaveRoom(peerInfo, msg.room_id, false, ws);
                    break;
                }

                case "room_list": {
                    this.send(ws, { type: "room_list", rooms: this.roomList() });
                    break;
                }

                case "room_state_snapshot": {
                    if (!peerInfo) return;
                    const snapRoom = this.rooms.get(msg.room_id);
                    if (!snapRoom) return;
                    // Only the host can update the snapshot
                    if (snapRoom.hostPeerId !== peerInfo.peer_id) return;
                    // Size limit: max 100KB for snapshots
                    if (typeof msg.state !== 'string' || msg.state.length > 102400) return;
                    snapRoom.lastStateSnapshot = msg.state; // Store latest game state
                    break;
                }

                // ── ADMIN MESSAGES ─────────────────────────────────────

                case "admin_kick": {
                    if (!peerInfo || !peerInfo.is_admin) return;
                    const targetId = msg.peer_id;
                    for (const [clientWs, info] of this.peers) {
                        if (info.peer_id === targetId) {
                            this.send(clientWs, { type: 'kicked', message: 'You were kicked by an admin.' });
                            // Clean up room membership before removing peer
                            for (const rid of info.rooms) {
                                this.leaveRoom(info, rid, true, clientWs);
                            }
                            // Decrement IP count
                            const cnt = this.ipConnectionCount.get(info.ip) || 1;
                            if (cnt <= 1) this.ipConnectionCount.delete(info.ip);
                            else this.ipConnectionCount.set(info.ip, cnt - 1);
                            try { clientWs.close(1008, 'Kicked'); } catch { }
                            this.peers.delete(clientWs);
                            break;
                        }
                    }
                    this.broadcast({ type: 'peers', peers: this.peerList() });
                    break;
                }

                case "admin_ban_ip": {
                    if (!peerInfo || !peerInfo.is_admin) return;
                    const targetId = msg.peer_id;
                    let targetIp = null;

                    for (const [clientWs, info] of this.peers) {
                        if (info.peer_id === targetId) {
                            targetIp = info.ip;
                            this.send(clientWs, { type: 'banned', message: 'You have been banned.' });
                            // Clean up room membership before removing peer
                            for (const rid of info.rooms) {
                                this.leaveRoom(info, rid, true, clientWs);
                            }
                            const cnt = this.ipConnectionCount.get(info.ip) || 1;
                            if (cnt <= 1) this.ipConnectionCount.delete(info.ip);
                            else this.ipConnectionCount.set(info.ip, cnt - 1);
                            try { clientWs.close(1008, 'Banned'); } catch { }
                            this.peers.delete(clientWs);
                            break;
                        }
                    }

                    if (targetIp && targetIp !== 'unknown' && !this.bannedIps.includes(targetIp)) {
                        this.bannedIps.push(targetIp);
                        await this.saveBannedIps();
                    }

                    // Send updated ban list back to the admin
                    this.send(ws, { type: 'banned_ips', ips: this.bannedIps });
                    this.broadcast({ type: 'peers', peers: this.peerList() });
                    break;
                }

                case "admin_unban_ip": {
                    if (!peerInfo || !peerInfo.is_admin) return;
                    this.bannedIps = (this.bannedIps || []).filter(ip => ip !== msg.ip);
                    await this.saveBannedIps();
                    this.send(ws, { type: 'banned_ips', ips: this.bannedIps });
                    break;
                }

                case "admin_adjust_balance": {
                    if (!peerInfo || !peerInfo.is_admin) return;
                    if (typeof msg.delta !== 'number' || !isFinite(msg.delta)) return;
                    // Relay the adjustment to the target peer
                    for (const [clientWs, info] of this.peers) {
                        if (info.peer_id === msg.peer_id) {
                            this.send(clientWs, {
                                type: 'admin_adjust_balance',
                                delta: msg.delta,
                                reason: msg.reason || 'Admin adjustment',
                                from_nick: peerInfo.nick,
                            });
                            break;
                        }
                    }
                    break;
                }

                case "admin_get_bans": {
                    if (!peerInfo || !peerInfo.is_admin) return;
                    await this.loadBannedIps();
                    this.send(ws, { type: 'banned_ips', ips: this.bannedIps });
                    break;
                }
            }
        });

        ws.addEventListener("close", () => {
            if (!peerInfo) return;
            // Notify rooms about host leaving (for P2P host migration)
            for (const room_id of peerInfo.rooms) {
                const room = this.rooms.get(room_id);
                if (room && room.hostPeerId === peerInfo.peer_id) {
                    // Find next member to become host (smallest peer_id alphabetically)
                    const members = [...room.members].filter(id => id !== peerInfo.peer_id);
                    if (members.length > 0) {
                        members.sort();
                        const newHostId = members[0];
                        room.hostPeerId = newHostId;
                        this.broadcastToRoom(room_id, {
                            type: 'host_left',
                            old_host: peerInfo.peer_id,
                            new_host: newHostId,
                            room_id,
                            gameSnapshots: room.lastStateSnapshot || null,
                        });
                    }
                }
                this.leaveRoom(peerInfo, room_id, true, ws);
            }
            // Decrement IP connection count
            const ipCnt = this.ipConnectionCount.get(peerInfo.ip) || 1;
            if (ipCnt <= 1) this.ipConnectionCount.delete(peerInfo.ip);
            else this.ipConnectionCount.set(peerInfo.ip, ipCnt - 1);
            this.peers.delete(ws);
            this.broadcast({ type: "peer_left", peer_id: peerInfo.peer_id, nick: peerInfo.nick });
        });

        // Error handler: run same cleanup as close
        ws.addEventListener("error", () => {
            if (!peerInfo) { this.peers.delete(ws); return; }
            for (const room_id of peerInfo.rooms) {
                this.leaveRoom(peerInfo, room_id, true, ws);
            }
            const ipCnt = this.ipConnectionCount.get(peerInfo.ip) || 1;
            if (ipCnt <= 1) this.ipConnectionCount.delete(peerInfo.ip);
            else this.ipConnectionCount.set(peerInfo.ip, ipCnt - 1);
            this.peers.delete(ws);
            this.broadcast({ type: "peer_left", peer_id: peerInfo.peer_id, nick: peerInfo.nick });
        });
    }

    // ── Helpers ──────────────────────────────────────────────

    send(ws, obj) {
        try { ws.send(JSON.stringify(obj)); } catch { }
    }

    broadcast(obj, exclude) {
        const data = JSON.stringify(obj);
        for (const [clientWs] of this.peers) {
            if (clientWs !== exclude) {
                try { clientWs.send(data); } catch { }
            }
        }
    }

    broadcastToRoom(room_id, obj, exclude) {
        const room = this.rooms.get(room_id);
        if (!room || !room.memberWs) return;
        const data = JSON.stringify(obj);
        for (const clientWs of room.memberWs) {
            if (clientWs !== exclude) {
                try { clientWs.send(data); } catch { }
            }
        }
    }

    broadcastPeerUpdate() {
        this.broadcast({ type: "peers", peers: this.peerList() });
    }

    peerList() {
        return [...this.peers.values()].map(p => ({
            peer_id: p.peer_id,
            nick: p.nick,
            balance: p.balance || 0,
            is_admin: p.is_admin || false,
            is_bridge: p.is_bridge || false,
            ip: p.ip || null,
        }));
    }

    roomList() {
        return [...this.rooms.entries()].map(([id, r]) => ({
            room_id: id,
            name: r.name,
            members: r.members.size,
            hostPeerId: r.hostPeerId,
        }));
    }

    leaveRoom(peerInfo, room_id, silent = false, ws = null) {
        const room = this.rooms.get(room_id);
        if (!room) return;
        room.members.delete(peerInfo.peer_id);
        if (ws && room.memberWs) room.memberWs.delete(ws);
        peerInfo.rooms.delete(room_id);

        if (room.members.size === 0) {
            room.lastStateSnapshot = null; // Free snapshot memory
            // Keep empty rooms alive for 60s so refreshing users can rejoin
            if (!room._deleteTimer) {
                room._deleteTimer = setTimeout(() => {
                    const r = this.rooms.get(room_id);
                    if (r && r.members.size === 0) this.rooms.delete(room_id);
                }, 60000);
            }
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
