// A.C.T.I.G. — main controller. Wires the DOM UI to the brain (WebLLM), voice
// (TTS + Whisper STT + barge-in), the Three.js 3D space, camera hand control and
// object analysis. Mirrors the native app's AssistantController.
//
// IMPORTANT: only light modules are imported statically. The heavy CDN-backed
// modules (Three.js scene, MediaPipe hands/vision) are loaded lazily the first
// time they're needed, so a slow/blocked CDN can never stop the core app (chat,
// voice, UI) from working.

import { Brain } from './llm.js';
import { Voice, checkWakeSleep } from './voice.js';
import { parse } from './intent.js';

const WELCOME = 'Welcome sir, ACTIG at your service sir, how may I assist you sir.';

const $ = (id) => document.getElementById(id);
const el = {
  overlay: $('overlay'), status: $('status'), transcript: $('transcript'),
  textInput: $('text-input'), send: $('send-btn'), fileInput: $('file-input'),
  micUser: $('mic-user'), micAI: $('mic-ai'), wakeBadge: $('wake-badge'),
  boot: $('boot'), sceneCanvas: $('scene-canvas'), sceneToolbar: $('scene-toolbar'),
  cameraWS: $('camera-workspace'), video: $('camera-video'), handOverlay: $('hand-overlay'),
  reticle: $('reticle'), scanBtn: $('scan-btn'),
};

const state = {
  mode: 'dormant', workspace: 'conversation',
  userMicMuted: false, aiVoiceMuted: false, cameraControl: false,
  messages: [], liveEl: null,
};

const brain = new Brain();
const voice = new Voice();
let scene = null, scenePromise = null, hands = null, vision = null, stream = null;
let modelReadyPromise = null;

// ---------- boot (UI first, model in background) ----------
boot();
function boot(){
  bindUI();                          // wire the UI immediately — never gated on a download
  el.boot.classList.add('hidden');
  setStatus('starting…');

  // Load the model in the BACKGROUND; the UI stays responsive meanwhile.
  modelReadyPromise = brain.load((p) => setStatus(`loading model… ${Math.round(p * 100)}%`))
    .then(() => setStatus(`ready · ${brain.displayName}`))
    .catch((e) => { console.warn(e); setStatus('ready (offline stub)'); });

  handleDeepLink();                  // allow launching straight into 3D/camera (Siri Shortcut)
  window.addEventListener('error', (e) => console.warn('ACTIG error:', e.message));
  window.addEventListener('unhandledrejection', (e) => console.warn('ACTIG rejection:', e.reason));
}

// Launch via a URL like .../#scene (or ?ws=scene) opens that workspace on start —
// this is what an iOS Shortcut/Siri uses to bring up the 3D space "from anywhere".
function handleDeepLink(){
  const h = (location.hash + ' ' + location.search).toLowerCase();
  if (!h.trim()) return;
  if (/scene|3d/.test(h)){ wake(); setWorkspace('scene3D'); }
  else if (/camera|scan/.test(h)){ wake(); setWorkspace('camera'); }
  else if (/wake/.test(h)){ wake(); }
}

// ---------- UI wiring ----------
function bindUI(){
  el.wakeBadge.addEventListener('click', wake);
  el.send.addEventListener('click', sendText);
  el.textInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendText(); });
  el.fileInput.addEventListener('change', onFile);

  el.micUser.addEventListener('click', () => {
    state.userMicMuted = !state.userMicMuted;
    el.micUser.classList.toggle('muted', state.userMicMuted);
    if (state.userMicMuted) voice.stopListening(); else if (state.mode !== 'dormant') startListening();
  });
  el.micAI.addEventListener('click', () => {
    state.aiVoiceMuted = !state.aiVoiceMuted;
    voice.muted = state.aiVoiceMuted;
    el.micAI.classList.toggle('muted', state.aiVoiceMuted);
    if (state.aiVoiceMuted) voice.stopSpeaking();
  });

  document.querySelectorAll('.switcher .ws').forEach((b) =>
    b.addEventListener('click', () => setWorkspace(b.dataset.ws)));
  el.sceneToolbar.querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => onTool(b.dataset.tool)));
  el.scanBtn.addEventListener('click', () => scanObject('What is this object?'));
}

// ---------- lifecycle ----------
async function wake(){
  if (state.mode !== 'dormant') return;
  setMode('awake');
  setWorkspace('conversation');
  setStatus('online · listening');
  announce(WELCOME);             // greeting: text + voice
  startListening();
}

function shutdown(){
  brain.abort(); voice.stopSpeaking(); voice.stopListening();
  stopCamera(); if (hands) hands.stop();
  state.cameraControl = false;
  setMode('dormant');
  setStatus('dormant');
}

function startListening(){
  if (state.userMicMuted) return;
  voice.startListening({
    onPartial: (t) => { showLive(t); const w = checkWakeSleep(t); if (w === 'sleep') shutdown(); },
    onFinal: (t) => onFinalSpeech(t),
    onSpeechStart: () => { if (state.mode === 'responding' || voice.speaking) interrupt(); },
  });
}

function onFinalSpeech(text){
  clearLive();
  const ws = checkWakeSleep(text);
  if (ws === 'sleep'){ shutdown(); return; }
  if (ws === 'wake' && state.mode === 'dormant'){ wake(); return; }
  if (state.mode !== 'dormant' && !state.userMicMuted) handleText(text, true);
}

function interrupt(){
  brain.abort(); voice.stopSpeaking();
  setMode('awake'); setStatus('go ahead — listening');
}

// ---------- input handling ----------
function sendText(){
  const t = el.textInput.value.trim();
  if (!t) return;
  el.textInput.value = '';
  if (state.mode === 'dormant') setMode('awake');
  handleText(t, false);
}

async function handleText(text, spoken){
  const intent = parse(text, { workspace: state.workspace });
  if (intent.type !== 'wake' && intent.type !== 'shutdown') addMessage('user', text);
  clearLive();
  await route(intent);
}

async function route(intent){
  switch(intent.type){
    case 'wake': return wake();
    case 'shutdown': return shutdown();
    case 'openScene': setWorkspace('scene3D'); return announce('Opening the 3D project space, sir.');
    case 'openConversation': return setWorkspace('conversation');
    case 'openCamera': return setWorkspace('camera');
    case 'enableCameraControl': return enableCameraControl();
    case 'disableCameraControl':
      state.cameraControl = false; if (hands) hands.stop(); el.handOverlay.classList.add('hidden');
      el.video.classList.remove('detecting'); stopCamera();
      return announce('Camera control disabled, sir.');
    case 'analyze': setWorkspace('camera'); return scanObject(intent.question);
    case 'undo': { const s = await ensureScene(); s.undo(); return announce('Reverted, sir.'); }
    case 'redo': { const s = await ensureScene(); s.redo(); return announce('Restored, sir.'); }
    case 'scene': return applyScene(intent);
    case 'chat': default: return generateReply(text);
  }
}

async function applyScene(i){
  setWorkspace('scene3D');
  const s = await ensureScene();
  switch(i.action){
    case 'add': s.addShape(i.kind); return announce(`Added a ${i.kind}, sir.`);
    case 'multiply': s.multiply(i.kind, i.count); return announce(`Created ${i.count} ${i.kind}s, sir.`);
    case 'grow': s.grow(); return announce('Enlarged, sir.');
    case 'shrink': s.shrink(); return announce('Shrunk, sir.');
    case 'delete': s.deleteSelected(); return announce('Deleted, sir.');
    case 'swap': s.swapFirstTwo(); return announce('Swapped positions, sir.');
    case 'clear': s.clear(); return announce('Scene cleared, sir.');
  }
}

// ---------- LLM ----------
async function generateReply(prompt){
  brain.abort();
  setMode('responding'); setStatus('thinking…');
  // The model loads in the background — wait for it on the first request.
  if (!brain.ready){ setStatus('warming up the model…'); await modelReadyPromise; }
  // Snapshot recent history BEFORE adding the empty assistant bubble (keeps
  // context + memory bounded on mobile and avoids sending an empty turn).
  const history = state.messages.filter(m => m.role !== 'system').slice(-12);
  const bubble = addMessage('assistant', '');
  try{
    let spoke = false;
    for await (const tok of brain.reply(history)){
      bubble.el.textContent += tok;
      bubble.content += tok;
      scrollTranscript();
      if (!state.aiVoiceMuted){ voice.enqueueToken(tok); spoke = true; }
      if (el.status.textContent === 'thinking…') setStatus('responding');
    }
    if (!state.aiVoiceMuted) voice.flush();
    if (!bubble.content.trim()) bubble.el.textContent = '(no response — see status)';
    setMode('awake'); setStatus('listening');
  }catch(e){
    bubble.el.textContent += ` [error: ${e.message}]`;
    setMode('awake'); setStatus('listening');
  }
}

// ---------- camera + vision ----------
async function startCamera(facing){
  stopCamera();
  stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: false });
  el.video.srcObject = stream;
  el.video.classList.remove('hidden');
  await el.video.play().catch(()=>{});
}
function stopCamera(){
  if (stream){ stream.getTracks().forEach(t => t.stop()); stream = null; }
  el.video.classList.add('hidden'); el.video.classList.remove('detecting');
}

async function enableCameraControl(){
  const s = await ensureScene(); setWorkspace('scene3D');
  try{
    await startCamera('user');                       // front camera for hands
    const { Hands } = await import('./hands.js');
    if (!hands) hands = new Hands(el.video, s, el.handOverlay);
    const ok = await hands.init();
    if (!ok){ announce('Hand tracking is unavailable on this browser, sir.'); stopCamera(); return; }
    state.cameraControl = true;
    el.video.classList.add('detecting');             // play hidden for detection
    el.handOverlay.classList.remove('hidden');
    hands.start();
    announce('Camera hand control enabled, sir. Pinch to grab a shape and move it.');
  }catch(e){ announce('I could not access the camera, sir.'); }
}

async function getVision(){
  if (!vision){ const { Vision } = await import('./vision.js'); vision = new Vision(); }
  await vision.init();
  return vision;
}

async function scanObject(question){
  setWorkspace('camera');
  try{
    if (!stream) await startCamera('environment');
    const v = await getVision();
    setStatus('analysing…');
    const summary = await v.analyze(el.video);
    addMessage('user', question);
    const prompt = `Camera vision reports: ${summary}. The user asks: "${question}". Answer concisely, sir.`;
    await generateReply(prompt);
  }catch(e){ announce('I could not analyse that, sir.'); }
}

async function onFile(e){
  const file = e.target.files?.[0]; if (!file) return;
  el.fileInput.value = '';
  addMessage('user', `📎 ${file.name}`);
  try{
    const v = await getVision();
    const img = await loadImage(file);
    const summary = await v.analyze(img);
    await generateReply(`The user attached an image. Vision reports: ${summary}. Briefly describe it, sir.`);
  }catch(_){ announce('I received the file, sir, but could not analyse it.'); }
}
function loadImage(file){
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
}

// ---------- tools ----------
async function onTool(tool){
  const s = await ensureScene();
  ({
    box:()=>s.addShape('box'), sphere:()=>s.addShape('sphere'),
    cylinder:()=>s.addShape('cylinder'), cone:()=>s.addShape('cone'),
    grow:()=>s.grow(), shrink:()=>s.shrink(), delete:()=>s.deleteSelected(),
    undo:()=>s.undo(), redo:()=>s.redo(),
  })[tool]?.();
}

// ---------- scene/workspace ----------
// Lazily imports Three.js + creates the scene exactly once.
function ensureScene(){
  if (scene) return Promise.resolve(scene);
  if (!scenePromise){
    el.sceneCanvas.classList.remove('hidden');
    scenePromise = import('./scene.js')
      .then(({ Scene3D }) => { scene = new Scene3D(el.sceneCanvas); scene.resize(); return scene; })
      .catch((e) => { announce('The 3D engine could not load, sir.'); throw e; });
  }
  return scenePromise;
}

function setWorkspace(ws){
  state.workspace = ws;
  document.querySelectorAll('.switcher .ws').forEach(b => b.classList.toggle('active', b.dataset.ws === ws));

  const sceneOn = ws === 'scene3D';
  const camOn = ws === 'camera';
  el.sceneCanvas.classList.toggle('hidden', !(sceneOn || state.cameraControl));
  el.sceneToolbar.classList.toggle('hidden', !sceneOn);
  el.cameraWS.classList.toggle('hidden', !camOn);
  el.handOverlay.classList.toggle('hidden', !state.cameraControl);

  if (sceneOn){ ensureScene().then((s) => s.resize()).catch(()=>{}); }
  if (camOn){ el.video.classList.remove('detecting'); startCamera('environment').catch(()=>{}); }
  else if (!state.cameraControl){ stopCamera(); }
}

// ---------- messages / status ----------
function addMessage(role, text){
  state.messages.push({ role, content: text });
  const div = document.createElement('div');
  div.className = `msg ${role}`; div.textContent = text;
  el.transcript.appendChild(div); scrollTranscript();
  const idx = state.messages.length - 1;
  return { el: div, get content(){ return state.messages[idx].content; }, set content(v){ state.messages[idx].content = v; } };
}
function announce(text){
  addMessage('assistant', text);
  if (!state.aiVoiceMuted) voice.speak(text);
}
function showLive(t){
  if (!state.liveEl){ state.liveEl = document.createElement('div'); state.liveEl.className = 'msg live'; el.transcript.appendChild(state.liveEl); }
  state.liveEl.textContent = t; scrollTranscript();
}
function clearLive(){ if (state.liveEl){ state.liveEl.remove(); state.liveEl = null; } }
function scrollTranscript(){ el.transcript.scrollTop = el.transcript.scrollHeight; }

function setStatus(s){ el.status.textContent = s; }
function setMode(m){
  state.mode = m;
  el.overlay.classList.toggle('dormant', m === 'dormant');
  el.overlay.classList.toggle('responding', m === 'responding');
}
