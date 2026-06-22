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

// Pick a model sized to the device's memory. iPhones have a tight per-tab memory
// budget in Safari, so a 1.5B model commonly OOM-crashes the page (the "A problem
// repeatedly occurred" reload loop). Use a small q4f32 model on phones (no
// shader-f16 requirement, much lower memory) and a larger one on iPad/desktop.
function pickModel(){
  const mem = (typeof navigator !== 'undefined' && navigator.deviceMemory) || 0;
  const minSide = (typeof screen !== 'undefined') ? Math.min(screen.width, screen.height) : 0;
  const roomy = mem >= 8 || minSide >= 768;   // iPad / desktop
  return roomy
    ? 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC'
    : 'Qwen2.5-0.5B-Instruct-q4f32_1-MLC';
}

// Crash-loop breaker: if loading the model crashed the tab (Safari OOM) two times
// in a row recently, skip it and run lite mode so the page stops reloading.
const FAIL_KEY = 'actig_llm_fails';
const FAIL_TS = 'actig_llm_fail_ts';

// Lightweight conversational fallback for lite mode (no full model). It can't
// truly reason, but it converses for common openers instead of just echoing.
function stubReply(t){
  const has = (...xs) => xs.some((x) => t.includes(x));
  if (!t.trim()) return 'I am here, sir. How may I help?';
  if (has('hello','hi ','hey','good morning','good evening','greetings')) return 'Hello, sir. Lovely to hear from you. How can I help today?';
  if (has('how are you','how do you do','how is it going')) return 'Running smoothly in lite mode, sir, and at your service. How are you?';
  if (has('thank')) return 'Always a pleasure, sir.';
  if (has('your name','who are you','what are you')) return 'I am A.C.T.I.G., sir — your on-device assistant.';
  if (has('joke')) return 'Why did the hologram go to therapy, sir? It had too many unresolved projections.';
  if (has('bye','goodnight','good night','see you')) return 'Goodbye for now, sir. Say “wake up ACTIG” whenever you need me.';
  if (t.endsWith('?')) return 'Good question, sir. My full reasoning model is in lite mode on this device — for richer answers, open it on an iPad or a WebGPU desktop. I can still run 3D, camera and voice commands now.';
  return 'Understood, sir. I am in lite mode here, so my conversation is limited — but commands like “bring up the 3D project”, “add a cube”, “scan this”, and the camera controls all work.';
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

    const modelId = pickModel();
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

  /** Async generator yielding token deltas. Respects abort(). */
  async *reply(messages){
    this._abort = new AbortController();
    const signal = this._abort.signal;

    if (this.usingStub){
      const last = ([...messages].reverse().find((m) => m.role === 'user')?.content || '').toLowerCase();
      const text = stubReply(last);
      for (const w of text.split(' ')){
        if (signal.aborted) return;
        await new Promise((r) => setTimeout(r, 35));
        yield w + ' ';
      }
      return;
    }

    const chat = [{ role:'system', content: SYSTEM_PROMPT },
                  ...messages.map((m) => ({ role: m.role, content: m.content }))];
    const stream = await this.engine.chat.completions.create({
      messages: chat, stream: true, temperature: 0.7, top_p: 0.9
    });
    for await (const chunk of stream){
      if (signal.aborted){ try{ await this.engine.interruptGenerate(); }catch{} return; }
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) yield delta;
    }
  }

  /** Interrupt the in-flight generation (barge-in). */
  abort(){
    this._abort?.abort();
    if (!this.usingStub){ try{ this.engine?.interruptGenerate?.(); }catch{} }
  }
}
