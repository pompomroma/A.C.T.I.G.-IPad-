// A.C.T.I.G. — main controller. Wires the DOM UI to the brain (WebLLM), voice
// (TTS + Whisper STT + barge-in), the Three.js 3D space, camera hand control and
// object analysis. Mirrors the native app's AssistantController.
//
// IMPORTANT: only light modules are imported statically. The heavy CDN-backed
// modules (Three.js scene, MediaPipe hands/vision) are loaded lazily the first
// time they're needed, so a slow/blocked CDN can never stop the core app (chat,
// voice, UI) from working.

import { Brain, estimateMaxTokens } from './llm.js';
import { Voice, checkWakeSleep } from './voice.js';
import { parse } from './intent.js';
import { buildModel, genericModel } from './modeler.js';
import { t, getLang, toggleLang, applyI18n, shapeName } from './i18n.js';

const $ = (id) => document.getElementById(id);
const el = {
  overlay: $('overlay'), status: $('status'), transcript: $('transcript'),
  textInput: $('text-input'), send: $('send-btn'), fileInput: $('file-input'),
  micUser: $('mic-user'), micAI: $('mic-ai'), wakeBadge: $('wake-badge'),
  boot: $('boot'), sceneCanvas: $('scene-canvas'), sceneToolbar: $('scene-toolbar'),
  cameraWS: $('camera-workspace'), video: $('camera-video'), handOverlay: $('hand-overlay'),
  reticle: $('reticle'), scanBtn: $('scan-btn'), langToggle: $('lang-toggle'),
};

const state = {
  mode: 'dormant', workspace: 'conversation',
  userMicMuted: false, aiVoiceMuted: false, cameraControl: false,
  messages: [], liveEl: null, voiceNoticeShown: false, warmNoteShown: false,
};

let brain = new Brain();
const voice = new Voice();
let scene = null, scenePromise = null, hands = null, vision = null, stream = null;
let modelReadyPromise = null;

// ---------- boot (UI first, model in background) ----------
boot();
function boot(){
  applyI18n();                       // localize all static labels for the saved language
  bindUI();                          // wire the UI immediately — never gated on a download
  el.boot.classList.add('hidden');
  setStatus(t('st.starting'));

  loadModel();                       // load the brain in the BACKGROUND; UI stays responsive

  handleDeepLink();                  // allow launching straight into 3D/camera (Siri Shortcut)
  window.addEventListener('error', (e) => console.warn('ACTIG error:', e.message));
  window.addEventListener('unhandledrejection', (e) => console.warn('ACTIG rejection:', e.reason));
}

// Loads (or reloads) the language model in the background.
function loadModel(){
  modelReadyPromise = brain.load((p) => setStatus(t('st.loading', Math.round(p * 100))))
    .then(() => setStatus(brain.usingStub ? t('st.liteRetry') : t('st.ready', brain.displayName)))
    .catch((e) => { console.warn(e); setStatus(t('st.offlineStub')); });
  return modelReadyPromise;
}

// Lets the user recover from lite mode (e.g. after a transient crash-loop guard)
// by tapping the status line to re-attempt loading the full on-device model.
function retryModel(){
  if (!brain.usingStub) return;
  try{ localStorage.removeItem('actig_llm_fails'); localStorage.removeItem('actig_llm_fail_ts'); }catch{}
  brain = new Brain();
  setStatus(t('st.retrying'));
  loadModel();
}

// Flip the input/output language (한국어 ⇄ English), re-localize the UI, and
// restart speech recognition so it listens in the new language.
function toggleLanguage(){
  toggleLang();
  applyI18n();
  voice.stopSpeaking();                       // don't keep speaking the old language
  setStatus(state.mode === 'dormant' ? t('st.dormant') : t('st.listening'));
  // Whisper reads the language per utterance — no mic restart needed (fluent on
  // iOS). Only Web Speech must restart to change its recognition language.
  if (state.mode !== 'dormant' && !state.userMicMuted && voice.usesWebSpeech){
    voice.stopListening(); startListening();
  }
}

// Launch via a URL like .../#scene (or ?ws=scene) opens that workspace on start —
// this is what an iOS Siri Shortcut uses to open A.C.T.I.G. by voice and bring it
// straight online (or into the 3D space) "from anywhere", without tapping the icon.
function handleDeepLink(){
  const h = (location.hash + ' ' + location.search).toLowerCase();
  if (!h.trim()) return;
  if (/scene|3d/.test(h)){ wake(); setWorkspace('scene3D'); }
  else if (/camera|scan/.test(h)){ wake(); setWorkspace('camera'); }
  else if (/wake|actig|launch|open|hey/.test(h)){ wake(); }
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
  el.scanBtn.addEventListener('click', () => scanObject(t('scanQ')));
  el.status.addEventListener('click', retryModel);   // tap status to retry full model
  el.langToggle?.addEventListener('click', toggleLanguage);
}

// ---------- lifecycle ----------
async function wake(){
  if (state.mode !== 'dormant') return;
  setMode('awake');
  setWorkspace('conversation');
  setStatus(t('st.listening'));
  announce(t('welcome'));        // greeting: text + voice
  startListening();
}

function shutdown(){
  brain.abort(); voice.stopSpeaking(); voice.stopListening();
  stopCamera(); if (hands) hands.stop();
  state.cameraControl = false;
  setMode('dormant');
  setStatus(t('st.dormant'));
}

function startListening(){
  if (state.userMicMuted) return;
  voice.startListening({
    onPartial: (t) => { showLive(t); const w = checkWakeSleep(t); if (w === 'sleep') shutdown(); },
    onFinal: (t) => onFinalSpeech(t),
    onSpeechStart: () => { if (state.mode === 'responding' || voice.speaking) interrupt(); },
    onStatus: onVoiceStatus,
  });
}

// Reflects the microphone state in the status line, and — the first time voice
// input proves unavailable on this browser/network — tells the user to type
// instead (so a silent STT failure never looks like the AI ignoring them).
function onVoiceStatus(s){
  if (state.mode === 'dormant') return;
  if (s === 'unavailable'){
    if (!state.voiceNoticeShown){
      state.voiceNoticeShown = true;
      announce(t('voiceUnavailable'));
    }
    setStatus(t('st.typeToMe'));
  } else if (s === 'transcribing'){
    setStatus(t('st.transcribing'));
  } else if (s === 'listening' && state.mode !== 'responding'){
    setStatus(t('st.listening'));
  }
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
  setMode('awake'); setStatus(t('st.goAhead'));
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
    case 'openScene': setWorkspace('scene3D'); return announce(t('ack.openScene'));
    case 'openConversation': return setWorkspace('conversation');
    case 'openCamera': return setWorkspace('camera');
    case 'enableCameraControl': return enableCameraControl();
    case 'disableCameraControl':
      state.cameraControl = false; if (hands) hands.stop(); el.handOverlay.classList.add('hidden');
      el.video.classList.remove('detecting'); stopCamera();
      return announce(t('ack.cameraDisabled'));
    case 'analyze': setWorkspace('camera'); return scanObject(intent.question);
    case 'undo': { const s = await ensureScene(); s.undo(); return announce(t('ack.undo')); }
    case 'redo': { const s = await ensureScene(); s.redo(); return announce(t('ack.redo')); }
    case 'scene': return applyScene(intent);
    case 'build': return generateModel(intent.desc);
    case 'export': return exportModel();
    case 'chat': default: return generateReply(intent.text);
  }
}

// ---------- generative 3D modelling ----------
// Build a described object from primitives: try the template library, then the
// full model (if loaded), then a generic composition so there's always a result.
async function generateModel(desc){
  setWorkspace('scene3D');
  const s = await ensureScene();
  setStatus(t('st.building'));
  let model = buildModel(desc);
  if (!model && brain.ready && !brain.usingStub){
    const parts = await brain.modelSpec(desc).catch(() => null);
    if (parts) model = { key: 'llm', parts };
  }
  let approx = false;
  if (!model){ model = genericModel(); approx = true; }
  s.addModel(model.parts);
  announce(t('ack.built', desc) + (approx ? t('ack.approx') : ''));
  setStatus(brain.ready ? t('st.listen') : t('st.listenLoading'));
}

// ---------- export / import ----------
function download(text, filename, mime){
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function exportModel(){
  const s = await ensureScene();
  const obj = s.exportOBJ();
  if (!obj){ announce(t('ack.nothingToExport')); return; }
  download(obj, 'actig-model.obj', 'model/obj');
  download(s.exportJSON(), 'actig-model.json', 'application/json');
  announce(t('ack.exported'));
}

async function applyScene(i){
  setWorkspace('scene3D');
  const s = await ensureScene();
  switch(i.action){
    case 'add': s.addShape(i.kind); return announce(t('ack.added', shapeName(i.kind)));
    case 'multiply': s.multiply(i.kind, i.count); return announce(t('ack.created', i.count, shapeName(i.kind)));
    case 'grow': s.grow(); return announce(t('ack.grow'));
    case 'shrink': s.shrink(); return announce(t('ack.shrink'));
    case 'rotate': s.rotate(i.axis, i.degrees); return announce(t('ack.rotate'));
    case 'move': s.moveBy(i.dx, i.dy, i.dz); return announce(t('ack.move'));
    case 'moveTo': s.moveTo(i.x, i.y, i.z); return announce(t('ack.moveTo'));
    case 'delete': s.deleteSelected(); return announce(t('ack.delete'));
    case 'swap': s.swapFirstTwo(); return announce(t('ack.swap'));
    case 'clear': s.clear(); return announce(t('ack.clear'));
  }
}

// ---------- LLM ----------
// `override`, when given, is the text actually sent to the model as the latest
// user turn (e.g. a camera/vision-augmented prompt) in place of the short text
// shown in the transcript. For plain chat it equals the visible message.
async function generateReply(override){
  brain.abort();
  setMode('responding'); setStatus(t('st.thinking'));

  // Never block on the model download: if the full model isn't ready yet, answer
  // instantly with the lite brain and let the real model take over on later turns.
  const full = brain.ready && !brain.usingStub;
  const loadingFullModel = !brain.ready;   // WebGPU model still warming up

  // Snapshot recent history BEFORE adding the empty assistant bubble (keeps
  // context + memory bounded on mobile and avoids sending an empty turn).
  const history = state.messages.filter(m => m.role !== 'system').slice(-8);
  if (override){
    if (history.length && history[history.length - 1].role === 'user')
      history[history.length - 1] = { role: 'user', content: override };
    else
      history.push({ role: 'user', content: override });
  }

  // Adaptive length: short budget for simple chat, larger for complex asks.
  const lastUser = [...state.messages].reverse().find(m => m.role === 'user');
  const maxTokens = estimateMaxTokens(lastUser?.content || override || '');

  const lang = getLang();
  const bubble = addMessage('assistant', '');
  try{
    let streamed = false;
    for await (const tok of (full ? brain.reply(history, { maxTokens, lang }) : brain.replyLite(history, lang))){
      bubble.el.textContent += tok;
      bubble.content += tok;
      scrollTranscript();
      if (!state.aiVoiceMuted) voice.enqueueToken(tok);
      if (!streamed){ streamed = true; setStatus(t('st.responding')); }
    }
    if (!state.aiVoiceMuted) voice.flush();
    if (!bubble.content.trim()) bubble.el.textContent = '(no response — see status)';
    // Let the user know — once — that this was a quick answer while the full
    // model is still loading (not shown when the device is permanently lite).
    if (loadingFullModel && !state.warmNoteShown){
      state.warmNoteShown = true;
      bubble.el.textContent += t('warmNote');
    }
    setMode('awake');
    setStatus(brain.ready ? t('st.listen') : t('st.listenLoading'));
  }catch(e){
    bubble.el.textContent += ` [error: ${e.message}]`;
    setMode('awake'); setStatus(t('st.listen'));
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
    if (!ok){ announce(t('ack.handUnavailable')); stopCamera(); return; }
    state.cameraControl = true;
    el.video.classList.add('detecting');             // play hidden for detection
    el.handOverlay.classList.remove('hidden');
    hands.start();
    announce(t('ack.handEnabled'));
  }catch(e){ announce(t('ack.noCamera')); }
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
    setStatus(t('st.analysing'));
    const summary = await v.analyze(el.video);
    addMessage('user', question);
    const prompt = `Camera vision reports: ${summary}. The user asks: "${question}". Answer concisely.`;
    await generateReply(prompt);
  }catch(e){ announce(t('ack.cantAnalyze')); }
}

async function onFile(e){
  const file = e.target.files?.[0]; if (!file) return;
  el.fileInput.value = '';
  // An A.C.T.I.G. scene file (.json) → load it back into the 3D space to edit.
  if (/\.json$/i.test(file.name) || file.type === 'application/json'){
    try{
      const nodes = JSON.parse(await file.text());
      const s = await ensureScene(); setWorkspace('scene3D');
      announce(s.importJSON(nodes) ? t('ack.imported') : t('ack.fileError'));
    }catch(_){ announce(t('ack.fileError')); }
    return;
  }
  addMessage('user', `📎 ${file.name}`);
  try{
    const v = await getVision();
    const img = await loadImage(file);
    const summary = await v.analyze(img);
    await generateReply(`The user attached an image. Vision reports: ${summary}. Briefly describe it.`);
  }catch(_){ announce(t('ack.fileError')); }
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
    grow:()=>s.grow(), shrink:()=>s.shrink(), rotate:()=>s.rotate(), delete:()=>s.deleteSelected(),
    undo:()=>s.undo(), redo:()=>s.redo(), export:()=>exportModel(),
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
      .catch((e) => { announce(t('ack.engineFail')); throw e; });
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
