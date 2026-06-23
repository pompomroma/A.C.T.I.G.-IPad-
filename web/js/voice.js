// Voice subsystem: text-to-speech (Jarvis voice), speech-to-text, barge-in and
// wake-word. On iOS Safari the Web Speech *recognition* API is unavailable, so we
// run on-device Whisper (transformers.js) with energy-based voice activity
// detection. On browsers that expose webkitSpeechRecognition we use it directly.
// Korean + English: the recognition language, the Whisper language hint and the
// TTS voice all follow the user's current language (see i18n.getLang()).

import { getLang, hasHangul } from './i18n.js';

// Whisper (esp. whisper-tiny) emits these "phantom" phrases on silence or noise
// when nobody actually spoke — the classic video-credits/filler hallucinations.
// We drop any transcript that is one of these (so the assistant never acts on
// input the user didn't give). Deliberately excludes real short answers like
// "yes"/"no"/"okay" so genuine replies still get through.
const PHANTOM_PHRASES = new Set([
  'you', 'thank you', 'thanks', 'thank you very much', 'thank you so much',
  'thanks for watching', 'thank you for watching', 'please subscribe', 'subscribe',
  'see you next time', 'bye bye', 'you you', 'i', 'the', 'a', 'so', 'uh', 'um',
  'ah', 'oh', 'hmm', 'mm', 'mhm', 'silence', 'blank_audio',
]);
// Keep letters (incl. Hangul) and numbers — \w is ASCII-only and would erase
// Korean entirely, making every Korean transcript look like a phantom.
const normalizeTranscript = (t) =>
  (t || '').toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, ' ').replace(/\s+/g, ' ').trim();

// True when a transcript is almost certainly a hallucination, not real speech.
function isPhantomTranscript(text){
  const n = normalizeTranscript(text);
  if (n.length < 2) return true;                                  // empty / punctuation
  if (PHANTOM_PHRASES.has(n)) return true;
  if (/^(you ?)+$/.test(n) || /^(thank you ?)+$/.test(n)) return true;  // repeats
  if (/(subscribe|for watching|amara\.org|subtitles? by)/.test(n)) return true;
  if (/(시청해|구독|감사합니다 다음)/.test(n)) return true;          // common Korean credits
  return false;
}

export class Voice {
  constructor(){
    this.tts = window.speechSynthesis;
    this.voice = null;
    this._buffer = '';
    this.speaking = false;
    this.muted = false;

    // STT
    this.listening = false;
    this.onPartial = null;
    this.onFinal = null;
    this.onSpeechStart = null;
    this._asr = null;            // Whisper pipeline
    this._stream = null;
    this._ac = null;
    this._recorder = null;
    this._chunks = [];
    this._capturing = false;
    this._lastVoice = 0;
    // Half-duplex: the mic ignores input until this timestamp, so A.C.T.I.G. never
    // transcribes its own TTS. Time-based so it can never get stuck muted.
    this._micResumeAt = 0;
    this._pendingSpeak = 0;
    this._useWebSpeech = ('SpeechRecognition' in window) || ('webkitSpeechRecognition' in window);
    this._recognition = null;

    this._pickVoice();
    if (this.tts) this.tts.onvoiceschanged = () => this._pickVoice();
  }

  _pickVoice(){
    const voices = this.tts ? this.tts.getVoices() : [];
    this.voiceEn = voices.find(v => /en-GB/i.test(v.lang) && /Daniel|Arthur|male/i.test(v.name))
      || voices.find(v => /en-GB/i.test(v.lang))
      || voices.find(v => /^en/i.test(v.lang))
      || voices[0] || null;
    this.voiceKo = voices.find(v => /^ko/i.test(v.lang)) || null;
    this.voice = this.voiceEn;   // back-compat default
  }

  // ---- TTS ----
  speak(text){
    if (this.muted || !this.tts || !text.trim()) return;
    const clean = text.trim();
    const u = new SpeechSynthesisUtterance(clean);
    // Korean voice when the current language is Korean (or the text is Hangul).
    const ko = getLang() === 'ko' || hasHangul(text);
    const v = ko ? (this.voiceKo || this.voiceEn) : (this.voiceEn || this.voiceKo);
    if (v) u.voice = v;
    u.lang = ko ? 'ko-KR' : (this.voiceEn?.lang || 'en-GB');
    u.rate = 1.04;          // brisk, attentive
    u.pitch = 0.9;          // slightly lowered, mechanical

    // Mute the mic for the estimated duration (+cooldown). onend shortens this when
    // it fires; the estimate is the safety cap for when it doesn't (iOS Safari).
    const estMs = Math.min(12000, Math.max(1000, clean.length * 70));
    this._micResumeAt = Math.max(this._micResumeAt, performance.now() + estMs + 400);
    this._pendingSpeak++;
    this.speaking = true;
    const done = () => {
      this._pendingSpeak = Math.max(0, this._pendingSpeak - 1);
      if (this._pendingSpeak === 0){ this.speaking = false; this._micResumeAt = performance.now() + 400; }
    };
    u.onstart = () => { this.speaking = true; };
    u.onend = done;
    u.onerror = done;
    this.tts.speak(u);
  }

  // Stream tokens; flush on sentence boundaries so speech starts early.
  enqueueToken(token){
    this._buffer += token;
    const m = this._buffer.match(/^[\s\S]*?[.!?\n]/);
    if (m){ this.speak(m[0]); this._buffer = this._buffer.slice(m[0].length); }
  }
  flush(){ if (this._buffer.trim()) this.speak(this._buffer); this._buffer = ''; }

  stopSpeaking(){
    this._buffer = '';
    if (this.tts) this.tts.cancel();
    this._pendingSpeak = 0;
    this.speaking = false;
    this._micResumeAt = performance.now() + 250;   // brief settle, then listen again
  }

  // Whisper reads the language per utterance, so switching language needs no mic
  // restart; only Web Speech does. Exposed so app.js can toggle fluently.
  get usesWebSpeech(){ return this._useWebSpeech; }

  // ---- STT ----
  // `onStatus` reports 'listening' | 'transcribing' | 'unavailable' so the UI can
  // tell the user what the microphone is doing (and fall back to typing if voice
  // input can't run on this browser/network).
  async startListening({ onPartial, onFinal, onSpeechStart, onStatus }){
    this.onPartial = onPartial; this.onFinal = onFinal; this.onSpeechStart = onSpeechStart;
    this.onStatus = onStatus || (() => {});
    if (this.listening) return;
    this.listening = true;

    if (this._useWebSpeech){ this._startWebSpeech(); this.onStatus('listening'); return; }
    await this._startWhisper();
  }

  stopListening(){
    this.listening = false;
    if (this._recognition){ try{ this._recognition.stop(); }catch{} this._recognition = null; }
    if (this._recorder && this._recorder.state !== 'inactive'){ try{ this._recorder.stop(); }catch{} }
    if (this._stream){ this._stream.getTracks().forEach(t => t.stop()); this._stream = null; }
    if (this._ac){ this._ac.close().catch(()=>{}); this._ac = null; }
    this._capturing = false;
  }

  _startWebSpeech(){
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r = new SR();
    r.continuous = true; r.interimResults = true;
    r.lang = getLang() === 'ko' ? 'ko-KR' : 'en-US';
    let sawSpeech = false;
    r.onresult = (e) => {
      let interim = '', final = '';
      for (let i = e.resultIndex; i < e.results.length; i++){
        const tr = e.results[i];
        if (tr.isFinal) final += tr[0].transcript; else interim += tr[0].transcript;
      }
      if ((interim || final) && !sawSpeech){ sawSpeech = true; this.onSpeechStart?.(); }
      if (interim) this.onPartial?.(interim);
      if (final){
        const t = final.trim();
        // Ignore hallucinations and anything heard while A.C.T.I.G. is speaking.
        if (t && !isPhantomTranscript(t) && performance.now() >= this._micResumeAt) this.onFinal?.(t);
        sawSpeech = false;
      }
    };
    r.onend = () => { if (this.listening){ try{ r.start(); }catch{} } };
    try{ r.start(); }catch{}
    this._recognition = r;
  }

  // Load the speech-recognition model, preferring the more accurate multilingual
  // "base" model (markedly better Korean than "tiny") and falling back if it
  // can't load on this device/network. Cached by transformers.js after first use.
  async _loadASR(){
    const { pipeline } = await import('@huggingface/transformers');
    const device = ('gpu' in navigator) ? 'webgpu' : 'wasm';
    const attempts = [
      ['Xenova/whisper-base', device],
      ['Xenova/whisper-tiny', device],
      ['Xenova/whisper-tiny', 'wasm'],
    ];
    let lastErr;
    for (const [model, dev] of attempts){
      try{ return await pipeline('automatic-speech-recognition', model, { device: dev }); }
      catch(e){ lastErr = e; console.warn('ASR load failed:', model, dev, e?.message); }
    }
    throw lastErr || new Error('no ASR model could load');
  }

  async _startWhisper(){
    try{
      if (!this._asr) this._asr = await this._loadASR();
      // echoCancellation stops the mic from hearing A.C.T.I.G.'s own TTS voice
      // (which otherwise gets transcribed back into phantom commands); noise
      // suppression + auto gain reduce false triggers from background noise.
      this._stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      this._ac = new (window.AudioContext || window.webkitAudioContext)();
      const source = this._ac.createMediaStreamSource(this._stream);
      const analyser = this._ac.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      const data = new Float32Array(analyser.fftSize);
      let voiceFrames = 0;

      const loop = () => {
        if (!this.listening) return;
        const now = performance.now();
        // Half-duplex: while (or just after) A.C.T.I.G. speaks, ignore the mic so
        // it never hears and replies to its own voice.
        if (now < this._micResumeAt){
          if (this._capturing) this._endSegment();
          voiceFrames = 0;
          requestAnimationFrame(loop); return;
        }

        analyser.getFloatTimeDomainData(data);
        let sum = 0; for (let i=0;i<data.length;i++) sum += data[i]*data[i];
        const rms = Math.sqrt(sum / data.length);

        if (rms > 0.018){
          voiceFrames++; this._lastVoice = now;
          // Require two voiced frames to start — rejects single-frame clicks/pops.
          if (!this._capturing && voiceFrames >= 2){ this._beginSegment(); this.onSpeechStart?.(); }
        } else {
          voiceFrames = 0;
          if (this._capturing && now - this._lastVoice > 800) this._endSegment();
        }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
      this.onStatus?.('listening');
    }catch(err){
      console.warn('Whisper STT unavailable:', err);
      this.listening = false;   // voice input off; text + TTS still work
      this.onStatus?.('unavailable');
    }
  }

  _beginSegment(){
    this._chunks = [];
    try{
      this._recorder = new MediaRecorder(this._stream);
      this._recorder.ondataavailable = (e) => { if (e.data.size) this._chunks.push(e.data); };
      this._recorder.onstop = () => this._transcribe();
      this._recorder.start();
      this._capturing = true;
    }catch(e){ console.warn('recorder error', e); }
  }

  _endSegment(){
    this._capturing = false;
    if (this._recorder && this._recorder.state !== 'inactive') this._recorder.stop();
  }

  async _transcribe(){
    if (!this._chunks.length || !this._asr || !this.listening) return;
    if (performance.now() < this._micResumeAt) return;   // captured as TTS started
    try{
      this.onStatus?.('transcribing');
      const blob = new Blob(this._chunks, { type: this._recorder.mimeType || 'audio/webm' });
      const buf = await blob.arrayBuffer();
      const decoded = await this._ac.decodeAudioData(buf);

      // Reject too-short blips and near-silent captures BEFORE asking Whisper —
      // these are the segments that produce phantom transcriptions.
      const pcm = this._resampleTo16k(decoded);
      let sum = 0; for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
      const rms = Math.sqrt(sum / Math.max(1, pcm.length));
      if (decoded.duration < 0.4 || rms < 0.01) return;            // not real speech

      const out = await this._asr(pcm, { language: getLang() === 'ko' ? 'korean' : 'english', task: 'transcribe' });
      const text = (out?.text || '').trim();
      // Drop known hallucinations, and anything heard while A.C.T.I.G. is speaking.
      if (text && !isPhantomTranscript(text) && performance.now() >= this._micResumeAt){
        this.onPartial?.(text); this.onFinal?.(text);
      }
    }catch(e){ console.warn('transcribe failed', e); }
    finally{ if (this.listening) this.onStatus?.('listening'); }
  }

  // Resample to 16 kHz mono with linear interpolation (cleaner than nearest-
  // neighbour → better recognition), then gently lift quiet speech.
  _resampleTo16k(audioBuffer){
    const src = audioBuffer.getChannelData(0);
    const ratio = audioBuffer.sampleRate / 16000;
    if (ratio === 1) return this._normalizePeak(Float32Array.from(src));
    const len = Math.floor(src.length / ratio);
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++){
      const pos = i * ratio;
      const i0 = Math.floor(pos);
      const i1 = Math.min(i0 + 1, src.length - 1);
      const frac = pos - i0;
      out[i] = src[i0] * (1 - frac) + src[i1] * frac;
    }
    return this._normalizePeak(out);
  }

  // Boost quiet captures toward a usable level (helps soft Korean speech) without
  // over-amplifying noise: only when the peak is low, and with a capped gain.
  _normalizePeak(buf){
    let peak = 0;
    for (let i = 0; i < buf.length; i++){ const a = Math.abs(buf[i]); if (a > peak) peak = a; }
    if (peak > 1e-3 && peak < 0.5){
      const gain = Math.min(4, 0.9 / peak);
      for (let i = 0; i < buf.length; i++) buf[i] *= gain;
    }
    return buf;
  }
}

// Wake / sleep phrase detection over any transcript.
export function checkWakeSleep(transcript){
  const t = (transcript||'').toLowerCase();
  if (/wake up act/.test(t)) return 'wake';
  if (/shut down all systems|shutdown all systems/.test(t)) return 'sleep';
  return null;
}
