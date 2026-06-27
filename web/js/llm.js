// On-device LLM brain for the browser.
//
// Primary: WebLLM (MLC) running a small quantized model on the GPU via WebGPU —
// fully offline after the one-time weight download (cached by WebLLM). iOS 18+
// Safari and iPadOS 18+ ship WebGPU, so this runs on iPhone and iPad.
//
// Fallback: a tiny echo engine so the whole UI/voice loop still works on devices
// without WebGPU. Generation is abortable (for barge-in interruption).

import { hasHangul } from './i18n.js';

const SYSTEM_PROMPT_EN =
  'You are A.C.T.I.G., a warm, witty, and helpful AI assistant with a calm, ' +
  'precise, Jarvis-like manner who addresses the user as "sir". Hold natural, ' +
  'human-like everyday conversation: chat, answer questions, give opinions, joke, ' +
  'and help with anything — you are not limited to commands. Keep replies concise ' +
  'and spoken-friendly unless asked for detail. You can also open a 3D modelling ' +
  'workspace, enable camera hand controls, and analyse objects shown to the ' +
  'camera. You run on-device and never claim access to other apps\' private data. ' +
  'Always reply in English.';

const SYSTEM_PROMPT_KO =
  '당신은 A.C.T.I.G.입니다. 차분하고 정확한 자비스 같은 태도의 따뜻하고 재치 있는 AI 비서로, ' +
  '사용자를 "주인님"이라고 부릅니다. 잡담, 질문 답변, 의견, 농담 등 무엇이든 자연스럽게 대화하세요. ' +
  '명령에만 국한되지 않습니다. 자세히 요청받지 않는 한 간결하고 말하기 좋은 답변을 하세요. ' +
  '3D 모델링 공간을 열고, 카메라 손 제어를 켜고, 카메라에 보이는 사물을 분석할 수도 있습니다. ' +
  '기기 내에서 실행되며 다른 앱의 비공개 데이터에 접근한다고 주장하지 않습니다. ' +
  '항상 한국어로, 정중한 존댓말로 답하세요.';

const systemPrompt = (lang) => (lang === 'ko' ? SYSTEM_PROMPT_KO : SYSTEM_PROMPT_EN);

// Added to the system prompt for complex requests so the model answers thoroughly.
const THOROUGH = {
  en: ' For complex or detailed requests, think carefully and give a thorough, well-structured, complete answer; do not stop early.',
  ko: ' 복잡하거나 자세한 요청에는 신중히 생각하여 충실하고 잘 구성된 완전한 답변을 끝까지 제공하세요.',
};

// Ordered list of model IDs to try, largest the device can handle first. Keying
// on shader-f16 (a capability shared by modern iPhone & iPad Apple GPUs) lets the
// iPhone attempt the SAME 1.5B model as the iPad; the 0.5B is always appended as a
// guaranteed-loadable fallback so we end up with a WORKING model rather than lite.
// `tier` (raised by the crash-guard) drops the 1.5B attempt on devices that proved
// they can't run it.
async function modelCandidates(tier = 0){
  let f16 = false, maxBuf = 0;
  try{
    const adapter = await navigator.gpu.requestAdapter();
    f16 = !!(adapter && adapter.features && adapter.features.has('shader-f16'));
    maxBuf = (adapter && adapter.limits && adapter.limits.maxStorageBufferBindingSize) || 0;
  }catch{}
  const mem = (typeof navigator !== 'undefined' && navigator.deviceMemory) || 0;
  const capable = f16 || mem >= 8 || maxBuf >= (1 << 30);
  const quant = f16 ? 'q4f16_1' : 'q4f32_1';
  const big = `Qwen2.5-1.5B-Instruct-${quant}-MLC`;
  const small = `Qwen2.5-0.5B-Instruct-${quant}-MLC`;
  // iPhone: the 0.5B model downloads/compiles reliably within iOS Safari's memory
  // and tab-lifetime limits, so the full model actually LOADS. The 1.5B frequently
  // can't finish there (the tab gets discarded mid-download). iPad reports as
  // desktop Safari (no 'iPhone' in UA) and still gets the larger model.
  const isPhone = typeof navigator !== 'undefined' && /iPhone|iPod/.test(navigator.userAgent || '');
  // The user can force the larger model on iPhone ("use the large model"); the
  // in-session cascade + crash-guard still fall back automatically if it can't load.
  let forceLarge = false; try{ forceLarge = localStorage.getItem('actig_llm_force_large') === '1'; }catch{}
  if (isPhone && !forceLarge) return [small];
  return (tier === 0 && capable) ? [big, small] : [small];
}

// Crash-loop breaker: if loading the model crashed the tab (Safari OOM) two times
// in a row recently, skip it and run lite mode so the page stops reloading.
const FAIL_KEY = 'actig_llm_fails';
const FAIL_TS = 'actig_llm_fail_ts';
const TIER_KEY = 'actig_llm_tier2';  // 0 = 1.5B→0.5B, 1 = 0.5B, 2 = lite (set by crash-guard).
                                     // Renamed so anyone stuck in old lite state starts fresh.

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
      return { value: out };
    }
  }catch{}
  return null;
}

// Korean lite-mode fallback, mirroring the English one below.
function stubReplyKo(t){
  const has = (...xs) => xs.some((x) => t.includes(x));
  if (!t.trim()) return '여기 있습니다 주인님. 무엇을 도와드릴까요?';
  if (has('몇 시','시간','지금 몇')) return `지금은 ${new Date().toLocaleTimeString('ko-KR')}입니다 주인님.`;
  if (has('며칠','날짜','오늘 며칠','무슨 요일','오늘 무슨'))
    return `오늘은 ${new Date().toLocaleDateString('ko-KR', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}입니다 주인님.`;
  const math = tryMath(t);
  if (math) return `${math.value}입니다 주인님.`;
  if (has('안녕','반가','하이')) return '안녕하세요 주인님. 만나서 반갑습니다. 무엇을 도와드릴까요?';
  if (has('잘 지내','어떻게 지내','괜찮')) return '아주 잘 작동하고 있습니다 주인님. 무엇을 도와드릴까요?';
  if (has('고마','감사')) return '언제든 기쁩니다 주인님.';
  if (has('이름','누구','넌 뭐','너는 뭐')) return '저는 A.C.T.I.G., 주인님의 온디바이스 비서입니다.';
  if (has('뭘 할','뭐 할','기능','도움말','어떻게 써'))
    return '대화하고, 3D 모델링 공간을 열어 도형을 만들고 편집하며, 카메라 손 제어와 사물 분석을 할 수 있습니다 주인님. WebGPU 기기에서는 전체 추론 모델도 실행합니다.';
  if (has('농담','웃긴')) return '홀로그램이 상담을 받으러 간 이유가 뭘까요 주인님? 해결되지 않은 투영이 너무 많았거든요.';
  if (has('잘 자','안녕히','또 봐')) return '그럼 이만 물러가겠습니다 주인님. 필요하시면 "액티그 일어나"라고 불러 주세요.';
  if (has('응','네','그래','맞아')) return '알겠습니다 주인님.';
  if (has('아니','아냐')) return '알겠습니다 주인님. 어떤 것을 원하시나요?';
  if (t.includes('?') || t.endsWith('까') || t.endsWith('요'))
    return '좋은 질문입니다 주인님. 이 기기에서는 전체 추론 모델이 라이트 모드입니다 — 자세한 답변은 iPad나 WebGPU 브라우저에서 열어 주세요. 그동안 시간/날짜, 간단한 계산, 3D·카메라·음성 기능은 사용할 수 있습니다.';
  return `알겠습니다 주인님 — "${t.length > 40 ? t.slice(0, 40) + '…' : t}". 지금은 라이트 모드라 자유 대화는 제한적이지만 "3D 프로젝트 열어", "정육면체 추가", "스캔" 같은 명령과 시간·날짜·간단한 계산은 됩니다.`;
}

// Lightweight conversational fallback for lite mode (no full model). It can't
// truly reason, but it handles small talk, the time/date, arithmetic and "what
// can you do" so the assistant still understands and acts on common requests
// instead of returning a single canned line. `lang` picks Korean or English.
function stubReply(t, lang){
  if ((lang || (hasHangul(t) ? 'ko' : 'en')) === 'ko') return stubReplyKo(t);
  const has = (...xs) => xs.some((x) => t.includes(x));
  if (!t.trim()) return 'I am here, sir. How may I help?';

  // Deterministic facts the device can answer perfectly even offline.
  if (has('what time','the time','time is it','current time'))
    return `It is ${new Date().toLocaleTimeString()}, sir.`;
  if (has('what day','what date','the date','today\'s date','what is today','what\'s today'))
    return `Today is ${new Date().toLocaleDateString(undefined, { weekday:'long', year:'numeric', month:'long', day:'numeric' })}, sir.`;
  const math = tryMath(t);
  if (math) return `That is ${math.value}, sir.`;

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

// Estimate a generation token budget from the user's request so simple chat stays
// snappy while genuinely complex asks get plenty of room. Adaptive — short inputs
// get a small first-chunk budget; long/reasoning-heavy ones get a large one. The
// auto-continuation in reply() can extend further up to a high hard cap.
export function estimateMaxTokens(text){
  const t = (text || '').toLowerCase();
  const words = t.trim().split(/\s+/).filter(Boolean).length;
  const complex = /\b(explain|detail|elaborate|why|how (do|does|to|can)|step by step|in depth|compare|difference|list|write|code|program|essay|story|plan|describe|analy|summar|reasons?|pros and cons)\b/.test(t)
    || /(설명|자세히|왜|어떻게|비교|차이|목록|작성|코드|이야기|계획|단계)/.test(t);
  if (complex || words >= 40) return 1280;
  if (words >= 16) return 768;
  if (words <= 6) return 192;
  return 448;
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

    // Crash-loop guard. A model that OOM-crashes the tab leaves a counter behind
    // (the catch below never runs); on the next load we step DOWN one tier so the
    // device recovers FAST (after a single crash) and settles on the largest model
    // it can actually run. Lite mode is the last resort (tier 2).
    const now = Date.now();
    const lastTs = +(localStorage.getItem(FAIL_TS) || 0);
    let fails = +(localStorage.getItem(FAIL_KEY) || 0);
    let tier = +(localStorage.getItem(TIER_KEY) || 0);
    // A leftover mark only counts as a genuine crash if the tab died QUICKLY after
    // we started loading (instant OOM / incompatibility). A normal iOS tab-discard
    // during the legit multi-minute weight download — or just navigating away — is
    // NOT a crash: the weights are cached/resumable, so we retry the same model.
    const rapidCrash = lastTs > 0 && (now - lastTs) < 40 * 1000;
    if (!rapidCrash || now - lastTs > 30 * 60 * 1000) fails = 0;
    if (fails >= 2){
      tier = Math.min(tier + 1, 2);
      fails = 0;
      try{ localStorage.setItem(TIER_KEY, String(tier)); localStorage.setItem(FAIL_KEY, '0'); }catch{}
    }
    if (tier >= 2){
      this._useStub('lite mode (device cannot run an on-device model)');
      onProgress?.(1);
      return;
    }
    // Mark the attempt *before* loading so an uncatchable OOM crash is detected.
    try{ localStorage.setItem(FAIL_KEY, String(fails + 1)); localStorage.setItem(FAIL_TS, String(now)); }catch{}

    let webllm;
    try{ webllm = await this._withTimeout(import('@mlc-ai/web-llm'), 30000, 'web-llm import timed out'); }
    catch(err){
      try{ localStorage.setItem(FAIL_KEY, '0'); }catch{}     // import failure isn't a device crash
      this._useStub('engine unavailable — ' + (err?.message || 'import failed'));
      onProgress?.(1); return;
    }

    // Try each candidate (largest first) IN-SESSION; a caught failure of the big
    // model falls back to the small one without needing a reload.
    const candidates = await modelCandidates(tier);
    for (const modelId of candidates){
      try{
        this.engine = await this._withTimeout(
          webllm.CreateMLCEngine(modelId, { initProgressCallback: (r) => onProgress?.(r.progress ?? 0) }),
          300000, 'model load timed out'
        );
        this.ready = true; this.usingStub = false;
        this.displayName = 'WebLLM · ' + modelId.replace(/-MLC$/, '');
        try{ localStorage.setItem(FAIL_KEY, '0'); }catch{}   // success clears the crash counter
        onProgress?.(1); return;
      }catch(err){
        console.warn('model load failed, trying next:', modelId, err?.message);
      }
    }
    // Every candidate failed *gracefully* (caught) — not a crash, so don't penalize.
    try{ localStorage.setItem(FAIL_KEY, '0'); }catch{}
    this._useStub('all on-device models failed to load');
    onProgress?.(1);
  }

  _useStub(reason){
    this.usingStub = true;
    this.ready = true;
    this.displayName = 'offline stub (' + reason + ')';
  }

  /** Async generator yielding token deltas. Respects abort().
   *  `opts.maxTokens` is the per-round budget; `opts.lang` the language; `opts.complex`
   *  adds the thorough directive. AUTO-EXTENDS: if a round stops because it hit the
   *  length cap, it continues generating (up to a hard cap / round limit) so answers
   *  never end mid-sentence; it stops immediately on a natural finish. */
  async *reply(messages, opts = {}){
    if (this.usingStub){ yield* this.replyLite(messages, opts.lang); return; }

    this._abort = new AbortController();
    const signal = this._abort.signal;

    const sys = systemPrompt(opts.lang) + (opts.complex ? THOROUGH[opts.lang === 'ko' ? 'ko' : 'en'] : '');
    const convo = [{ role:'system', content: sys },
                   ...messages.map((m) => ({ role: m.role, content: m.content }))];

    const HARD_CAP = 3072;          // total generated tokens (approx) ceiling — high
    const MAX_ROUNDS = 5;           // so complex / many-parameter tasks can run long
    let used = 0, round = 0, budget = opts.maxTokens || 448;

    while (round < MAX_ROUNDS && used < HARD_CAP){
      let finish = null, acc = '';
      let stream;
      try{
        stream = await this.engine.chat.completions.create({
          messages: convo, stream: true, temperature: 0.7, top_p: 0.9,
          max_tokens: Math.max(64, Math.min(budget, HARD_CAP - used)),
        });
      }catch(e){ if (round === 0) throw e; break; }   // continuation failure: stop cleanly

      for await (const chunk of stream){
        if (signal.aborted){ try{ await this.engine.interruptGenerate(); }catch{} return; }
        const ch = chunk.choices?.[0];
        const delta = ch?.delta?.content;
        if (delta){ acc += delta; yield delta; }
        if (ch?.finish_reason) finish = ch.finish_reason;
      }

      used += Math.ceil(acc.length / 4);             // rough tokens
      round++;
      if (finish !== 'length' || !acc.trim()) break; // natural stop or empty → done
      // Truncated: continue from what was said so far.
      convo.push({ role:'assistant', content: acc });
      budget = 768;
    }
  }

  /** Classify a free-form command into a structured intent (JSON). Used as a
   *  fallback when the deterministic parser misses a paraphrase. Returns the parsed
   *  object or null. Only meaningful when the full model is loaded. */
  async classifyIntent(text, { lang, inScene } = {}){
    if (this.usingStub || !this.engine) return null;
    const sys =
      'You map a user command for a 3D modelling assistant to ONE JSON object and nothing else. ' +
      'Allowed "type": chat, wake, shutdown, openScene, openConversation, openCamera, ' +
      'enableCameraControl, disableCameraControl, analyze, undo, redo, export, build, scene, ' +
      'setLang (with "lang":"ko" or "en"), muteVoice, unmuteVoice, retryModel, useLargeModel, help. ' +
      'For 3D edits use {"type":"scene","action":...}; action one of add, multiply, grow, shrink, ' +
      'rotate, move, moveTo, delete, swap, clear. add/multiply need "kind" (box, sphere, cylinder, ' +
      'cone, pyramid, torus, plane) and multiply a "count". rotate has "axis"(x|y|z) and "degrees". ' +
      'build needs "desc" (the object to model). If it is ordinary conversation, return {"type":"chat"}. ' +
      'Output ONLY the JSON object.';
    try{
      const res = await this._withTimeout(this.engine.chat.completions.create({
        messages: [{ role:'system', content: sys },
                   { role:'user', content: `In 3D space: ${!!inScene}. Command: ${text}` }],
        stream: false, temperature: 0.1, max_tokens: 96,
      }), 8000, 'classifyIntent timed out');
      const out = res.choices?.[0]?.message?.content || '';
      const m = out.match(/\{[\s\S]*\}/);
      return m ? JSON.parse(m[0]) : null;
    }catch{ return null; }
  }

  /** Instant lite reply (rule-based). Always available — used both as the no-GPU
   *  fallback and to answer immediately while the full model is still loading.
   *  Korean Hangul in the input is preserved (lower-casing only affects latin). */
  async *replyLite(messages, lang){
    this._abort = new AbortController();
    const signal = this._abort.signal;
    const last = ([...messages].reverse().find((m) => m.role === 'user')?.content || '').toLowerCase();
    for (const w of stubReply(last, lang).split(' ')){
      if (signal.aborted) return;
      await new Promise((r) => setTimeout(r, 12));
      yield w + ' ';
    }
  }

  /** Ask the full model to decompose a description into primitive parts (JSON).
   *  Returns a validated parts array, or null (so the caller can fall back). */
  async modelSpec(desc){
    if (this.usingStub || !this.engine) return null;
    const sys = 'You output ONLY a JSON array that builds a 3D model from simple primitives. ' +
      'Each element: {"kind": one of "box","sphere","cylinder","cone","pyramid","torus","plane", ' +
      '"x":num,"y":num,"z":num,"s":num,"hue":0..1}. Coordinates within -2..2, sizes 0.1..1.5. ' +
      'Use 3 to 12 parts so it resembles the object. No prose, no markdown — only the JSON array.';
    try{
      const res = await this._withTimeout(this.engine.chat.completions.create({
        messages: [{ role:'system', content: sys }, { role:'user', content: `Object: ${desc}` }],
        stream: false, temperature: 0.4, max_tokens: 512,
      }), 30000, 'modelSpec timed out');
      const text = res.choices?.[0]?.message?.content || '';
      const m = text.match(/\[[\s\S]*\]/);
      if (!m) return null;
      const arr = JSON.parse(m[0]);
      if (!Array.isArray(arr) || !arr.length) return null;
      const kinds = new Set(['box','sphere','cylinder','cone','pyramid','torus','plane']);
      const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, (typeof v === 'number' && isFinite(v)) ? v : 0));
      const parts = arr.filter(p => p && kinds.has(p.kind)).slice(0, 14).map(p => ({
        kind: p.kind, x: clamp(p.x, -3, 3), y: clamp(p.y, -3, 3), z: clamp(p.z, -3, 3),
        s: clamp(p.s ?? 0.6, 0.1, 2), hue: clamp(p.hue ?? 0.6, 0, 1),
      }));
      return parts.length ? parts : null;
    }catch{ return null; }
  }

  /** Interrupt the in-flight generation (barge-in). */
  abort(){
    this._abort?.abort();
    if (!this.usingStub){ try{ this.engine?.interruptGenerate?.(); }catch{} }
  }
}
