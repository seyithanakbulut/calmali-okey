// Çalmalı 101 Okey - sunucu (Express + Socket.IO)
// Oda listesi, oda kodu ile katılma, sohbet, oda ayarları
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');
const { Okey101, CONFIG } = require('./game');

const PORT = process.env.PORT || 3000;
const NEXT_HAND_DELAY_MS = 10000;      // el arası: sonuç ekranı + geçiş reklamı + ödüllü reklam
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;
const CHAT_MAX = 200;                   // mesaj uzunluğu
const CHAT_HISTORY = 60;                // odada saklanan son mesaj sayısı
const CHAT_GAP_MS = 700;                // flood koruması
const HAND_OPTIONS = [1, 3, 5, 7, 9, 11];

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/config', (req, res) => res.json({ ...CONFIG, HAND_OPTIONS }));
app.get('/health', (req, res) => res.send('ok'));
const server = http.createServer(app);
const io = new Server(server);

const rooms = new Map();

function makeCode() {
  let c;
  do c = String(crypto.randomInt(100000, 1000000)); while (rooms.has(c));
  return c;
}

function cleanName(n) {
  return String(n || '').replace(/[<>]/g, '').trim().slice(0, 16);
}

function parseOpts(o = {}) {
  const hands = HAND_OPTIONS.includes(Number(o.hands)) ? Number(o.hands) : CONFIG.TOTAL_HANDS;
  return {
    esli: !!o.esli,
    katlamali: !!o.katlamali,
    steal: o.steal !== false,          // varsayılan: çalmalı
    hands,
    isPublic: o.isPublic !== false,    // varsayılan: herkese açık
  };
}

function roomInfo(room) {
  return {
    code: room.code,
    hostSeat: room.hostSeat,
    started: !!room.game,
    opts: room.opts,
    players: room.players.map((p) => ({ name: p.name, seat: p.seat, online: !!p.socketId })),
  };
}

// Lobide görünen açık odalar: herkese açık, başlamamış, yeri olan
function publicRooms() {
  const list = [];
  for (const r of rooms.values()) {
    if (!r.opts.isPublic || r.game) continue;
    const online = r.players.filter((p) => p.socketId).length;
    if (!online || r.players.length >= 4) continue;
    list.push({
      code: r.code,
      host: r.players[r.hostSeat] ? r.players[r.hostSeat].name : '?',
      count: r.players.length,
      opts: r.opts,
      created: r.created,
    });
  }
  return list.sort((a, b) => b.created - a.created).slice(0, 50);
}

let roomsTimer = null;
function broadcastRooms() {
  if (roomsTimer) return;
  roomsTimer = setTimeout(() => { roomsTimer = null; io.to('lobby').emit('rooms', publicRooms()); }, 150);
}

function broadcast(room) {
  for (const p of room.players) {
    if (!p.socketId) continue;
    io.to(p.socketId).emit('state', {
      you: p.seat,
      room: roomInfo(room),
      game: room.game ? room.game.viewFor(p.seat) : null,
    });
  }
}

function sendEvents(room, events = []) {
  for (const ev of events) {
    for (const p of room.players) {
      if (!p.socketId) continue;
      if (ev.to === 'others' && p.seat === ev.except) continue;
      io.to(p.socketId).emit('event', { name: ev.name, data: ev.data });
    }
  }
}

function pushChat(room, msg) {
  room.chat.push(msg);
  if (room.chat.length > CHAT_HISTORY) room.chat.shift();
  for (const p of room.players) if (p.socketId) io.to(p.socketId).emit('chat', msg);
}

function systemChat(room, text) {
  pushChat(room, { sys: true, text, t: Date.now() });
}

function scheduleNextHand(room) {
  if (room.timer) return;
  room.timer = setTimeout(() => {
    room.timer = null;
    if (!room.game) return;
    const r = room.game.startHand();
    sendEvents(room, r.events);
    broadcast(room);
  }, NEXT_HAND_DELAY_MS);
}

function maybeCleanup(room) {
  if (room.players.some((p) => p.socketId)) return;
  setTimeout(() => {
    if (!room.players.some((p) => p.socketId)) {
      clearTimeout(room.timer);
      rooms.delete(room.code);
      broadcastRooms();
    }
  }, EMPTY_ROOM_TTL_MS);
}

io.on('connection', (socket) => {
  let room = null;
  let me = null;
  let lastChat = 0;

  socket.join('lobby');
  socket.emit('rooms', publicRooms());

  function enterRoom(r, player) {
    room = r; me = player;
    socket.leave('lobby');
    socket.emit('chatHistory', room.chat);
    broadcast(room);
    broadcastRooms();
  }

  socket.on('listRooms', (cb = () => {}) => cb(publicRooms()));

  socket.on('create', ({ name, ...o } = {}, cb = () => {}) => {
    if (room) return cb({ error: 'Zaten bir odadasın' });
    name = cleanName(name);
    if (!name) return cb({ error: 'İsim gir' });
    const code = makeCode();
    const r = { code, players: [], hostSeat: 0, game: null, timer: null, opts: parseOpts(o), chat: [], created: Date.now() };
    const p = { name, seat: 0, socketId: socket.id };
    r.players.push(p);
    rooms.set(code, r);
    cb({ ok: true, code });
    enterRoom(r, p);
    systemChat(r, `${name} odayı kurdu`);
  });

  socket.on('join', ({ code, name } = {}, cb = () => {}) => {
    if (room) return cb({ error: 'Zaten bir odadasın' });
    name = cleanName(name);
    const r = rooms.get(String(code || '').trim());
    if (!r) return cb({ error: 'Oda bulunamadı' });
    if (!name) return cb({ error: 'İsim gir' });
    const existing = r.players.find((p) => p.name === name);
    if (existing) {
      if (existing.socketId) return cb({ error: 'Bu isim masada var, başka isim seç' });
      existing.socketId = socket.id; // yeniden bağlanma
      cb({ ok: true, code: r.code });
      enterRoom(r, existing);
      systemChat(r, `${name} geri döndü`);
      return;
    }
    if (r.game) return cb({ error: 'Oyun başladı' });
    if (r.players.length >= 4) return cb({ error: 'Masa dolu' });
    const p = { name, seat: r.players.length, socketId: socket.id };
    r.players.push(p);
    cb({ ok: true, code: r.code });
    enterRoom(r, p);
    systemChat(r, `${name} masaya oturdu`);
  });

  // Oyun başlamadan odadan çık
  socket.on('leave', (cb = () => {}) => {
    if (!room || !me) return cb({ ok: true });
    const r = room;
    if (r.game && !r.game.over) {
      me.socketId = null;
    } else {
      r.players = r.players.filter((p) => p !== me);
      r.players.forEach((p, i) => { p.seat = i; });
      if (r.game && r.game.over) r.game = null;
      if (!r.players.length) rooms.delete(r.code);
    }
    systemChat(r, `${me.name} masadan kalktı`);
    broadcast(r);
    maybeCleanup(r);
    room = null; me = null;
    socket.join('lobby');
    socket.emit('rooms', publicRooms());
    broadcastRooms();
    cb({ ok: true });
  });

  socket.on('chat', (text, cb = () => {}) => {
    if (!room || !me) return cb({ error: 'Odada değilsin' });
    const now = Date.now();
    if (now - lastChat < CHAT_GAP_MS) return cb({ error: 'Biraz yavaş yaz' });
    text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX);
    if (!text) return cb({ error: 'Boş mesaj' });
    lastChat = now;
    pushChat(room, { from: me.name, seat: me.seat, text, t: now });
    cb({ ok: true });
  });

  socket.on('start', (cb = () => {}) => {
    if (!room || !me) return cb({ error: 'Odada değilsin' });
    if (me.seat !== room.hostSeat) return cb({ error: 'Sadece oda sahibi başlatır' });
    if (room.game && !room.game.over) return cb({ error: 'Oyun zaten sürüyor' });
    if (room.players.length < 2) return cb({ error: 'En az 2 oyuncu lazım (normali 4)' });
    if (room.opts.esli && room.players.length !== 4) return cb({ error: 'Eşli oyun için 4 kişi lazım' });
    clearTimeout(room.timer); room.timer = null;
    room.game = new Okey101(room.players.length, room.opts);
    const r = room.game.startHand();
    sendEvents(room, r.events);
    broadcast(room);
    broadcastRooms();
    systemChat(room, 'Oyun başladı, bol şans!');
    cb({ ok: true });
  });

  // Perleri açmadan önce toplamı görmek için (hiçbir şey değiştirmez)
  socket.on('check', ({ sets, down } = {}, cb = () => {}) => {
    if (!room || !me || !room.game || !room.game.handActive) return cb({ error: 'Oyun yok' });
    const c = room.game.checkSets(me.seat, sets, down);
    if (!c.ok) return cb({ error: c.error });
    cb({ ok: true, total: c.total, kind: c.kind, values: c.result.map((r) => r.value) });
  });

  socket.on('action', (a = {}, cb = () => {}) => {
    if (!room || !me || !room.game) return cb({ error: 'Oyun yok' });
    const g = room.game;
    const s = me.seat;
    let r;
    switch (a.type) {
      case 'draw': r = g.draw(s); break;
      case 'take': r = g.take(s); break;
      case 'cifte': r = g.declareCifte(s); break;
      case 'untake': r = g.untake(s); break;
      case 'dump': r = g.dump(s, a.tileId); break;
      case 'open': r = g.open(s, a.sets, a.down); break;
      case 'attach': r = g.attach(s, a.tileId, a.setId, a.down); break;
      case 'challengeDown': r = g.challengeDown(s, a.setId, a.tileId); break;
      case 'swapJoker': r = g.swapJoker(s, a.tileId, a.setId); break;
      case 'discard': r = g.discard(s, a.tileId); break;
      case 'steal': r = g.steal(s, a); break;
      case 'accuse': r = g.accuse(s, a.target); break;
      case 'refund': r = g.refund(s); break;
      default: return cb({ error: 'Bilinmeyen hamle' });
    }
    if (!r.ok) return cb({ error: r.error });
    sendEvents(room, r.events);
    broadcast(room);
    if (r.events.some((e) => e.name === 'handEnded')) scheduleNextHand(room);
    cb({ ok: true });
  });

  socket.on('disconnect', () => {
    if (!me || !room) return;
    me.socketId = null;
    broadcast(room);
    broadcastRooms();
    maybeCleanup(room);
  });
});

server.listen(PORT, () => console.log(`Çalmalı 101: http://localhost:${PORT}`));
