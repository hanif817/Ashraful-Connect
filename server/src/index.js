import 'dotenv/config';
import express from 'express';
import http from 'node:http';
import cors from 'cors';
import helmet from 'helmet';
import { Server } from 'socket.io';

const PORT = Number(process.env.PORT || 8000);
const rawOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);

function originAllowed(origin) {
  if (!origin) return true; // health checks and non-browser clients
  if (rawOrigins.includes('*')) return true;
  return rawOrigins.includes(origin);
}

const corsOptions = {
  origin(origin, callback) {
    if (originAllowed(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed by StrangerConnect CORS.'));
  },
  methods: ['GET', 'POST'],
  credentials: false
};

const app = express();
app.disable('x-powered-by');
app.use(helmet({ crossOriginEmbedderPolicy: false }));
app.use(cors(corsOptions));
app.use(express.json({ limit: '20kb' }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: corsOptions,
  maxHttpBufferSize: 1e5,
  pingInterval: 25000,
  pingTimeout: 20000
});

const waiting = { video: [], text: [] };
const pairs = new Map();
const reports = [];
let online = 0;

const iceServers = (() => {
  try {
    const parsed = JSON.parse(process.env.ICE_SERVERS || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    console.warn('ICE_SERVERS is invalid JSON; using public STUN fallback.');
    return [];
  }
})();

app.get('/', (_req, res) => {
  res.type('text/plain').send('StrangerConnect signalling server is running.');
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'StrangerConnect', online });
});

app.get('/api/config', (_req, res) => {
  res.json({
    iceServers: iceServers.length ? iceServers : [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  });
});

function cleanInterests(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map(item => String(item).trim().toLowerCase())
    .filter(Boolean))].slice(0, 10);
}

const BD_DIVISIONS = new Set([
  'barishal', 'chattogram', 'dhaka', 'khulna',
  'mymensingh', 'rajshahi', 'rangpur', 'sylhet'
]);

function cleanDivision(value) {
  const division = String(value || 'any').trim().toLowerCase();
  return division === 'any' || BD_DIVISIONS.has(division) ? division : 'any';
}

function removeFromQueue(id) {
  for (const mode of ['video', 'text']) {
    waiting[mode] = waiting[mode].filter(entry => entry.id !== id);
  }
}

function endPair(id, notify = true) {
  const pair = pairs.get(id);
  if (!pair) return;
  pairs.delete(id);
  pairs.delete(pair.peerId);
  if (notify) io.to(pair.peerId).emit('partner-left');
  io.to(pair.roomId).socketsLeave(pair.roomId);
}

function divisionCompatible(a, b) {
  return a.division === 'any' || b.division === 'any' || a.division === b.division;
}

function findMatch(socket, mode, interests) {
  const queue = waiting[mode];
  const idx = queue.findIndex(candidate =>
    candidate.id !== socket.id &&
    !socket.data.blocked.has(candidate.id) &&
    !candidate.blocked.has(socket.id) &&
    divisionCompatible(
      { division: socket.data.division || 'any' },
      { division: candidate.division || 'any' }
    ) &&
    (!interests.length || !candidate.interests.length ||
      interests.some(tag => candidate.interests.includes(tag)))
  );
  if (idx < 0) return null;
  return queue.splice(idx, 1)[0];
}

function pairUsers(a, b, mode) {
  const roomId = `room-${a.id}-${b.id}`;
  a.join(roomId);
  b.join(roomId);
  pairs.set(a.id, { peerId: b.id, roomId, mode });
  pairs.set(b.id, { peerId: a.id, roomId, mode });
  a.emit('matched', { peerId: b.id, mode, initiator: true });
  b.emit('matched', { peerId: a.id, mode, initiator: false });
}

io.on('connection', socket => {
  online += 1;
  io.emit('online-count', online);

  socket.data.blocked = new Set();
  socket.data.lastMessageAt = 0;
  socket.data.lastQueueAt = 0;
  socket.data.mode = null;

  socket.on('join-queue', (payload = {}) => {
    const now = Date.now();
    if (now - socket.data.lastQueueAt < 700) return;
    socket.data.lastQueueAt = now;

    const mode = payload.mode;
    if (!['video', 'text'].includes(mode)) {
      socket.emit('app-error', 'Please choose video or text chat.');
      return;
    }

    endPair(socket.id);
    removeFromQueue(socket.id);

    socket.data.mode = mode;
    socket.data.interests = cleanInterests(payload.interests);
    socket.data.division = cleanDivision(payload.division);

    const match = findMatch(socket, mode, socket.data.interests);
    if (match) {
      pairUsers(socket, match.socket, mode);
    } else {
      waiting[mode].push({
        id: socket.id,
        socket,
        interests: socket.data.interests,
        division: socket.data.division,
        blocked: socket.data.blocked
      });
      socket.emit('searching');
    }
  });

  socket.on('next', () => {
    if (!socket.data.mode) return;
    endPair(socket.id);
    removeFromQueue(socket.id);

    const mode = socket.data.mode;
    const interests = socket.data.interests || [];
    const match = findMatch(socket, mode, interests);

    if (match) {
      pairUsers(socket, match.socket, mode);
    } else {
      waiting[mode].push({
        id: socket.id,
        socket,
        interests,
        division: socket.data.division || 'any',
        blocked: socket.data.blocked
      });
      socket.emit('searching');
    }
  });

  socket.on('leave', () => {
    endPair(socket.id);
    removeFromQueue(socket.id);
    socket.data.mode = null;
  });

  socket.on('chat-message', (payload = {}) => {
    const pair = pairs.get(socket.id);
    const now = Date.now();
    const text = typeof payload.text === 'string' ? payload.text.trim() : '';
    if (!pair || !text || text.length > 1000) return;
    if (now - socket.data.lastMessageAt < 300) return;
    socket.data.lastMessageAt = now;
    io.to(pair.peerId).emit('chat-message', {
      text: text.slice(0, 1000),
      at: now
    });
  });

  socket.on('webrtc', payload => {
    const pair = pairs.get(socket.id);
    if (!pair || !payload || !['offer', 'answer', 'ice'].includes(payload.type)) return;
    io.to(pair.peerId).emit('webrtc', payload);
  });

  socket.on('block-partner', () => {
    const pair = pairs.get(socket.id);
    if (!pair) return;
    socket.data.blocked.add(pair.peerId);
    endPair(socket.id);
    socket.emit('partner-left');
  });

  socket.on('report-partner', (payload = {}) => {
    const pair = pairs.get(socket.id);
    if (!pair) return;
    const report = {
      reporter: socket.id,
      reported: pair.peerId,
      reason: String(payload.reason || 'User-submitted report').slice(0, 160),
      at: new Date().toISOString()
    };
    reports.push(report);
    console.warn('[MODERATION REPORT]', report);
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`StrangerConnect server listening on port ${PORT}`);
});
