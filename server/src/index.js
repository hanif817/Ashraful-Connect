import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import cors from 'cors';
import helmet from 'helmet';
import { Server } from 'socket.io';

const PORT = Number(process.env.PORT || 8000);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const app = express();
app.use(helmet({ crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: CLIENT_ORIGIN, methods: ['GET','POST'] }));
app.use(express.json({ limit: '20kb' }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN, methods: ['GET','POST'] },
  maxHttpBufferSize: 1e5,
  pingInterval: 25000,
  pingTimeout: 20000
});

let waiting = { video: [], text: [] };
let online = 0;
const pairs = new Map(); // socketId -> { peerId, roomId, mode }
const reports = [];
const iceServers = (() => {
  try { return JSON.parse(process.env.ICE_SERVERS || '[]'); }
  catch { return []; }
})();

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'StrangerConnect', online }));
app.get('/api/config', (_req, res) => res.json({
  iceServers: iceServers.length ? iceServers : [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
}));

function cleanInterests(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(v => String(v).trim().toLowerCase()).filter(Boolean))].slice(0, 10);
}
function removeFromQueue(id) {
  for (const mode of ['video','text']) waiting[mode] = waiting[mode].filter(x => x.id !== id);
}
function endPair(id, notify = true) {
  const p = pairs.get(id);
  if (!p) return;
  pairs.delete(id);
  pairs.delete(p.peerId);
  if (notify) io.to(p.peerId).emit('partner-left');
  io.to(p.roomId).socketsLeave(p.roomId);
}
function findMatch(socket, mode, interests) {
  const queue = waiting[mode];
  const idx = queue.findIndex(candidate =>
    candidate.id !== socket.id &&
    !socket.data.blocked?.has(candidate.id) &&
    !candidate.blocked?.has(socket.id) &&
    (!interests.length || !candidate.interests.length ||
      interests.some(tag => candidate.interests.includes(tag)))
  );
  if (idx < 0) return null;
  return queue.splice(idx, 1)[0];
}
function pairUsers(a, b, mode) {
  const roomId = `room-${a.id}-${b.id}`;
  a.join(roomId); b.join(roomId);
  pairs.set(a.id, { peerId: b.id, roomId, mode });
  pairs.set(b.id, { peerId: a.id, roomId, mode });
  a.emit('matched', { peerId: b.id, mode, initiator: true });
  b.emit('matched', { peerId: a.id, mode, initiator: false });
}

io.on('connection', socket => {
  online++; io.emit('online-count', online);
  socket.data.blocked = new Set();
  socket.data.lastMessageAt = 0;

  socket.on('join-queue', ({ mode, interests } = {}) => {
    if (!['video','text'].includes(mode)) return socket.emit('app-error', 'Invalid chat mode.');
    endPair(socket.id);
    removeFromQueue(socket.id);
    socket.data.mode = mode;
    socket.data.interests = cleanInterests(interests);
    const match = findMatch(socket, mode, socket.data.interests);
    if (match) pairUsers(socket, match.socket, mode);
    else {
      waiting[mode].push({ id: socket.id, socket, interests: socket.data.interests, blocked: socket.data.blocked });
      socket.emit('searching');
    }
  });

  socket.on('next', () => {
    endPair(socket.id);
    removeFromQueue(socket.id);
    if (socket.data.mode) socket.emit('partner-left');
    if (socket.data.mode) {
      const mode = socket.data.mode;
      const interests = socket.data.interests || [];
      const match = findMatch(socket, mode, interests);
      if (match) pairUsers(socket, match.socket, mode);
      else {
        waiting[mode].push({ id: socket.id, socket, interests, blocked: socket.data.blocked });
        socket.emit('searching');
      }
    }
  });

  socket.on('leave', () => {
    endPair(socket.id);
    removeFromQueue(socket.id);
    socket.data.mode = null;
  });

  socket.on('chat-message', ({ text } = {}) => {
    const p = pairs.get(socket.id);
    const now = Date.now();
    if (!p || typeof text !== 'string' || !text.trim() || text.length > 1000) return;
    if (now - socket.data.lastMessageAt < 250) return;
    socket.data.lastMessageAt = now;
    io.to(p.peerId).emit('chat-message', { text: text.trim().slice(0,1000), at: now });
  });

  socket.on('webrtc', payload => {
    const p = pairs.get(socket.id);
    if (!p || !payload || !['offer','answer','ice'].includes(payload.type)) return;
    io.to(p.peerId).emit('webrtc', payload);
  });

  socket.on('block-partner', () => {
    const p = pairs.get(socket.id);
    if (!p) return;
    socket.data.blocked.add(p.peerId);
    endPair(socket.id);
    socket.emit('partner-left');
  });

  socket.on('report-partner', ({ reason } = {}) => {
    const p = pairs.get(socket.id);
    if (!p) return;
    reports.push({ reporter: socket.id, reported: p.peerId, reason: String(reason || 'unspecified').slice(0,120), at: new Date().toISOString() });
    console.warn('[MODERATION REPORT]', reports.at(-1));
    endPair(socket.id);
    socket.emit('partner-left');
  });

  socket.on('disconnect', () => {
    removeFromQueue(socket.id);
    endPair(socket.id);
    online = Math.max(0, online - 1);
    io.emit('online-count', online);
  });
});

server.listen(PORT, () => console.log(`StrangerConnect server listening on http://localhost:${PORT}`));
