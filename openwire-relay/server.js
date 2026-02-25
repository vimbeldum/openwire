const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 8080;

// ─── State ──────────────────────────────────────────────────────────
const peers = new Map();   // ws → { peer_id, nick, rooms: Set }
const rooms = new Map();   // room_id → { name, members: Set<peer_id> }

// ─── Server ─────────────────────────────────────────────────────────
const wss = new WebSocketServer({ port: PORT });
console.log(`[relay] Listening on ws://localhost:${PORT}`);

wss.on("connection", (ws) => {
  let peerInfo = null;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      // ── Join the network ──────────────────────────────────────────
      case "join": {
        const peer_id = msg.peer_id || crypto.randomUUID();
        const nick = msg.nick || "Anonymous";
        peerInfo = { peer_id, nick, rooms: new Set() };
        peers.set(ws, peerInfo);

        // Tell the new peer their ID + current peer list
        send(ws, {
          type: "welcome",
          peer_id,
          peers: peerList(),
          rooms: roomList(),
        });

        // Broadcast to everyone else
        broadcast(
          { type: "peer_joined", peer_id, nick },
          ws
        );

        console.log(`[+] ${nick} (${peer_id.slice(0, 8)}…) joined — ${peers.size} online`);
        break;
      }

      // ── Broadcast chat message ────────────────────────────────────
      case "message": {
        if (!peerInfo) return;
        broadcast(
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

      // ── Room: create ──────────────────────────────────────────────
      case "room_create": {
        if (!peerInfo) return;
        const room_id = `room-${crypto.randomUUID().slice(0, 16)}`;
        const name = msg.name || "Unnamed Room";
        rooms.set(room_id, { name, members: new Set([peerInfo.peer_id]) });
        peerInfo.rooms.add(room_id);

        send(ws, { type: "room_created", room_id, name });
        broadcastPeerUpdate();
        console.log(`[room] ${peerInfo.nick} created "${name}" (${room_id})`);
        break;
      }

      // ── Room: join ────────────────────────────────────────────────
      case "room_join": {
        if (!peerInfo) return;
        const room = rooms.get(msg.room_id);
        if (!room) {
          send(ws, { type: "error", message: `Room ${msg.room_id} not found` });
          return;
        }
        room.members.add(peerInfo.peer_id);
        peerInfo.rooms.add(msg.room_id);

        // Notify room members
        broadcastToRoom(msg.room_id, {
          type: "room_peer_joined",
          room_id: msg.room_id,
          peer_id: peerInfo.peer_id,
          nick: peerInfo.nick,
        });
        send(ws, { type: "room_joined", room_id: msg.room_id, name: room.name });
        console.log(`[room] ${peerInfo.nick} joined "${room.name}"`);
        break;
      }

      // ── Room: invite ──────────────────────────────────────────────
      case "room_invite": {
        if (!peerInfo) return;
        const invRoom = rooms.get(msg.room_id);
        if (!invRoom) return;

        // Find target peer's WebSocket
        for (const [clientWs, info] of peers) {
          if (info.peer_id === msg.peer_id) {
            send(clientWs, {
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

      // ── Room: message (E2E encrypted payload) ─────────────────────
      case "room_message": {
        if (!peerInfo) return;
        broadcastToRoom(
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

      // ── Room: leave ───────────────────────────────────────────────
      case "room_leave": {
        if (!peerInfo) return;
        leaveRoom(peerInfo, msg.room_id);
        break;
      }

      // ── Room: list ────────────────────────────────────────────────
      case "room_list": {
        send(ws, { type: "room_list", rooms: roomList() });
        break;
      }
    }
  });

  ws.on("close", () => {
    if (!peerInfo) return;
    // Leave all rooms
    for (const room_id of peerInfo.rooms) {
      leaveRoom(peerInfo, room_id, true);
    }
    peers.delete(ws);
    broadcast({ type: "peer_left", peer_id: peerInfo.peer_id, nick: peerInfo.nick });
    console.log(`[-] ${peerInfo.nick} (${peerInfo.peer_id.slice(0, 8)}…) left — ${peers.size} online`);
  });

  ws.on("error", () => {});
});

// ─── Helpers ────────────────────────────────────────────────────────

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function broadcast(obj, exclude) {
  const data = JSON.stringify(obj);
  for (const [clientWs] of peers) {
    if (clientWs !== exclude && clientWs.readyState === clientWs.OPEN) {
      clientWs.send(data);
    }
  }
}

function broadcastToRoom(room_id, obj, exclude) {
  const room = rooms.get(room_id);
  if (!room) return;
  const data = JSON.stringify(obj);
  for (const [clientWs, info] of peers) {
    if (
      clientWs !== exclude &&
      room.members.has(info.peer_id) &&
      clientWs.readyState === clientWs.OPEN
    ) {
      clientWs.send(data);
    }
  }
}

function broadcastPeerUpdate() {
  broadcast({ type: "peers", peers: peerList(), rooms: roomList() });
}

function peerList() {
  return [...peers.values()].map((p) => ({
    peer_id: p.peer_id,
    nick: p.nick,
  }));
}

function roomList() {
  return [...rooms.entries()].map(([id, r]) => ({
    room_id: id,
    name: r.name,
    members: r.members.size,
  }));
}

function leaveRoom(peerInfo, room_id, silent = false) {
  const room = rooms.get(room_id);
  if (!room) return;
  room.members.delete(peerInfo.peer_id);
  peerInfo.rooms.delete(room_id);

  if (room.members.size === 0) {
    rooms.delete(room_id);
    console.log(`[room] "${room.name}" deleted (empty)`);
  } else if (!silent) {
    broadcastToRoom(room_id, {
      type: "room_peer_left",
      room_id,
      peer_id: peerInfo.peer_id,
      nick: peerInfo.nick,
    });
  }
}
