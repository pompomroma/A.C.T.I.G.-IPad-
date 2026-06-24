// Intent parsing — deterministic keyword routing so control commands react
// instantly without waiting on the language model. Mirrors the Swift
// IntentRouter. Returns { type, ... } objects consumed by app.js.

const SHAPE_WORDS = {
  cube: 'box', box: 'box', block: 'box', brick: 'box', square: 'box', rectangle: 'box', cuboid: 'box',
  '정육면체':'box', '큐브':'box', '박스':'box', '상자':'box', '네모':'box',
  sphere: 'sphere', ball: 'sphere', orb: 'sphere', globe: 'sphere', circle: 'sphere',
  '구체':'sphere', '공':'sphere', '동그라미':'sphere',
  cylinder: 'cylinder', tube: 'cylinder', can: 'cylinder', pipe: 'cylinder', column: 'cylinder',
  '원기둥':'cylinder', '실린더':'cylinder',
  cone: 'cone', '원뿔':'cone', '콘':'cone', '세모':'cone',
  pyramid: 'pyramid', '피라미드':'pyramid',
  torus: 'torus', donut: 'torus', doughnut: 'torus', ring: 'torus', loop: 'torus',
  '도넛':'torus', '토러스':'torus', '고리':'torus',
  plane: 'plane', panel: 'plane', slab: 'plane', sheet: 'plane', '평면':'plane', '판':'plane'
};

const NUM_WORDS = {
  two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10,
  eleven:11, twelve:12, couple:2, few:3, several:4,
  '둘':2, '셋':3, '넷':4, '다섯':5, '여섯':6, '일곱':7, '여덟':8, '아홉':9, '열':10
};

const has = (t, ...needles) => needles.some((n) => t.includes(n));

// Damerau-Levenshtein (optimal string alignment) edit distance — counts a
// transposition ("opne"→"open") as a single edit, matching common typos/ASR slips.
function levenshtein(a, b){
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const d = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++){
    for (let j = 1; j <= n; j++){
      const cost = a[i-1] === b[j-1] ? 0 : 1;
      d[i][j] = Math.min(d[i-1][j] + 1, d[i][j-1] + 1, d[i-1][j-1] + cost);
      if (i > 1 && j > 1 && a[i-1] === b[j-2] && a[i-2] === b[j-1])
        d[i][j] = Math.min(d[i][j], d[i-2][j-2] + 1);
    }
  }
  return d[m][n];
}

// Fuzzy keyword match: true if any English token of `t` equals/contains a keyword
// or is within an edit-distance threshold (tolerates ASR slips / typos). Korean is
// left to exact `has()` matching (single-syllable fuzziness is too risky).
function fuzzyHas(t, ...keywords){
  if (has(t, ...keywords)) return true;
  const tokens = t.split(' ').filter((w) => w.length >= 3 && /[a-z]/.test(w));
  for (const kw of keywords){
    if (kw.includes(' ') || !/^[a-z]+$/.test(kw) || kw.length < 4) continue;
    const thr = kw.length >= 7 ? 2 : 1;
    for (const tok of tokens){
      if (Math.abs(tok.length - kw.length) > thr) continue;
      if (levenshtein(tok, kw) <= thr) return true;
    }
  }
  return false;
}

// Like fuzzyHas but matches whole TOKENS only (never substrings) — for verbs such
// as "model" that must NOT fire inside unrelated words ("modeling", "3d model").
function fuzzyWord(t, ...words){
  const tokens = t.split(' ');
  for (const kw of words){
    if (!/^[a-z]+$/.test(kw)){ if (t.includes(kw)) return true; continue; }
    const thr = kw.length >= 7 ? 2 : (kw.length >= 4 ? 1 : 0);
    for (const tok of tokens){
      if (tok === kw) return true;
      if (thr && tok.length >= 3 && Math.abs(tok.length - kw.length) <= thr && levenshtein(tok, kw) <= thr) return true;
    }
  }
  return false;
}

function detectShape(t){
  for (const [k,v] of Object.entries(SHAPE_WORDS)) if (t.includes(k)) return v;
  // Fuzzy pass for English shape words only (cube/box/sphere/ball/cylinder/cone…).
  const tokens = t.split(' ').filter((w) => w.length >= 3 && /^[a-z]+$/.test(w));
  for (const [k,v] of Object.entries(SHAPE_WORDS)){
    if (!/^[a-z]+$/.test(k) || k.length < 4) continue;
    const thr = k.length >= 7 ? 2 : 1;
    for (const tok of tokens){ if (Math.abs(tok.length - k.length) <= thr && levenshtein(tok, k) <= thr) return v; }
  }
  return null;
}

function extractCount(t){
  for (const [w,n] of Object.entries(NUM_WORDS)) if (t.includes(w)) return n;
  // Korean native counters: "두 개", "세 번"…
  const KO = { '한':1, '두':2, '세':3, '네':4, '다섯':5, '여섯':6, '일곱':7, '여덟':8, '아홉':9, '열':10 };
  const km = t.match(/(한|두|세|네|다섯|여섯|일곱|여덟|아홉|열)\s*(개|번|것)/);
  if (km) return KO[km[1]];
  const m = t.match(/\d+/);
  return m ? parseInt(m[0],10) : null;
}

// `ctx.workspace` lets ambiguous editing words ("delete", "go back", a bare
// "a ball") count as 3D commands ONLY while the 3D space is open. Everywhere
// else they fall through to natural conversation, so chatting feels human.
// Normalize transcripts/typed text: lowercase, NFC, strip punctuation, collapse
// spaces — so matching is robust to ASR/text noise.
export function norm(raw){
  let s = (raw || '').toLowerCase().normalize('NFC').replace(/[.,!?;:~"'’]/g, ' ');
  // Strip polite/filler wrappers so the core command surfaces ("could you please
  // rotate the cube" → "rotate the cube").
  s = s.replace(/\b(could you|can you|would you|will you|can we|let'?s|please|kindly|i want to|i wanna|i would like to|i'?d like to|i need you to|go ahead and|for me|right now|just|now)\b/g, ' ');
  s = s.replace(/(해\s*줄래|해\s*주세요|해\s*줘|좀)/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

export function parse(raw, ctx = {}){
  const t = norm(raw);
  const inScene = ctx.workspace === 'scene3D';

  // Always-global, unambiguous commands. (Korean needles alongside English.)
  if (has(t,'wake up actig','wake up act','wakeup actig','액티그 일어나','액티그 깨어나','일어나 액티그','깨어나')) return { type:'wake' };
  if (has(t,'shut down all systems','shutdown all systems','시스템 종료','모든 시스템 종료','전부 꺼','다 꺼')) return { type:'shutdown' };

  // Switch language by voice.
  if (has(t,'speak korean','in korean','switch to korean','korean please','talk in korean','say it in korean','한국어로','한국말로','한국어로 바꿔','한국어로 말해','한국어로 해')
      || (fuzzyWord(t,'korean') && fuzzyWord(t,'speak','switch','talk','change','use','say')))
    return { type:'setLang', lang:'ko' };
  if (has(t,'speak english','in english','switch to english','english please','talk in english','say it in english','영어로','영어로 바꿔','영어로 말해','영어로 해')
      || (fuzzyWord(t,'english') && fuzzyWord(t,'speak','switch','talk','change','use','say')))
    return { type:'setLang', lang:'en' };

  // Mute / unmute A.C.T.I.G.'s spoken voice.
  if (has(t,'be quiet','stop talking','stop speaking','mute yourself','mute your voice','no voice','voice off','say nothing','quiet please','조용히','말하지 마','음성 꺼','목소리 꺼','조용히 해'))
    return { type:'muteVoice' };
  if (has(t,'speak again','start talking','unmute','voice on','use your voice','out loud','음성 켜','목소리 켜','소리 켜'))
    return { type:'unmuteVoice' };

  // Reload / retry the full conversation model.
  if (has(t,'reload the model','reload model','retry the model','retry model','load the full model','use the full model','restart the model','full model please','모델 다시','전체 모델','모델 재시도','모델 다시 불러')
      || (fuzzyWord(t,'reload','retry','restart') && fuzzyWord(t,'model')))
    return { type:'retryModel' };

  // "What can I say?" — list the voice commands.
  if (has(t,'what can i say','list commands','show commands','what commands','voice commands','help me use','도움말','명령어','음성 명령','무슨 명령','뭐라고 말'))
    return { type:'help' };

  // --- Open the 3D project (very flexible: explicit phrases, OR a 3D/“modeling”
  // signal combined with an open verb). The verb requirement on the looser signals
  // keeps ordinary talk ("I enjoy modeling", "what's a 3d model") out of it.
  // Word-boundary regex so "3d mode" doesn't fire on "3d model", etc.
  const open3dRe = /\b3\s?d (project|space|mode|view|editor|workspace)\b|\bmodel(?:l?ing)? space\b|\bthe modeler\b|\b(?:open|bring up|pull up) the project\b/;
  const open3dKo = ['3d 공간','3d 모드','3d 열','3d 켜','3d 시작','프로젝트 열','작업 공간','작업실','모델링 시작','모델링 켜','모델링 공간'];
  const wants3D = /\b3\s?d\b|3차원|three\s?d/.test(t) || has(t,'모델링');
  const openVerb = fuzzyWord(t,'open','bring','enter','start','launch','show','activate','access','load','display','pull','begin')
    || has(t,'열','켜','시작','띄워','보여','활성','들어가') || /\b(go to|take me to|head to|bring up|pull up)\b/.test(t);
  if (open3dRe.test(t) || has(t, ...open3dKo) || (wants3D && openVerb) || (fuzzyWord(t,'modeling','modelling','modeler') && openVerb))
    return { type:'openScene' };
  if (has(t,'go back to chat','back to chat','back to conversation','close project','close the project','leave 3d','exit 3d','close 3d','leave the project','대화로','대화 모드','프로젝트 닫','3d 닫','채팅으로')) return { type:'openConversation' };

  if (has(t,'enable camera control','enable finger control','enable hand control','control with my hand','control with my fingers','use my fingers','use my hand','hand control','finger control','카메라 제어 켜','손 제어 켜','손가락 제어','손으로 제어'))
    return { type:'enableCameraControl' };
  if (has(t,'disable camera control','stop camera control','stop hand control','stop finger control','turn off hand','카메라 제어 꺼','손 제어 꺼'))
    return { type:'disableCameraControl' };
  if (has(t,'open camera','camera mode','show camera','use the camera','turn on the camera','open the camera','camera view','카메라 열','카메라 모드','카메라 보여','카메라 켜')
      || (fuzzyHas(t,'camera') && (fuzzyHas(t,'open','show','start','enable','activate') || has(t,'열','켜','보여'))))
    return { type:'openCamera' };

  // --- Scan / analyse an object via the camera.
  if (has(t,'what is this','what am i holding','what do you see','what is that','what object','what is in front','look through the camera','이거 뭐','이게 뭐','스캔','분석','인식','이게 뭐야','뭐야 이거','이게 뭔지','물체 인식','사물 인식','카메라로 봐','카메라로 분석')
      || fuzzyHas(t,'scan','analyze','analyse','identify','recognize','recognise'))
    return { type:'analyze', question: raw };

  // "undo"/"redo" as explicit words are safe anywhere; the looser synonyms only
  // apply inside the 3D space.
  if (/\bundo\b/.test(t) || has(t,'실행취소','실행 취소','되돌려')) return { type:'undo' };
  if (/\bredo\b/.test(t) || has(t,'다시실행','다시 실행')) return { type:'redo' };
  if (inScene && has(t,'go back','previous action','revert','이전으로')) return { type:'undo' };
  if (inScene && has(t,'do it again','다시 해')) return { type:'redo' };

  // Export / download the model as a file.
  if (fuzzyHas(t,'export','download') || has(t,'save the model','save model','save it as a file','save as file','내보내기','내보내','다운로드','모델 저장','파일로 저장','파일로 내보'))
    return { type:'export' };

  // Generative modelling: "build/model a <thing>" composes primitives.
  const build = parseBuild(t, raw);
  if (build) return build;

  const scene = parseScene(t, inScene);
  if (scene) return scene;

  return { type:'chat', text: raw };
}

const BUILD_VERBS = /\b(build|model|design|construct|sculpt|assemble)\b/;
const TRANSFORM_WORDS = ['bigger','smaller','grow','shrink','rotate','spin','tilt','roll','move','shift','slide',
  'delete','remove','clear','undo','redo','swap','크게','작게','확대','축소','회전','돌려','이동','옮겨','움직','삭제','지워','비워'];

// Detect a "build a <described object>" request (vs. adding a primitive shape or
// transforming the selection). Returns { type:'build', desc } or null.
function parseBuild(t, raw){
  // Questions/statements about something are conversation, not build commands
  // ("what is a 3d model", "tell me about modeling"). Genuine command-questions
  // ("could you build a house") lose their prefix in norm() already.
  if (/^(what|who|whose|why|how|when|where|which|is|are|am|do|does|did|tell|explain|describe)\b/.test(t)) return null;
  if (/\b(is|are|was|were)\b/.test(t)) return null;          // a statement, not a command
  // Token-level matching so "model" doesn't fire inside "modeling"/"3d model".
  const strong = fuzzyWord(t,'build','model','design','construct','sculpt','assemble') || has(t,'지어','설계','모델링','조립');
  const make = fuzzyWord(t,'make','create','generate','build') || has(t,'만들','그려');
  if (!strong && !make) return null;
  if (detectShape(t)) return null;                          // "make a cube" → add primitive
  if (TRANSFORM_WORDS.some(w => t.includes(w))) return null; // "make it bigger" → grow, etc.
  const desc = cleanBuildTarget(raw);
  // Reject empty / too-thin targets ("3d", a lone number) so they fall through.
  if (!desc || desc.length < 2 || /^3\s?d?$/.test(desc) || /^\d+$/.test(desc)) return null;
  return { type:'build', desc };
}

function cleanBuildTarget(raw){
  let s = (raw || '').toLowerCase().trim();
  s = s.replace(/\b(build|model|design|construct|sculpt|assemble|make|create|generate|me|a|an|the|please|for me|now)\b/g, ' ');
  s = s.replace(/(만들어 줘|만들어줘|만들어|만들|그려 줘|그려줘|그려|지어 줘|지어줘|지어|설계해|설계|모델링 해줘|모델링|조립해|조립|해 줘|해줘|좀|를|을|의|로)/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

const ADD_VERBS = ['add','create','make','spawn','place','call','give me','put','build','insert','drop',
  '추가','만들','생성','놓','넣','둬','올려'];

function parseScene(t, inScene){
  const kind = detectShape(t);
  // A transform command targets an object when we're in the 3D space OR the text
  // names a shape / object ("rotate the cube", "make the sphere bigger") — so
  // edit commands work even from the chat view (route auto-opens the 3D space).
  // Bare-pronoun cases ("rotate it") stay gated to the scene / the AI fallback.
  const objRef = inScene || !!kind || /\b(object|model|shape|thing|figure|selection)\b/.test(t)
    || has(t,'물체','모델','도형','오브젝트','선택');

  // Rotate.
  if (objRef && (fuzzyHas(t,'rotate','spin','turn','tilt','roll','flip','twist','pivot') || has(t,'회전','돌려','돌리','기울','뒤집'))){
    let axis = 'y';
    if (/\b(up|down|forward|back(ward)?|tilt|pitch|flip)\b/.test(t) || has(t,'위','아래','기울','뒤집')) axis = 'x';
    else if (/\b(roll|z[- ]?axis)\b/.test(t) || has(t,'롤','굴려')) axis = 'z';
    const deg = extractCount(t) || 90;
    const dir = (/\b(left|counter|counter-?clockwise|anti|ccw)\b/.test(t) || has(t,'왼쪽','반시계')) ? -1 : 1;
    return { type:'scene', action:'rotate', axis, degrees: dir*deg };
  }

  // Move.
  if (objRef && (fuzzyHas(t,'move','shift','slide','nudge','drag','push','pull','relocate','reposition') || has(t,'이동','옮겨','움직','밀','당겨'))){
    if (has(t,'center','middle','origin','가운데','중앙','원점','중심')) return { type:'scene', action:'moveTo', x:0, y:0, z:0 };
    const step = 0.6; let dx=0, dy=0, dz=0;
    if (/\bleft\b/.test(t)  || has(t,'왼쪽','왼')) dx -= step;
    if (/\bright\b/.test(t) || has(t,'오른쪽','오른')) dx += step;
    if (/\bup\b/.test(t)    || has(t,'위로','위쪽','위')) dy += step;
    if (/\bdown\b/.test(t)  || has(t,'아래','밑')) dy -= step;
    if (/\bforward\b/.test(t) || has(t,'앞')) dz -= step;
    if (/\bback(ward)?\b/.test(t) || has(t,'뒤')) dz += step;
    if (dx || dy || dz) return { type:'scene', action:'move', dx, dy, dz };
  }

  // Size / delete / swap / clear — checked BEFORE creation so "make the cube
  // bigger" grows it instead of adding a new cube.
  if (objRef){
    if (fuzzyHas(t,'bigger','grow','enlarge','expand','larger') || has(t,'scale up','크게','키워','확대','커','크게 해')) return { type:'scene', action:'grow' };
    if (fuzzyHas(t,'smaller','shrink','reduce','tinier') || has(t,'scale down','작게','줄여','축소','작게 해')) return { type:'scene', action:'shrink' };
    if (fuzzyHas(t,'delete','remove','erase','trash') || has(t,'get rid','삭제','지워','없애','치워','제거')) return { type:'scene', action:'delete' };
    if (fuzzyHas(t,'swap') || has(t,'switch places','바꿔','교체')) return { type:'scene', action:'swap' };
    if (fuzzyHas(t,'clear','wipe','reset','empty') || has(t,'clear the scene','remove everything','start over','전부 삭제','다 지워','초기화','비워')) return { type:'scene', action:'clear' };
  }

  // Creation needs a shape AND (an explicit verb OR already in the 3D space) — so
  // "I had a ball yesterday" stays a normal sentence.
  if (!kind) return null;
  const explicit = has(t, ...ADD_VERBS) || fuzzyHas(t,'add','create','make','build','spawn','place','put','insert','drop');
  if (!explicit && !inScene) return null;

  const n = extractCount(t);
  if (n && (fuzzyHas(t,'multiply','copies','duplicate','clone') || has(t,'times','복제','중복','곱','개'))) return { type:'scene', action:'multiply', kind, count:n };
  return { type:'scene', action:'add', kind };
}

// Should the AI-interpret fallback even run? Only for command-like inputs the rules
// didn't catch — keeps ordinary conversation fast and out of the classifier.
export function looksCommandish(raw, inScene){
  const t = norm(raw);
  if (inScene) return true;
  return /\b(add|make|create|build|model|design|spawn|place|put|insert|drop|move|shift|slide|push|pull|drag|rotate|spin|turn|tilt|roll|flip|scale|grow|shrink|bigger|smaller|enlarge|reduce|expand|delete|remove|erase|clear|wipe|reset|swap|open|close|exit|enter|launch|scan|identify|recognize|analyze|analyse|export|download|save|undo|redo|enable|disable|quiet|mute|unmute|korean|english|reload|retry|restart)\b/.test(t)
    || /\b(it|that|this|them|the (cube|box|sphere|ball|cylinder|cone|pyramid|torus|object|model|shape|thing))\b/.test(t)
    || has(t,'추가','만들','생성','이동','옮겨','움직','회전','돌려','확대','축소','크게','작게','삭제','지워','없애','열어','닫','스캔','분석','인식','내보내','다운로드','모델링','지어','정렬','비워','초기화','한국어','영어','조용','음성','목소리');
}

// Validate the LLM classifier's JSON into the app's intent shape. Returns a clean
// intent or null (so the caller falls back to plain chat).
const AI_TYPES = new Set(['wake','shutdown','openScene','openConversation','openCamera',
  'enableCameraControl','disableCameraControl','analyze','undo','redo','export','build','scene',
  'setLang','muteVoice','unmuteVoice','retryModel','help']);
const SCENE_ACTIONS = new Set(['add','multiply','grow','shrink','rotate','move','moveTo','delete','swap','clear']);
const KINDS = new Set(['box','sphere','cylinder','cone','pyramid','torus','plane']);

export function intentFromAI(obj, raw){
  if (!obj || typeof obj !== 'object' || !AI_TYPES.has(obj.type)) return null;
  if (obj.type === 'analyze') return { type:'analyze', question: raw };
  if (obj.type === 'setLang') return { type:'setLang', lang: obj.lang === 'ko' ? 'ko' : 'en' };
  if (obj.type === 'build') return { type:'build', desc: (typeof obj.desc === 'string' && obj.desc.trim()) ? obj.desc : raw };
  if (obj.type === 'scene'){
    if (!SCENE_ACTIONS.has(obj.action)) return null;
    const i = { type:'scene', action: obj.action };
    if (obj.action === 'add'){ if (!KINDS.has(obj.kind)) return null; i.kind = obj.kind; }
    if (obj.action === 'multiply'){ if (!KINDS.has(obj.kind)) return null; i.kind = obj.kind; i.count = Math.max(1, Math.min(25, parseInt(obj.count,10) || 2)); }
    if (obj.action === 'rotate'){ i.axis = ['x','y','z'].includes(obj.axis) ? obj.axis : 'y'; i.degrees = Number.isFinite(+obj.degrees) ? +obj.degrees : 90; }
    if (obj.action === 'move'){ const s=0.6; i.dx=(+obj.dx||0)*1||0; i.dy=(+obj.dy||0)||0; i.dz=(+obj.dz||0)||0; if(!i.dx&&!i.dy&&!i.dz) i.dx=s; }
    if (obj.action === 'moveTo'){ i.x=+obj.x||0; i.y=+obj.y||0; i.z=+obj.z||0; }
    return i;
  }
  return { type: obj.type };
}
