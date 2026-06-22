// On-device LLM brain for the browser.
//
// Primary: WebLLM (MLC) running a small quantized model on the GPU via WebGPU —
// fully offline after the one-time weight download (cached by WebLLM). iOS 18+
// Safari and iPadOS 18+ ship WebGPU, so this runs on iPhone and iPad.
//
// Fallback: a tiny echo engine so the whole UI/voice loop still works on devices
// without WebGPU. Generation is abortable (for barge-in interruption).

const SYSTEM_PROMPT =
  'You are A.C.T.I.G., a concise, capable on-device assistant. You speak in a ' +
  'calm, precise, Jarvis-like manner and address the user as "sir". Keep spoken ' +
  'answers short and natural unless asked for detail. You can open a 3D modelling ' +
  'workspace, enable camera-based hand controls, and analyse objects shown to the ' +
  'camera. You run fully offline and never claim access to other apps\' private data.';

// A compact, capable instruct model with broad device support.
const MODEL_ID = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';

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
      this._useStub('WebGPU unavailable on this browser');
      onProgress?.(1);
      return;
    }
    try{
      // Importing the library should be quick; if the CDN is blocked/slow this
      // would otherwise hang forever, so cap it and fall back to the stub.
      const webllm = await this._withTimeout(import('@mlc-ai/web-llm'), 30000, 'web-llm import timed out');
      // The weight download can be large; allow up to 5 minutes but no longer.
      this.engine = await this._withTimeout(
        webllm.CreateMLCEngine(MODEL_ID, { initProgressCallback: (r) => onProgress?.(r.progress ?? 0) }),
        300000, 'model load timed out'
      );
      this.ready = true;
      this.displayName = 'WebLLM · Qwen2.5-1.5B';
    }catch(err){
      console.warn('WebLLM load failed, using stub:', err);
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
      const last = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
      const text = `A.C.T.I.G. stub here, sir. I received: "${last}". Enable WebGPU or load the model for full reasoning.`;
      for (const w of text.split(' ')){
        if (signal.aborted) return;
        await new Promise((r) => setTimeout(r, 40));
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
