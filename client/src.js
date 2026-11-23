import { io } from 'socket.io-client';

const SERVER = import.meta.env.VITE_SERVER_URL || 'http://localhost:8000';
const socket = io(SERVER, { autoConnect: true, transports: ['websocket','polling'] });
const $ = id => document.getElementById(id);
let mode = 'video', peerId = null, pc = null, localStream = null, iceServers = [];
let matched = false, queued = false;

const home = $('homeView'), chat = $('chatView');
function toast(msg){ const el=$('toast'); el.textContent=msg; el.classList.add('show'); setTimeout(()=>el.classList.remove('show'),2600); }
function setStatus(text, state='search'){ $('chatStatus').textContent=text; $('statusChip').innerHTML=`<i></i> ${state==='connected'?'Connected':state==='search'?'Searching':'Disconnected'}`; }
function addMessage(text, mine=false){ const row=document.createElement('div'); row.className='message'+(mine?' mine':''); row.textContent=text; $('messages').append(row); $('messages').scrollTop=$('messages').scrollHeight; }
async function loadConfig(){ try{const r=await fetch(`${SERVER}/api/config`);iceServers=(await r.json()).iceServers||[];}catch{iceServers=[{urls:'stun:stun.l.google.com:19302'}];} }
async function getMedia(){ if(mode!=='video')return; try{localStream=await navigator.mediaDevices.getUserMedia({video:true,audio:true});$('localVideo').srcObject=localStream;$('localPlaceholder').classList.add('hidden');}catch(e){toast('Camera/microphone permission was denied. Check browser permissions.');throw e;} }
function stopMedia(){ if(localStream){localStream.getTracks().forEach(t=>t.stop());localStream=null;} $('localVideo').srcObject=null;$('remoteVideo').srcObject=null;$('localPlaceholder').classList.remove('hidden');$('remotePlaceholder').classList.remove('hidden'); }
function closePeer(){ if(pc){pc.onicecandidate=null;pc.ontrack=null;pc.close();pc=null;} $('remoteVideo').srcObject=null;$('remotePlaceholder').classList.remove('hidden'); }
async function makePeer(initiator){
  closePeer(); pc=new RTCPeerConnection({iceServers});
  if(localStream) localStream.getTracks().forEach(track=>pc.addTrack(track,localStream));
  pc.ontrack=e=>{$('remoteVideo').srcObject=e.streams[0];$('remotePlaceholder').classList.add('hidden');};
  pc.onicecandidate=e=>{if(e.candidate)socket.emit('webrtc',{type:'ice',candidate:e.candidate});};
  pc.onconnectionstatechange=()=>{if(pc?.connectionState==='failed')toast('Connection failed. Try Next.');};
  if(initiator){const offer=await pc.createOffer();await pc.setLocalDescription(offer);socket.emit('webrtc',{type:'offer',sdp:pc.localDescription});}
}
async function start(){
  home.classList.add('hidden');chat.classList.remove('hidden');$('modeLabel').textContent=mode.toUpperCase()+' CHAT';
  $('videoGrid').classList.toggle('hidden',mode==='text');$('textChat').classList.toggle('hidden',mode!=='text');
  $('messages').innerHTML='<div class="system-message">Finding someone with similar interests…</div>';
  $('micBtn').classList.toggle('hidden',mode==='text');$('cameraBtn').classList.toggle('hidden',mode==='text');
  setStatus('Finding someone…'); matched=false;queued=true;peerId=null;
  if(mode==='video'){try{await getMedia();}catch{stopMedia();home.classList.remove('hidden');chat.classList.add('hidden');return;}}
  socket.emit('join-queue',{mode,interests:$('interests').value.split(',').map(s=>s.trim()).filter(Boolean)});
}
function resetToHome(){socket.emit('leave');closePeer();stopMedia();matched=false;queued=false;peerId=null;chat.classList.add('hidden');home.classList.remove('hidden');}
document.querySelectorAll('.mode').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.mode').forEach(b=>b.classList.remove('active'));btn.classList.add('active');mode=btn.dataset.mode;}));
$('startBtn').onclick=start;
$('nextBtn').onclick=()=>{closePeer();$('messages').innerHTML='<div class="system-message">Finding another person…</div>';matched=false;queued=true;peerId=null;if(mode==='video'&&!localStream)getMedia().catch(()=>{});setStatus('Finding someone…');socket.emit('next');};
$('endBtn').onclick=resetToHome;
$('messageForm').addEventListener('submit',e=>{e.preventDefault();const input=$('messageInput');const text=input.value.trim();if(!text)return;if(!matched){toast('Wait until you are connected.');return;}socket.emit('chat-message',{text});addMessage(text,true);input.value='';});
$('micBtn').onclick=()=>{const t=localStream?.getAudioTracks()[0];if(t){t.enabled=!t.enabled;$('micBtn').classList.toggle('off',!t.enabled);$('micBtn').textContent=t.enabled?'🎙 Mic':'🎙 Mic off';}};
$('cameraBtn').onclick=()=>{const t=localStream?.getVideoTracks()[0];if(t){t.enabled=!t.enabled;$('cameraBtn').classList.toggle('off',!t.enabled);$('cameraBtn').textContent=t.enabled?'▣ Camera':'▣ Camera off';}};
$('reportBtn').onclick=()=>{if(matched&&confirm('Report this person and end the chat?'))socket.emit('report-partner',{reason:'User-submitted report'});};
$('blockBtn').onclick=()=>{if(matched&&confirm('Block this person and end the chat?'))socket.emit('block-partner');};
socket.on('connect',()=>loadConfig());
socket.on('online-count',n=>$('onlineCount').textContent=n);
socket.on('searching',()=>{queued=true;setStatus('Finding someone…');});
socket.on('matched',async({peerId:id,mode:matchedMode,initiator})=>{
  peerId=id;matched=true;queued=false;setStatus('You are connected!','connected');$('chatStatus').textContent='You’re chatting with a stranger';
  $('messages').innerHTML='<div class="system-message">You are connected. Say hello!</div>';
  if(matchedMode==='video'){try{await makePeer(initiator);}catch(e){console.error(e);toast('Could not start video connection.');}}
});
socket.on('chat-message',({text})=>addMessage(text,false));
socket.on('webrtc',async payload=>{
  if(!pc)await makePeer(false);
  try{
    if(payload.type==='offer'){await pc.setRemoteDescription(payload.sdp);const answer=await pc.createAnswer();await pc.setLocalDescription(answer);socket.emit('webrtc',{type:'answer',sdp:pc.localDescription});}
    else if(payload.type==='answer')await pc.setRemoteDescription(payload.sdp);
    else if(payload.type==='ice'&&payload.candidate)await pc.addIceCandidate(payload.candidate);
  }catch(e){console.error('WebRTC signalling error',e);toast('Video setup failed. Try Next.');}
});
socket.on('partner-left',()=>{closePeer();matched=false;peerId=null;setStatus('Stranger disconnected','disconnected');$('chatStatus').textContent='Stranger disconnected';toast('The stranger left. Press Next to meet someone else.');});
socket.on('app-error',msg=>toast(msg));
socket.on('disconnect',()=>{if(!chat.classList.contains('hidden'))toast('Server connection lost. Reconnecting…');});
window.addEventListener('beforeunload',()=>{socket.emit('leave');stopMedia();});
