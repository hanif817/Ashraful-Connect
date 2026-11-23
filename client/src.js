import { io } from 'socket.io-client';

const SERVER = (import.meta.env.VITE_SERVER_URL || 'http://localhost:8000').replace(/\/$/, '');
const socket = io(SERVER, {
  autoConnect: true,
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: Infinity,
  timeout: 20000
});

const $ = id => document.getElementById(id);
let mode = 'video';
let pc = null;
let localStream = null;
let iceServers = [];
let matched = false;
let active = false;
let pendingCandidates = [];
let toastTimer = null;

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

function setStatus(message, state = 'ready') {
  $('statusText').textContent = message;
  $('connectionStatus').classList.toggle('connected', state === 'connected');
  $('connectionStatus').classList.toggle('disconnected', state === 'disconnected');
}

function addMessage(text, mine = false) {
  $('chatState').classList.add('hidden');
  $('messages').classList.remove('hidden');
  const row = document.createElement('div');
  row.className = `message${mine ? ' mine' : ''}`;
  row.textContent = text;
  $('messages').append(row);
  $('messages').scrollTop = $('messages').scrollHeight;
}

function resetMessages(message = 'Start a chat to send and receive messages.') {
  $('messages').innerHTML = `<div class="system-message">${message}</div>`;
  $('messages').classList.remove('hidden');
  $('chatState').classList.add('hidden');
}

function showEmptyChat() {
  $('messages').classList.add('hidden');
  $('chatState').classList.remove('hidden');
}

function setMatchedControls(isMatched) {
  $('nextBtn').disabled = !active;
  $('reportBtn').disabled = !isMatched;
  $('blockBtn').disabled = !isMatched;
  $('messageInput').disabled = !isMatched;
  $('sendBtn').disabled = !isMatched;
}

async function loadConfig() {
  try {
    const response = await fetch(`${SERVER}/api/config`);
    if (!response.ok) throw new Error('Could not load WebRTC configuration');
    const config = await response.json();
    iceServers = Array.isArray(config.iceServers) ? config.iceServers : [];
  } catch (error) {
    console.warn(error);
    iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ];
  }
}

async function getMedia() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera access requires HTTPS or localhost and a supported browser.');
  }
  if (localStream) return;
  localStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user' },
    audio: true
  });
  $('localVideo').srcObject = localStream;
  $('localPlaceholder').classList.add('hidden');
  $('micBtn').disabled = false;
  $('cameraBtn').disabled = false;
}

function stopMedia() {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  $('localVideo').srcObject = null;
  $('localPlaceholder').classList.remove('hidden');
  $('micBtn').disabled = true;
  $('cameraBtn').disabled = true;
  $('micBtn').classList.remove('active');
  $('cameraBtn').classList.remove('active');
  $('micBtn').textContent = '🎙';
  $('cameraBtn').textContent = '▣';
}

function closePeer() {
  if (pc) {
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
    pc.close();
    pc = null;
  }
  pendingCandidates = [];
  $('remoteVideo').srcObject = null;
  $('remotePlaceholder').classList.remove('hidden');
}

async function flushCandidates() {
  if (!pc?.remoteDescription) return;
  const queued = pendingCandidates;
  pendingCandidates = [];
  for (const candidate of queued) {
    try {
      await pc.addIceCandidate(candidate);
    } catch (error) {
      console.warn('Could not add queued ICE candidate', error);
    }
  }
}

async function makePeer(initiator) {
  closePeer();
  pc = new RTCPeerConnection({ iceServers });
  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }
  pc.ontrack = event => {
    $('remoteVideo').srcObject = event.streams[0];
    $('remotePlaceholder').classList.add('hidden');
  };
  pc.onicecandidate = event => {
    if (event.candidate) socket.emit('webrtc', { type: 'ice', candidate: event.candidate });
  };
  pc.onconnectionstatechange = () => {
    if (!pc) return;
    if (pc.connectionState === 'connected') {
      setStatus('Video connection established', 'connected');
    } else if (pc.connectionState === 'failed') {
      toast('Video connection failed. Try Next. A TURN server may be required.');
    }
  };

  if (initiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('webrtc', { type: 'offer', sdp: pc.localDescription });
  }
}

async function startChat() {
  if (active) return;
  if (!socket.connected) {
    toast('Connecting to the chat server. Please try again in a moment.');
    socket.connect();
    return;
  }

  if (mode === 'video') {
    try {
      await getMedia();
    } catch (error) {
      toast(error.message || 'Camera/microphone permission was denied.');
      return;
    }
  }

  active = true;
  matched = false;
  $('startBtn').disabled = true;
  $('stopBtn').disabled = false;
  $('nextBtn').disabled = false;
  $('countrySelect').disabled = true;
  $('messageInput').disabled = true;
  $('sendBtn').disabled = true;

  if (mode === 'text') {
    $('videoStage').classList.add('text-mode');
    $('remoteTitle').textContent = 'Text chat is ready';
    $('remoteHint').textContent = 'Finding someone to talk to…';
  } else {
    $('videoStage').classList.remove('text-mode');
  }

  resetMessages('Searching for a stranger…');
  setStatus('Finding someone…', 'searching');
  socket.emit('join-queue', {
    mode,
    country: $('countrySelect').value,
    interests: []
  });
}

function stopChat() {
  socket.emit('leave');
  active = false;
  matched = false;
  closePeer();
  stopMedia();
  $('startBtn').disabled = false;
  $('stopBtn').disabled = true;
  $('nextBtn').disabled = true;
  $('countrySelect').disabled = false;
  $('messageInput').disabled = true;
  $('sendBtn').disabled = true;
  $('reportBtn').disabled = true;
  $('blockBtn').disabled = true;
  $('remoteTitle').textContent = 'Your next stranger is waiting';
  $('remoteHint').textContent = 'Press Start to find someone';
  showEmptyChat();
  setStatus('Ready to connect');
}

function nextStranger() {
  if (!active) return;
  closePeer();
  matched = false;
  setMatchedControls(false);
  resetMessages('Finding another stranger…');
  setStatus('Finding someone new…', 'searching');
  if (mode === 'video' && !localStream) {
    getMedia().catch(error => toast(error.message));
  }
  socket.emit('next');
}

function setMode(nextMode) {
  if (active) {
    toast('Stop your current chat before changing mode.');
    return;
  }
  mode = nextMode;
  document.querySelectorAll('.mode-button').forEach(button => {
    button.classList.toggle('active', button.dataset.mode === mode);
  });
  $('remoteTitle').textContent = mode === 'video' ? 'Your next stranger is waiting' : 'Text chat selected';
  $('remoteHint').textContent = mode === 'video' ? 'Press Start to find someone' : 'Press Start to find a text conversation';
}

function sendMessage(event) {
  event.preventDefault();
  const input = $('messageInput');
  const text = input.value.trim();
  if (!text || !matched) return;
  socket.emit('chat-message', { text });
  addMessage(text, true);
  input.value = '';
}

$('startBtn').addEventListener('click', startChat);
$('stopBtn').addEventListener('click', stopChat);
$('nextBtn').addEventListener('click', nextStranger);
$('messageForm').addEventListener('submit', sendMessage);

document.querySelectorAll('.mode-button').forEach(button => {
  button.addEventListener('click', () => setMode(button.dataset.mode));
});

$('micBtn').addEventListener('click', () => {
  const track = localStream?.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  $('micBtn').classList.toggle('active', !track.enabled);
  $('micBtn').textContent = track.enabled ? '🎙' : '🔇';
  $('micBtn').title = track.enabled ? 'Mute microphone' : 'Unmute microphone';
});

$('cameraBtn').addEventListener('click', () => {
  const track = localStream?.getVideoTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  $('cameraBtn').classList.toggle('active', !track.enabled);
  $('cameraBtn').textContent = track.enabled ? '▣' : '◻';
  $('cameraBtn').title = track.enabled ? 'Turn camera off' : 'Turn camera on';
});

$('reportBtn').addEventListener('click', () => {
  if (!matched || !confirm('Report this stranger and end the chat?')) return;
  socket.emit('report-partner', { reason: 'User-submitted report' });
  toast('Report submitted. The chat has ended.');
});

$('blockBtn').addEventListener('click', () => {
  if (!matched || !confirm('Block this stranger and end the chat?')) return;
  socket.emit('block-partner');
  toast('Stranger blocked for this session.');
});

socket.on('connect', async () => {
  await loadConfig();
  setStatus(active ? 'Reconnected — press Next to continue' : 'Connected to server');
  $('onlineCount').textContent = $('onlineCount').textContent || '0';
});

socket.on('connect_error', error => {
  console.error('Socket connection error:', error.message);
  setStatus('Server connection problem', 'disconnected');
});

socket.on('online-count', count => {
  $('onlineCount').textContent = String(count);
});

socket.on('searching', () => {
  if (!active) return;
  setStatus('Searching for a stranger…', 'searching');
});

socket.on('matched', async ({ mode: matchedMode, initiator }) => {
  matched = true;
  setMatchedControls(true);
  setStatus('You are connected', 'connected');
  resetMessages('Connected! Say hello to your stranger.');
  if (matchedMode === 'video') {
    try {
      await makePeer(initiator);
    } catch (error) {
      console.error('WebRTC peer setup failed:', error);
      toast('Could not start video connection. Press Next to retry.');
    }
  } else {
    $('remoteTitle').textContent = 'You are connected';
    $('remoteHint').textContent = 'Say hello in the message panel';
  }
});

socket.on('chat-message', payload => {
  if (payload && typeof payload.text === 'string') addMessage(payload.text, false);
});

socket.on('webrtc', async payload => {
  try {
    if (!pc) await makePeer(false);
    if (payload.type === 'offer') {
      await pc.setRemoteDescription(payload.sdp);
      await flushCandidates();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('webrtc', { type: 'answer', sdp: pc.localDescription });
    } else if (payload.type === 'answer') {
      await pc.setRemoteDescription(payload.sdp);
      await flushCandidates();
    } else if (payload.type === 'ice' && payload.candidate) {
      if (pc.remoteDescription) {
        await pc.addIceCandidate(payload.candidate);
      } else {
        pendingCandidates.push(payload.candidate);
      }
    }
  } catch (error) {
    console.error('WebRTC signalling error:', error);
    toast('Video setup failed. Press Next to retry.');
  }
});

socket.on('partner-left', () => {
  closePeer();
  matched = false;
  setMatchedControls(false);
  if (active) {
    setStatus('Stranger disconnected', 'disconnected');
    resetMessages('The stranger left. Press Next to find another person.');
  }
});

socket.on('app-error', message => toast(String(message)));
socket.on('disconnect', () => {
  if (active) {
    setStatus('Reconnecting to server…', 'disconnected');
    toast('Server connection lost. Reconnecting…');
  }
});

window.addEventListener('beforeunload', () => {
  socket.emit('leave');
  stopMedia();
});
