// Intent parsing — deterministic keyword routing so control commands react
// instantly without waiting on the language model. Mirrors the Swift
// IntentRouter. Returns { type, ... } objects consumed by app.js.

const SHAPE_WORDS = {
  cube: 'box', box: 'box', block: 'box', '정육면체':'box', '큐브':'box', '박스':'box', '상자':'box',
  sphere: 'sphere', ball: 'sphere', orb: 'sphere', '구체':'sphere', '공':'sphere',
  cylinder: 'cylinder', tube: 'cylinder', can: 'cylinder', '원기둥':'cylinder', '실린더':'cylinder',
  cone: 'cone', '원뿔':'cone', '콘':'cone',
  pyramid: 'pyramid', '피라미드':'pyramid',
  torus: 'torus', donut: 'torus', ring: 'torus', '도넛':'torus', '토러스':'torus', '고리':'torus',
  plane: 'plane', panel: 'plane', '평면':'plane', '판':'plane'
};

const NUM_WORDS = {
  two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10,
  '둘':2, '셋':3, '넷':4, '다섯':5, '여섯':6, '일곱':7, '여덟':8, '아홉':9, '열':10
};

const has = (t, ...needles) => needles.some((n) => t.includes(n));

function detectShape(t){
  for (const [k,v] of Object.entries(SHAPE_WORDS)) if (t.includes(k)) return v;
  return null;
}

function extractCount(t){
  for (const [w,n] of Object.entries(NUM_WORDS)) if (t.includes(w)) return n;
  const m = t.match(/\d+/);
  return m ? parseInt(m[0],10) : null;
}

// `ctx.workspace` lets ambiguous editing words ("delete", "go back", a bare
// "a ball") count as 3D commands ONLY while the 3D space is open. Everywhere
// else they fall through to natural conversation, so chatting feels human.
export function parse(raw, ctx = {}){
  const t = (raw || '').toLowerCase().trim();
  const inScene = ctx.workspace === 'scene3D';

  // Always-global, unambiguous commands. (Korean needles alongside English.)
  if (has(t,'wake up actig','wake up act','wakeup actig','액티그 일어나','액티그 깨어나','일어나 액티그','깨어나')) return { type:'wake' };
  if (has(t,'shut down all systems','shutdown all systems','시스템 종료','모든 시스템 종료','전부 꺼','다 꺼')) return { type:'shutdown' };

  if (has(t,'3d project','3d space','modeling','modelling','bring up the project','open the project','open the 3d','open 3d','3d 공간','모델링','프로젝트 열','3d 열'))
    return { type:'openScene' };
  if (has(t,'go back to chat','close project','close the project','exit 3d','대화로','프로젝트 닫','3d 닫')) return { type:'openConversation' };

  if (has(t,'enable camera control','enable finger control','enable hand control','control with my hand','use my fingers','카메라 제어 켜','손 제어 켜','손가락 제어'))
    return { type:'enableCameraControl' };
  if (has(t,'disable camera control','stop camera control','stop hand control','stop finger control','카메라 제어 꺼','손 제어 꺼'))
    return { type:'disableCameraControl' };
  if (has(t,'open camera','camera mode','카메라 열','카메라 모드')) return { type:'openCamera' };

  if (has(t,'scan this','what is this','analyze this','analyse this','identify this','what am i holding','이거 뭐','이게 뭐','스캔','분석'))
    return { type:'analyze', question: raw };

  // "undo"/"redo" as explicit words are safe anywhere; the looser synonyms only
  // apply inside the 3D space.
  if (/\bundo\b/.test(t) || has(t,'실행취소','실행 취소','되돌려')) return { type:'undo' };
  if (/\bredo\b/.test(t) || has(t,'다시실행','다시 실행')) return { type:'redo' };
  if (inScene && has(t,'go back','previous action','revert','이전으로')) return { type:'undo' };
  if (inScene && has(t,'do it again','다시 해')) return { type:'redo' };

  // Export / download the model as a file.
  if (has(t,'export','download','save the model','save model','내보내기','다운로드','모델 저장','파일로 저장'))
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
  const strong = BUILD_VERBS.test(t) || has(t,'지어','설계','모델링','조립');
  const make = has(t,'make','create','generate','build','만들','그려');
  if (!strong && !make) return null;
  if (detectShape(t)) return null;                          // "make a cube" → add primitive
  if (TRANSFORM_WORDS.some(w => t.includes(w))) return null; // "make it bigger" → grow, etc.
  const desc = cleanBuildTarget(raw);
  if (!desc) return null;
  return { type:'build', desc };
}

function cleanBuildTarget(raw){
  let s = (raw || '').toLowerCase().trim();
  s = s.replace(/\b(build|model|design|construct|sculpt|assemble|make|create|generate|me|a|an|the|please|for me|now)\b/g, ' ');
  s = s.replace(/(만들어 줘|만들어줘|만들어|만들|그려 줘|그려줘|그려|지어 줘|지어줘|지어|설계해|설계|모델링 해줘|모델링|조립해|조립|해 줘|해줘|좀|를|을|의|로)/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

const ADD_VERBS = ['add','create','make','spawn','place','call','give me','put','build','추가','만들','생성','놓','넣'];

function parseScene(t, inScene){
  // Rotate is checked before shape detection so "rotate the cube" turns it rather
  // than adding one. Word-boundary regex avoids false hits like "return".
  if (inScene && (/\b(rotate|spin|turn|tilt|roll)\b/.test(t) || has(t,'회전','돌려','돌리','기울'))){
    let axis = 'y';
    if (/\b(up|down|forward|back(ward)?|tilt|pitch|x[- ]?axis)\b/.test(t) || has(t,'위','아래','기울')) axis = 'x';
    else if (/\b(roll|z[- ]?axis)\b/.test(t) || has(t,'롤','굴려')) axis = 'z';
    const deg = extractCount(t) || 90;
    const dir = (/\b(left|counter|counter-?clockwise|anti)\b/.test(t) || has(t,'왼쪽','반시계')) ? -1 : 1;
    return { type:'scene', action:'rotate', axis, degrees: dir*deg };
  }

  // Move is checked before shape detection so "move the cube left" moves it.
  if (inScene && (/\b(move|shift|slide|nudge|drag)\b/.test(t) || has(t,'이동','옮겨','움직','밀'))){
    if (has(t,'center','middle','origin','가운데','중앙','원점')) return { type:'scene', action:'moveTo', x:0, y:0, z:0 };
    const step = 0.6; let dx=0, dy=0, dz=0;
    if (/\bleft\b/.test(t)  || has(t,'왼쪽','왼')) dx -= step;
    if (/\bright\b/.test(t) || has(t,'오른쪽','오른')) dx += step;
    if (/\bup\b/.test(t)    || has(t,'위로','위쪽')) dy += step;
    if (/\bdown\b/.test(t)  || has(t,'아래','밑')) dy -= step;
    if (/\bforward\b/.test(t) || has(t,'앞')) dz -= step;
    if (/\bback(ward)?\b/.test(t) || has(t,'뒤')) dz += step;
    if (dx || dy || dz) return { type:'scene', action:'move', dx, dy, dz };
  }

  const kind = detectShape(t);
  if (!kind){
    // Selection edits only make sense while editing the 3D scene.
    if (!inScene) return null;
    if (has(t,'bigger','grow','extend','enlarge','scale up','크게','키워','확대','커')) return { type:'scene', action:'grow' };
    if (has(t,'smaller','shrink','scale down','작게','줄여','축소')) return { type:'scene', action:'shrink' };
    if (has(t,'delete','remove it','delete it','삭제','지워','없애')) return { type:'scene', action:'delete' };
    if (has(t,'swap','switch places','바꿔','교체')) return { type:'scene', action:'swap' };
    if (has(t,'clear the scene','clear scene','remove everything','start over','전부 삭제','다 지워','초기화')) return { type:'scene', action:'clear' };
    return null;
  }
  // A shape word only triggers creation with an explicit verb, OR when already in
  // the 3D space — so "I had a ball yesterday" stays a normal sentence.
  const explicit = has(t, ...ADD_VERBS);
  if (!explicit && !inScene) return null;

  const n = extractCount(t);
  if (n && has(t,'multiply','copies','duplicate','times','복제','중복','곱')) return { type:'scene', action:'multiply', kind, count:n };
  return { type:'scene', action:'add', kind };
}
