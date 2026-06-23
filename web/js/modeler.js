// Generative 3D modelling: turn a natural-language description into a list of
// primitive "parts" that the scene assembles into the object. Each part is a
// spec consumed by Scene3D.addModel():
//   { kind, x, y, z, s?, sx?, sy?, sz?, hue, rx?, ry?, rz? }
// Coordinates are grid-local (roughly within ±2, y up). Reliable + fully offline.

const P2 = Math.PI / 2;

// --- procedural templates (each returns an array of part specs) ---
const TEMPLATES = {
  snowman: () => [
    { kind:'sphere', x:0, y:-0.6, z:0, s:0.95, hue:0.58 },
    { kind:'sphere', x:0, y:0.35, z:0, s:0.68, hue:0.58 },
    { kind:'sphere', x:0, y:1.05, z:0, s:0.46, hue:0.58 },
    { kind:'cone',   x:0, y:1.05, z:0.42, sx:0.15, sy:0.4, sz:0.15, hue:0.07, rx:P2 }, // nose
    { kind:'sphere', x:-0.16, y:1.15, z:0.36, s:0.08, hue:0 },                          // eyes
    { kind:'sphere', x:0.16,  y:1.15, z:0.36, s:0.08, hue:0 },
  ],
  house: () => [
    { kind:'box',     x:0, y:-0.35, z:0, sx:1.5, sy:1.2, sz:1.4, hue:0.11 }, // walls
    { kind:'pyramid', x:0, y:0.75,  z:0, sx:1.7, sy:1.1, sz:1.7, hue:0.02 }, // roof
    { kind:'box',     x:0, y:-0.55, z:0.71, sx:0.4, sy:0.7, sz:0.1, hue:0.08 }, // door
  ],
  tree: () => [
    { kind:'cylinder', x:0, y:-0.55, z:0, sx:0.3, sy:1.0, sz:0.3, hue:0.08 }, // trunk
    { kind:'sphere',   x:0, y:0.35,  z:0, s:0.9, hue:0.33 },
    { kind:'sphere',   x:0.35, y:0.7, z:0.1, s:0.6, hue:0.34 },
    { kind:'sphere',   x:-0.3, y:0.65, z:-0.1, s:0.55, hue:0.32 },
  ],
  car: () => [
    { kind:'box', x:0, y:-0.2, z:0, sx:1.8, sy:0.5, sz:0.9, hue:0.0 },   // body
    { kind:'box', x:-0.1, y:0.25, z:0, sx:0.9, sy:0.45, sz:0.8, hue:0.0 }, // cabin
    { kind:'cylinder', x:-0.55, y:-0.5, z:0.5, sx:0.35, sy:0.18, sz:0.35, hue:0.7, rz:P2 },
    { kind:'cylinder', x:0.55,  y:-0.5, z:0.5, sx:0.35, sy:0.18, sz:0.35, hue:0.7, rz:P2 },
    { kind:'cylinder', x:-0.55, y:-0.5, z:-0.5, sx:0.35, sy:0.18, sz:0.35, hue:0.7, rz:P2 },
    { kind:'cylinder', x:0.55,  y:-0.5, z:-0.5, sx:0.35, sy:0.18, sz:0.35, hue:0.7, rz:P2 },
  ],
  robot: () => [
    { kind:'box', x:0, y:0, z:0, sx:0.9, sy:1.1, sz:0.6, hue:0.6 },        // torso
    { kind:'box', x:0, y:0.95, z:0, sx:0.6, sy:0.5, sz:0.6, hue:0.62 },    // head
    { kind:'sphere', x:-0.13, y:1.0, z:0.3, s:0.1, hue:0.0 },              // eyes
    { kind:'sphere', x:0.13,  y:1.0, z:0.3, s:0.1, hue:0.0 },
    { kind:'cylinder', x:-0.65, y:-0.05, z:0, sx:0.2, sy:0.9, sz:0.2, hue:0.6 }, // arms
    { kind:'cylinder', x:0.65,  y:-0.05, z:0, sx:0.2, sy:0.9, sz:0.2, hue:0.6 },
    { kind:'cylinder', x:-0.28, y:-1.1, z:0, sx:0.24, sy:0.9, sz:0.24, hue:0.58 }, // legs
    { kind:'cylinder', x:0.28,  y:-1.1, z:0, sx:0.24, sy:0.9, sz:0.24, hue:0.58 },
  ],
  tower: () => [
    { kind:'box', x:0, y:-0.9, z:0, sx:1.1, sy:0.5, sz:1.1, hue:0.55 },
    { kind:'box', x:0, y:-0.35, z:0, sx:0.9, sy:0.5, sz:0.9, hue:0.57 },
    { kind:'box', x:0, y:0.2,  z:0, sx:0.7, sy:0.5, sz:0.7, hue:0.59 },
    { kind:'box', x:0, y:0.7,  z:0, sx:0.5, sy:0.5, sz:0.5, hue:0.61 },
    { kind:'cone', x:0, y:1.25, z:0, sx:0.5, sy:0.7, sz:0.5, hue:0.0 },
  ],
  table: () => [
    { kind:'box', x:0, y:0.3, z:0, sx:1.6, sy:0.18, sz:1.0, hue:0.09 }, // top
    { kind:'cylinder', x:-0.65, y:-0.25, z:0.35, sx:0.16, sy:1.0, sz:0.16, hue:0.08 },
    { kind:'cylinder', x:0.65,  y:-0.25, z:0.35, sx:0.16, sy:1.0, sz:0.16, hue:0.08 },
    { kind:'cylinder', x:-0.65, y:-0.25, z:-0.35, sx:0.16, sy:1.0, sz:0.16, hue:0.08 },
    { kind:'cylinder', x:0.65,  y:-0.25, z:-0.35, sx:0.16, sy:1.0, sz:0.16, hue:0.08 },
  ],
  chair: () => [
    { kind:'box', x:0, y:0, z:0, sx:0.9, sy:0.15, sz:0.9, hue:0.1 },     // seat
    { kind:'box', x:0, y:0.5, z:-0.4, sx:0.9, sy:0.9, sz:0.12, hue:0.1 }, // back
    { kind:'cylinder', x:-0.35, y:-0.5, z:0.35, sx:0.12, sy:0.9, sz:0.12, hue:0.08 },
    { kind:'cylinder', x:0.35,  y:-0.5, z:0.35, sx:0.12, sy:0.9, sz:0.12, hue:0.08 },
    { kind:'cylinder', x:-0.35, y:-0.5, z:-0.35, sx:0.12, sy:0.9, sz:0.12, hue:0.08 },
    { kind:'cylinder', x:0.35,  y:-0.5, z:-0.35, sx:0.12, sy:0.9, sz:0.12, hue:0.08 },
  ],
  person: () => [
    { kind:'sphere', x:0, y:1.0, z:0, s:0.5, hue:0.07 },                  // head
    { kind:'cylinder', x:0, y:0.1, z:0, sx:0.5, sy:1.0, sz:0.35, hue:0.6 }, // torso
    { kind:'cylinder', x:-0.5, y:0.15, z:0, sx:0.16, sy:0.9, sz:0.16, hue:0.07, rz:0.3 }, // arms
    { kind:'cylinder', x:0.5,  y:0.15, z:0, sx:0.16, sy:0.9, sz:0.16, hue:0.07, rz:-0.3 },
    { kind:'cylinder', x:-0.2, y:-0.95, z:0, sx:0.18, sy:1.0, sz:0.18, hue:0.62 }, // legs
    { kind:'cylinder', x:0.2,  y:-0.95, z:0, sx:0.18, sy:1.0, sz:0.18, hue:0.62 },
  ],
  flower: () => [
    { kind:'cylinder', x:0, y:-0.4, z:0, sx:0.12, sy:1.2, sz:0.12, hue:0.33 }, // stem
    { kind:'sphere', x:0, y:0.6, z:0, s:0.32, hue:0.13 },                      // centre
    { kind:'sphere', x:0.4, y:0.6, z:0, s:0.26, hue:0.92 },                    // petals
    { kind:'sphere', x:-0.4, y:0.6, z:0, s:0.26, hue:0.92 },
    { kind:'sphere', x:0, y:0.6, z:0.4, s:0.26, hue:0.92 },
    { kind:'sphere', x:0, y:0.6, z:-0.4, s:0.26, hue:0.92 },
  ],
  rocket: () => [
    { kind:'cylinder', x:0, y:0, z:0, sx:0.5, sy:1.4, sz:0.5, hue:0.55 }, // body
    { kind:'cone', x:0, y:1.15, z:0, sx:0.5, sy:0.7, sz:0.5, hue:0.0 },   // nose
    { kind:'cone', x:-0.45, y:-0.7, z:0, sx:0.3, sy:0.5, sz:0.3, hue:0.02, rz:-0.5 }, // fins
    { kind:'cone', x:0.45,  y:-0.7, z:0, sx:0.3, sy:0.5, sz:0.3, hue:0.02, rz:0.5 },
  ],
  dog: () => [
    { kind:'box', x:0, y:0, z:0, sx:1.2, sy:0.55, sz:0.5, hue:0.08 },     // body
    { kind:'box', x:0.75, y:0.25, z:0, sx:0.5, sy:0.5, sz:0.45, hue:0.08 }, // head
    { kind:'cylinder', x:1.0, y:0.05, z:0, sx:0.18, sy:0.35, sz:0.18, hue:0.07, rz:P2 }, // snout
    { kind:'cylinder', x:-0.4, y:-0.5, z:0.18, sx:0.13, sy:0.6, sz:0.13, hue:0.08 }, // legs
    { kind:'cylinder', x:0.4,  y:-0.5, z:0.18, sx:0.13, sy:0.6, sz:0.13, hue:0.08 },
    { kind:'cylinder', x:-0.4, y:-0.5, z:-0.18, sx:0.13, sy:0.6, sz:0.13, hue:0.08 },
    { kind:'cylinder', x:0.4,  y:-0.5, z:-0.18, sx:0.13, sy:0.6, sz:0.13, hue:0.08 },
    { kind:'cylinder', x:-0.7, y:0.15, z:0, sx:0.1, sy:0.5, sz:0.1, hue:0.08, rz:-0.6 }, // tail
  ],
};

// English + Korean synonyms → template key.
const SYNONYMS = {
  snowman: ['snowman', '눈사람'],
  house:   ['house', 'home', 'cabin', 'hut', '집', '주택', '오두막'],
  tree:    ['tree', 'bush', '나무', '수풀'],
  car:     ['car', 'vehicle', 'truck', 'automobile', '자동차', '차', '트럭'],
  robot:   ['robot', 'android', 'mech', '로봇'],
  tower:   ['tower', 'castle', 'skyscraper', '탑', '성', '빌딩'],
  table:   ['table', 'desk', '탁자', '책상', '테이블'],
  chair:   ['chair', 'seat', 'stool', '의자'],
  person:  ['person', 'human', 'man', 'woman', 'people', '사람', '인간'],
  flower:  ['flower', 'rose', 'plant', '꽃', '식물'],
  rocket:  ['rocket', 'missile', 'spaceship', '로켓', '미사일', '우주선'],
  dog:     ['dog', 'puppy', 'animal', '강아지', '개', '동물'],
};

// Build a model from a description. Returns { key, parts } or null if unrecognised.
export function buildModel(desc){
  const t = (desc || '').toLowerCase();
  for (const [key, syns] of Object.entries(SYNONYMS)){
    if (syns.some((s) => t.includes(s))) return { key, parts: TEMPLATES[key]() };
  }
  return null;
}

// Fallback "abstract" composition so an unrecognised description still produces
// something on screen.
export function genericModel(){
  const kinds = ['box', 'sphere', 'cylinder', 'cone'];
  const parts = [];
  const n = 3 + Math.floor(Math.random() * 2);
  for (let i = 0; i < n; i++){
    parts.push({
      kind: kinds[Math.floor(Math.random() * kinds.length)],
      x: (Math.random() - 0.5) * 1.4,
      y: i * 0.6 - 0.6,
      z: (Math.random() - 0.5) * 1.0,
      s: 0.5 + Math.random() * 0.4,
      hue: Math.random(),
      ry: Math.random() * Math.PI,
    });
  }
  return { key: 'generic', parts };
}

export const MODEL_KINDS = Object.keys(SYNONYMS);
