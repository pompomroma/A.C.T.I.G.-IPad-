// On-device LLM brain for the browser.
//
// Primary: WebLLM (MLC) running a small quantized model on the GPU via WebGPU —
// fully offline after the one-time weight download (cached by WebLLM). iOS 18+
// Safari and iPadOS 18+ ship WebGPU, so this runs on iPhone and iPad.
//
// Fallback: a tiny echo engine so the whole UI/voice loop still works on devices
// without WebGPU. Generation is abortable (for barge-in interruption).

const SYSTEM_PROMPT =
  'You are A.C.T.I.G., a warm, witty, and helpful AI assistant with a calm, ' +
  'precise, Jarvis-like manner who addresses the user as "sir". Hold natural, ' +
  'human-like everyday conversation: chat, answer questions, give opinions, joke, ' +
  'and help with anything — you are not limited to commands. Keep replies concise ' +
  'and spoken-friendly unless asked for detail. You can also open a 3D modelling ' +
  'workspace, enable camera hand controls, and analyse objects shown to the ' +
  'camera. You run on-device and never claim access to other apps\' private data.';

// AUTO model-size selector. Inspects the real WebGPU adapter (memory tier +
// shader-f16 support) and the reported device memory, then picks the largest
// model the device can safely run. It is deliberately conservative on Safari
// (which doesn't expose navigator.deviceMemory): iOS devices — including the 4 GB
// 10th-gen iPad — get the small model so they don't OOM-crash, while roomy
// desktops/Android get the larger one. f16 variants are chosen when the GPU
// supports shader-f16 (smaller + faster), else f32 variants for compatibility.
async function chooseModel(){
  let f16 = false, maxBuf = 0;
  try{
    const adapter = await navigator.gpu.requestAdapter();
    f16 = !!(adapter && adapter.features && adapter.features.has('shader-f16'));
    maxBuf = (adapter && adapter.limits && adapter.limits.maxStorageBufferBindingSize) || 0;
  }catch{}

  const mem = (typeof navigator !== 'undefined' && navigator.deviceMemory) || 0;
  // "Roomy" only when the platform actually reports lots of RAM (desktops,
  // some Android) OR the GPU advertises a very large storage buffer (>= 1 GiB).
  const roomy = mem >= 8 || maxBuf >= (1 << 30);

  if (roomy) return f16 ? 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC' : 'Qwen2.5-1.5B-Instruct-q4f32_1-MLC';
  return f16 ? 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC' : 'Qwen2.5-0.5B-Instruct-q4f32_1-MLC';
}

// Crash-loop breaker: if loading the model crashed the tab (Safari OOM) two times
// in a row recently, skip it and run lite mode so the page stops reloading.
const FAIL_KEY = 'actig_llm_fails';
const FAIL_TS = 'actig_llm_fail_ts';

// Evaluate a simple arithmetic request ("what is 12 times 7", "3 + 4 * 2").
// Only ever runs after the string is reduced to digits/operators, so it is safe.
function tryMath(t){
  const s = t
    .replace(/\bplus\b/g, '+').replace(/\bminus\b/g, '-')
    .replace(/\b(?:times|multiplied by|x)\b/g, '*')
    .replace(/\b(?:divided by|over)\b/g, '/');
  const m = s.match(/-?\d+(?:\.\d+)?(?:\s*[-+*/]\s*-?\d+(?:\.\d+)?)+/);
  if (!m) return null;
  const expr = m[0];
  if (!/^[\d\s.+\-*/()]+$/.test(expr)) return null;
  try{
    const val = Function('"use strict";return (' + expr + ')')();
    if (typeof val === 'number' && isFinite(val)){
      const out = Number.isInteger(val) ? val : Number(val.toFixed(6));
      return `That is ${out}, sir.`;
    }
  }catch{}
  return null;
}

// Lightweight conversational fallback for lite mode (no full model). It can't
// truly reason, but it handles small talk, the time/date, arithmetic and "what
// can you do" so the assistant still understands and acts on common requests
// instead of returning a single canned line.
function stubReply(t){
  const has = (...xs) => xs.some((x) => t.includes(x));
  if (!t.trim()) return 'I am here, sir. How may I help?';

  // Deterministic facts the device can answer perfectly even offline.
  if (has('what time','the time','time is it','current time'))
    return `It is ${new Date().toLocaleTimeString()}, sir.`;
  if (has('what day','what date','the date','today\'s date','what is today','what\'s today'))
    return `Today is ${new Date().toLocaleDateString(undefined, { weekday:'long', year:'numeric', month:'long', day:'numeric' })}, sir.`;
  const math = tryMath(t);
  if (math) return math;

  if (has('hello','hi ','hey','good morning','good afternoon','good evening','greetings')) return 'Hello, sir. Lovely to hear from you. How can I help today?';
  if (has('how are you','how do you do','how is it going','how are things')) return 'Running smoothly, sir, and at your service. How are you?';
  if (has('thank')) return 'Always a pleasure, sir.';
  if (has('your name','who are you','what are you')) return 'I am A.C.T.I.G., sir — your on-device assistant.';
  if (has('what can you do','what do you do','your features','capabilities','help me','how do i use'))
    return 'I can chat with you, open a 3D modelling space and build or edit shapes by voice and touch, enable camera hand control, and analyse objects through the camera, sir. On a device with WebGPU I also run a full reasoning model for richer conversation.';
  if (has('joke')) return 'Why did the hologram go to therapy, sir? It had too many unresolved projections.';
  if (has('bye','goodnight','good night','see you')) return 'Goodbye for now, sir. Say “wake up ACTIG” whenever you need me.';
  if (has('yes','yeah','sure','okay','ok ','correct','right')) return 'Very good, sir.';
  if (has('no','nope','not really')) return 'Understood, sir. What would you prefer?';

  if (t.endsWith('?')) return 'A fair question, sir. My full reasoning model is in lite mode on this device — for a detailed answer, open A.C.T.I.G. on an iPad or a WebGPU-capable browser. Meanwhile I can tell the time and date, do arithmetic, and run the 3D, camera and voice features.';
  return `Noted, sir — “${t.length > 60 ? t.slice(0, 60) + '…' : t}”. I am in lite mode here so my free conversation is limited, but commands like “bring up the 3D project”, “add a cube”, “scan this” and the camera controls all work, and I can handle the time, date and quick maths.`;
}

// Estimate a generation token budget from the user's request so simple chat
// stays snappy while genuinely complex asks get room to answer fully. Short
// greetings/commands get a small cap (fast first reply + quick TTS); long or
// reasoning-heavy prompts get a large one.
export function estimateMaxTokens(text){
  const t = (text || '').toLowerCase();
  const words = t.trim().split(/\s+/).filter(Boolean).length;
  const complex = /\b(explain|detail|elaborate|why|how (do|does|to|can)|step by step|in depth|compare|difference|list|write|code|program|essay|story|plan|describe|analy|summar|reasons?|pros and cons)\b/.test(t);
  if (complex || words >= 40) return 768;
  if (words >= 16) return 384;
  if (words <= 6) return 128;
  return 220;
}

export class Brain {
  constructor(){
    this.engine = null;
    this.ready = false;
    this.displayName = 'loading…';
    this.usingStub = false;
    this._abort = null;
  }

  static webgpuAvailable(){ return typeof navigator !== 'undefined' && 'gpu' in navigator; }

  _withTimeout(promise, ms, label){
    return Promise.race([
      promise,
      new Promise((_, rej) => setTimeout(() => rej(new Error(label || 'timed out')), ms)),
    ]);
  }

  async load(onProgress){
    if (!Brain.webgpuAvailable()){
      this._useStub('WebGPU unavailable — lite mode');
      onProgress?.(1);
      return;
    }

    // Crash-loop guard: forget failures older than 30 min, then bail to lite mode
    // after 2 recent crashes so the tab stops OOM-reloading.
    const now = Date.now();
    const lastTs = +(localStorage.getItem(FAIL_TS) || 0);
    let fails = +(localStorage.getItem(FAIL_KEY) || 0);
    if (now - lastTs > 30 * 60 * 1000) fails = 0;
    if (fails >= 2){
      this._useStub('lite mode (model disabled after repeated reloads)');
      onProgress?.(1);
      return;
    }
    // Mark the attempt *before* loading. If the tab crashes mid-load this value
    // survives; a clean success or a caught error resets it below.
    try{ localStorage.setItem(FAIL_KEY, String(fails + 1)); localStorage.setItem(FAIL_TS, String(now)); }catch{}

    const modelId = await chooseModel();
    try{
      const webllm = await this._withTimeout(import('@mlc-ai/web-llm'), 30000, 'web-llm import timed out');
      this.engine = await this._withTimeout(
        webllm.CreateMLCEngine(modelId, { initProgressCallback: (r) => onProgress?.(r.progress ?? 0) }),
        300000, 'model load timed out'
      );
      this.ready = true;
      this.displayName = 'WebLLM · ' + modelId.replace(/-MLC$/, '');
      try{ localStorage.setItem(FAIL_KEY, '0'); }catch{}   // success resets the counter
    }catch(err){
      console.warn('WebLLM load failed, using stub:', err);
      try{ localStorage.setItem(FAIL_KEY, '0'); }catch{}   // graceful error (not a crash) — don't penalize
      this._useStub(err?.message || 'model load failed');
    }
    onProgress?.(1);
  }

  _useStub(reason){
    this.usingStub = true;
    this.ready = true;
    this.displayName = 'offline stub (' + reason + ')';
  }

  /** Async generator yielding token deltas. Respects abort().
   *  `opts.maxTokens` bounds the reply length (adaptive — set by the caller). */
  async *reply(messages, opts = {}){
    if (this.usingStub){ yield* this.replyLite(messages); return; }

    this._abort = new AbortController();
    const signal = this._abort.signal;

    const chat = [{ role:'system', content: SYSTEM_PROMPT },
                  ...messages.map((m) => ({ role: m.role, content: m.content }))];
    const stream = await this.engine.chat.completions.create({
      messages: chat, stream: true, temperature: 0.7, top_p: 0.9,
      max_tokens: opts.maxTokens || 384,
    });
    for await (const chunk of stream){
      if (signal.aborted){ try{ await this.engine.interruptGenerate(); }catch{} return; }
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) yield delta;
    }
  }

  /** Instant lite reply (rule-based). Always available — used both as the no-GPU
   *  fallback and to answer immediately while the full model is still loading. */
  async *replyLite(messages){
    this._abort = new AbortController();
    const signal = this._abort.signal;
    const last = ([...messages].reverse().find((m) => m.role === 'user')?.content || '').toLowerCase();
    for (const w of stubReply(last).split(' ')){
      if (signal.aborted) return;
      await new Promise((r) => setTimeout(r, 12));
      yield w + ' ';
    }
  }

  /** Interrupt the in-flight generation (barge-in). */
  abort(){
    this._abort?.abort();
    if (!this.usingStub){ try{ this.engine?.interruptGenerate?.(); }catch{} }
  }
}
