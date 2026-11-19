'use strict';
const http = require('http');
const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = Number(process.env.PORT || 8080);
const MAX_PLAYERS = 50;
// کد ثابت اتاق خصوصی؛ ورود به حروف بزرگ/کوچک حساس نیست.
const PRIVATE_ROOM_CODE = 'LASTHAVENSERVER';
const DISPLAY_ROOM_CODE = 'Lasthavenserver';
const rooms = new Map();

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}
function snapshot(room) {
  return [...room.players.values()].map(p => ({ id: p.id, name: p.name, x: p.x, z: p.z, ry: p.ry }));
}
function broadcast(room, data, except) {
  for (const p of room.players.values()) if (p.ws !== except) send(p.ws, data);
}
function removePlayer(ws) {
  const room = ws.room;
  if (!room || !ws.playerId) return;
  const id = ws.playerId;
  room.players.delete(id);
  ws.room = null;
  ws.playerId = null;
  // اتاق و کد ثابت حتی با خروج آخرین نفر حفظ می‌شود.
  broadcast(room, { type: 'left', id, count: room.players.size });
  broadcast(room, { type: 'players', count: room.players.size, players: snapshot(room) });
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true, service: 'LAST HAVEN private multiplayer', maxPlayers: MAX_PLAYERS, activeRooms: rooms.size, roomCode: DISPLAY_ROOM_CODE }));
  }
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('LAST HAVEN private multiplayer server is running.');
});

const wss = new WebSocket.Server({ server, maxPayload: 4096 });
wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); }
    catch { return send(ws, { type: 'error', message: 'پیام نامعتبر است' }); }

    if (msg.type === 'join') {
      if (ws.room) return send(ws, { type: 'error', message: 'این اتصال قبلاً وارد سرور شده است' });
      const accountId = String(msg.accountId || '').slice(0, 80);
      if (!/^[a-z0-9-]{24,80}$/i.test(accountId)) return send(ws, { type: 'error', message: 'شناسه بازیکن معتبر نیست؛ بازی را تازه‌سازی کن' });

      let room;
      if (msg.mode === 'create') {
        room = rooms.get(PRIVATE_ROOM_CODE);
        if (!room) {
          room = { code: DISPLAY_ROOM_CODE, ownerAccountId: accountId, players: new Map(), createdAt: Date.now() };
          rooms.set(PRIVATE_ROOM_CODE, room);
        } else if (room.ownerAccountId !== accountId) {
          return send(ws, { type: 'error', message: 'سرور از قبل ساخته شده است؛ کد Lasthavenserver را وارد کن و گزینه ورود را بزن' });
        }
      } else if (msg.mode === 'join') {
        const code = String(msg.room || '').trim().toUpperCase();
        if (code !== PRIVATE_ROOM_CODE) return send(ws, { type: 'error', message: 'کد سرور اشتباه است' });
        room = rooms.get(PRIVATE_ROOM_CODE);
        if (!room) return send(ws, { type: 'error', message: 'سرور هنوز توسط میزبان ساخته نشده است' });
      } else {
        return send(ws, { type: 'error', message: 'درخواست ورود نامعتبر است' });
      }

      if (room.players.size >= MAX_PLAYERS) return send(ws, { type: 'error', message: 'ظرفیت سرور تکمیل است؛ حداکثر ۵۰ نفر' });
      const id = crypto.randomUUID();
      const player = { id, accountId, name: String(msg.name || 'بازیکن').slice(0, 18), x: 0, z: 0, ry: 0, ws };
      room.players.set(id, player);
      ws.room = room;
      ws.playerId = id;
      send(ws, { type: 'welcome', id, room: room.code, count: room.players.size, players: snapshot(room) });
      broadcast(room, { type: 'joined', player: { id, name: player.name, x: 0, z: 0, ry: 0 } }, ws);
      broadcast(room, { type: 'players', count: room.players.size, players: snapshot(room) });
      return;
    }

    if (msg.type === 'move') {
      const room = ws.room;
      const p = room && room.players.get(ws.playerId);
      if (!p) return;
      const x = Number(msg.x), z = Number(msg.z), ry = Number(msg.ry);
      if (Number.isFinite(x)) p.x = Math.max(-250, Math.min(250, x));
      if (Number.isFinite(z)) p.z = Math.max(-250, Math.min(250, z));
      if (Number.isFinite(ry)) p.ry = Math.max(-Math.PI * 100, Math.min(Math.PI * 100, ry));
      p.name = String(msg.name || p.name).slice(0, 18);
      broadcast(room, { type: 'players', count: room.players.size, players: snapshot(room) });
    }
  });
  ws.on('close', () => removePlayer(ws));
  ws.on('error', () => removePlayer(ws));
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);
wss.on('close', () => clearInterval(heartbeat));
server.listen(PORT, '0.0.0.0', () => console.log(`LAST HAVEN private server listening on ${PORT}; max ${MAX_PLAYERS} players; room ${PRIVATE_ROOM_CODE}`));
