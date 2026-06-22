// Voice subsystem: text-to-speech (Jarvis voice), speech-to-text, barge-in and
// wake-word. On iOS Safari the Web Speech *recognition* API is unavailable, so we
// run on-device Whisper (transformers.js) with energy-based voice activity
// detection. On browsers that expose webkitSpeechRecognition we use it directly.

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
    this._ttsStartedAt = 0;
    this._useWebSpeech = ('SpeechRecognition' in window) || ('webkitSpeechRecognition' in window);
    this._recognition = null;

    this._pickVoice();
    if (this.tts) this.tts.onvoiceschanged = () => this._pickVoice();
  }

  _pickVoice(){
    const voices = this.tts ? this.tts.getVoices() : [];
    this.voice = voices.find(v => /en-GB/i.test(v.lang) && /Daniel|Arthur|male/i.test(v.name))
      || voices.find(v => /en-GB/i.test(v.lang))
      || voices.find(v => /^en/i.test(v.lang))
      || voices[0] || null;
  }

  // ---- TTS ----
  speak(text){
    if (this.muted || !this.tts || !text.trim()) return;
    const u = new SpeechSynthesisUtterance(text.trim());
    if (this.voice) u.voice = this.voice;
    u.rate = 1.04;          // brisk, attentive
    u.pitch = 0.9;          // slightly lowered, mechanical
    u.onstart = () => { this.speaking = true; this._ttsStartedAt = performance.now(); };
    u.onend = () => { if (!this.tts.speaking) this.speaking = false; };
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
    this.speaking = false;
  }

  // ---- STT ----
  async startListening({ onPartial, onFinal, onSpeechStart }){
    this.onPartial = onPartial; this.onFinal = onFinal; this.onSpeechStart = onSpeechStart;
    if (this.listening) return;
    this.listening = true;

    if (this._useWebSpeech){ this._startWebSpeech(); return; }
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
    r.continuous = true; r.interimResults = true; r.lang = 'en-US';
    let sawSpeech = false;
    r.onresult = (e) => {
      let interim = '', final = '';
      for (let i = e.resultIndex; i < e.results.length; i++){
        const tr = e.results[i];
        if (tr.isFinal) final += tr[0].transcript; else interim += tr[0].transcript;
      }
      if ((interim || final) && !sawSpeech){ sawSpeech = true; this.onSpeechStart?.(); }
      if (interim) this.onPartial?.(interim);
      if (final){ this.onFinal?.(final.trim()); sawSpeech = false; }
    };
    r.onend = () => { if (this.listening){ try{ r.start(); }catch{} } };
    try{ r.start(); }catch{}
    this._recognition = r;
  }

  async _startWhisper(){
    try{
      if (!this._asr){
        const { pipeline } = await import('@huggingface/transformers');
        const device = ('gpu' in navigator) ? 'webgpu' : 'wasm';
        this._asr = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', { device });
      }
      this._stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this._ac = new (window.AudioContext || window.webkitAudioContext)();
      const source = this._ac.createMediaStreamSource(this._stream);
      const analyser = this._ac.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      const data = new Float32Array(analyser.fftSize);

      const loop = () => {
        if (!this.listening) return;
        analyser.getFloatTimeDomainData(data);
        let sum = 0; for (let i=0;i<data.length;i++) sum += data[i]*data[i];
        const rms = Math.sqrt(sum / data.length);

        // Use a higher threshold while ACTIG is talking to avoid echo barge-in.
        const sinceTTS = performance.now() - this._ttsStartedAt;
        const thresh = (this.speaking && sinceTTS > 400) ? 0.05 : 0.02;
        const now = performance.now();

        if (rms > thresh){
          this._lastVoice = now;
          if (!this._capturing){ this._beginSegment(); this.onSpeechStart?.(); }
        } else if (this._capturing && now - this._lastVoice > 700){
          this._endSegment();
        }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }catch(err){
      console.warn('Whisper STT unavailable:', err);
      this.listening = false;   // voice input off; text + TTS still work
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
    if (!this._chunks.length || !this._asr) return;
    try{
      const blob = new Blob(this._chunks, { type: this._recorder.mimeType || 'audio/webm' });
      const buf = await blob.arrayBuffer();
      const decoded = await this._ac.decodeAudioData(buf);
      const pcm = this._resampleTo16k(decoded);
      const out = await this._asr(pcm);
      const text = (out?.text || '').trim();
      if (text){ this.onPartial?.(text); this.onFinal?.(text); }
    }catch(e){ console.warn('transcribe failed', e); }
  }

  _resampleTo16k(audioBuffer){
    const src = audioBuffer.getChannelData(0);
    const ratio = audioBuffer.sampleRate / 16000;
    const len = Math.floor(src.length / ratio);
    const out = new Float32Array(len);
    for (let i=0;i<len;i++) out[i] = src[Math.floor(i*ratio)];
    return out;
  }
}

// Wake / sleep phrase detection over any transcript.
export function checkWakeSleep(transcript){
  const t = (transcript||'').toLowerCase();
  if (/wake up act/.test(t)) return 'wake';
  if (/shut down all systems|shutdown all systems/.test(t)) return 'sleep';
  return null;
}
