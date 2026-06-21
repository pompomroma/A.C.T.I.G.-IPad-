// Intent parsing — deterministic keyword routing so control commands react
// instantly without waiting on the language model. Mirrors the Swift
// IntentRouter. Returns { type, ... } objects consumed by app.js.

const SHAPE_WORDS = {
  cube: 'box', box: 'box', block: 'box',
  sphere: 'sphere', ball: 'sphere', orb: 'sphere',
  cylinder: 'cylinder', tube: 'cylinder', can: 'cylinder',
  cone: 'cone',
  pyramid: 'pyramid',
  torus: 'torus', donut: 'torus', ring: 'torus',
  plane: 'plane', panel: 'plane'
};

const NUM_WORDS = { two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10 };

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

export function parse(raw){
  const t = (raw || '').toLowerCase().trim();

  if (has(t,'wake up actig','wake up act','wakeup actig')) return { type:'wake' };
  if (has(t,'shut down all systems','shutdown all systems')) return { type:'shutdown' };

  if (has(t,'3d project','3d space','modeling','modelling','bring up the project','open the project'))
    return { type:'openScene' };
  if (has(t,'go back to chat','close project','conversation')) return { type:'openConversation' };

  if (has(t,'enable camera control','enable finger control','enable hand control','control with my hand','use my fingers'))
    return { type:'enableCameraControl' };
  if (has(t,'disable camera control','stop camera control','stop hand control','stop finger control'))
    return { type:'disableCameraControl' };
  if (has(t,'open camera','camera mode')) return { type:'openCamera' };

  if (has(t,'scan this','what is this','analyze this','analyse this','identify this','what am i holding'))
    return { type:'analyze', question: raw };

  if (has(t,'undo','go back','previous action','revert')) return { type:'undo' };
  if (has(t,'redo','do it again')) return { type:'redo' };

  const scene = parseScene(t);
  if (scene) return scene;

  return { type:'chat', text: raw };
}

function parseScene(t){
  const kind = detectShape(t);
  if (!kind){
    if (has(t,'bigger','grow','extend','enlarge','scale up')) return { type:'scene', action:'grow' };
    if (has(t,'smaller','shrink','scale down')) return { type:'scene', action:'shrink' };
    if (has(t,'delete','remove')) return { type:'scene', action:'delete' };
    if (has(t,'swap','switch places')) return { type:'scene', action:'swap' };
    if (has(t,'clear the scene','clear scene','remove everything','start over')) return { type:'scene', action:'clear' };
    return null;
  }
  const n = extractCount(t);
  if (n && has(t,'multiply','copies','duplicate','times')) return { type:'scene', action:'multiply', kind, count:n };
  return { type:'scene', action:'add', kind };
}
