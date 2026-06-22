// 3D modelling project space powered by Three.js. Shapes can be added,
// multiplied, scaled, deleted, swapped and dragged. Every edit goes through a
// command stack for undo/redo, and the scene autosaves to localStorage.
//
// Three.js is imported from a LOCAL vendored copy by relative path (not a bare
// "three" specifier). This means the 3D space works even on older/locked-down
// Safari without import-map support and on school devices whose content filter
// blocks CDNs (e.g. the 10th-gen iPad) — and it works fully offline.

import * as THREE from '../vendor/three.module.js';

const STORE_KEY = 'actig.scene.v1';
let _seq = 0;
const uid = () => `n${Date.now().toString(36)}${(_seq++).toString(36)}`;

function geometryFor(kind){
  switch(kind){
    case 'sphere':   return new THREE.SphereGeometry(0.5, 32, 24);
    case 'cylinder': return new THREE.CylinderGeometry(0.45, 0.45, 1, 32);
    case 'cone':     return new THREE.ConeGeometry(0.5, 1, 32);
    case 'pyramid':  return new THREE.ConeGeometry(0.6, 1, 4);
    case 'torus':    return new THREE.TorusGeometry(0.4, 0.16, 16, 40);
    case 'plane':    return new THREE.BoxGeometry(1.2, 0.05, 1.2);
    case 'box':
    default:         return new THREE.BoxGeometry(0.8, 0.8, 0.8);
  }
}

export class Scene3D {
  constructor(canvas){
    this.canvas = canvas;
    this.nodes = new Map();   // id -> { node, mesh }
    this.selection = null;
    this.undoStack = [];
    this.redoStack = [];
    this.onChange = null;     // notify UI (undo/redo enablement)
    this._initThree();
    this._bindPointer();
    this.load();
    this._animate();
  }

  _initThree(){
    // powerPreference default + graceful options for weaker GPUs (10th-gen iPad).
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: true, alpha: true,
      powerPreference: 'default', failIfMajorPerformanceCaveat: false,
    });
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
    this.camera.position.set(0, 1.1, 3.4);
    this.camera.lookAt(0, 0, 0);

    this.scene.add(new THREE.AmbientLight(0x88bbff, 0.7));
    const dir = new THREE.DirectionalLight(0x9fd8ff, 1.1); dir.position.set(2, 4, 3);
    this.scene.add(dir);

    const grid = new THREE.GridHelper(12, 24, 0x52bcff, 0x1d4a7a);
    grid.position.y = -1; grid.material.opacity = 0.35; grid.material.transparent = true;
    this.scene.add(grid);

    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.raycaster = new THREE.Raycaster();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(){
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _animate(){
    const tick = () => { this.renderer.render(this.scene, this.camera); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }

  // ---- mesh helpers ----
  _hslColor(hue){ const c = new THREE.Color(); c.setHSL(hue, 0.7, 0.6); return c; }

  _buildMesh(node){
    const mat = new THREE.MeshStandardMaterial({
      color: this._hslColor(node.hue), emissive: this._hslColor(node.hue),
      emissiveIntensity: 0.6, metalness: 0.1, roughness: 0.25,
      transparent: true, opacity: 0.78
    });
    const mesh = new THREE.Mesh(geometryFor(node.kind), mat);
    mesh.position.set(node.x, node.y, node.z);
    mesh.scale.setScalar(node.s);
    mesh.userData.id = node.id;
    this.group.add(mesh);
    this.nodes.set(node.id, { node, mesh });
    return mesh;
  }

  _removeMesh(id){
    const rec = this.nodes.get(id);
    if (!rec) return;
    this.group.remove(rec.mesh);
    rec.mesh.geometry.dispose(); rec.mesh.material.dispose();
    this.nodes.delete(id);
  }

  _highlight(){
    for (const { node, mesh } of this.nodes.values())
      mesh.material.emissiveIntensity = (node.id === this.selection) ? 1.1 : 0.55;
  }

  // ---- command stack ----
  apply(cmd){ this._perform(cmd); this.undoStack.push(cmd); this.redoStack.length = 0; this._save(); this._notify(); }
  undo(){ const c = this.undoStack.pop(); if (!c) return; this._perform(this._inverse(c)); this.redoStack.push(c); this._save(); this._notify(); }
  redo(){ const c = this.redoStack.pop(); if (!c) return; this._perform(c); this.undoStack.push(c); this._save(); this._notify(); }
  get canUndo(){ return this.undoStack.length > 0; }
  get canRedo(){ return this.redoStack.length > 0; }

  _inverse(c){
    switch(c.op){
      case 'add': return { op:'remove', node:c.node };
      case 'remove': return { op:'add', node:c.node };
      case 'move': return { op:'move', id:c.id, from:c.to, to:c.from };
      case 'scale': return { op:'scale', id:c.id, from:c.to, to:c.from };
      case 'swap': return { op:'swap', a:c.a, b:c.b, pa:c.pb, pb:c.pa };
    }
  }

  _perform(c){
    switch(c.op){
      case 'add': this._buildMesh({ ...c.node }); this.selection = c.node.id; break;
      case 'remove': this._removeMesh(c.node.id); if (this.selection === c.node.id) this.selection = null; break;
      case 'move': { const r = this.nodes.get(c.id); if (r){ r.node.x=c.to.x; r.node.y=c.to.y; r.node.z=c.to.z; r.mesh.position.set(c.to.x,c.to.y,c.to.z);} break; }
      case 'scale': { const r = this.nodes.get(c.id); if (r){ r.node.s=c.to; r.mesh.scale.setScalar(c.to);} break; }
      case 'swap': {
        const ra = this.nodes.get(c.a), rb = this.nodes.get(c.b);
        if (ra && rb){ const tmp = {...ra.node}; this._setPos(ra,c.pb); this._setPos(rb,{x:tmp.x,y:tmp.y,z:tmp.z}); }
        break;
      }
    }
    this._highlight();
  }
  _setPos(rec, p){ rec.node.x=p.x; rec.node.y=p.y; rec.node.z=p.z; rec.mesh.position.set(p.x,p.y,p.z); }

  // ---- high-level ops (voice + touch + hands) ----
  addShape(kind, pos){
    const p = pos || { x:(Math.random()-0.5), y:(Math.random()*0.4), z:(Math.random()-0.5) };
    const node = { id: uid(), kind, x:p.x, y:p.y, z:p.z, s:0.7, hue: 0.5 + Math.random()*0.12 };
    this.apply({ op:'add', node });
  }
  multiply(kind, count){ for (let i=0;i<Math.max(1,Math.min(count,25));i++) this.addShape(kind); }
  grow(id){ this._scale(id ?? this.selection, 1.25); }
  shrink(id){ this._scale(id ?? this.selection, 0.8); }
  _scale(id, f){ const r = this.nodes.get(id); if (!r) return; const to = Math.max(0.15, Math.min(r.node.s*f, 4)); this.apply({ op:'scale', id, from:r.node.s, to }); }
  deleteSelected(id){ const tid = id ?? this.selection; const r = this.nodes.get(tid); if (r) this.apply({ op:'remove', node:{...r.node} }); }
  swapFirstTwo(){ const ids=[...this.nodes.keys()]; if (ids.length<2) return; const a=this.nodes.get(ids[0]).node, b=this.nodes.get(ids[1]).node;
    this.apply({ op:'swap', a:ids[0], b:ids[1], pa:{x:a.x,y:a.y,z:a.z}, pb:{x:b.x,y:b.y,z:b.z} }); }
  clear(){ [...this.nodes.keys()].forEach(id => { const r=this.nodes.get(id); this.apply({ op:'remove', node:{...r.node} }); }); }

  // Live drag (no history) + commit (records net move) — used by touch & hands.
  liveMove(id, p){ const r = this.nodes.get(id); if (r){ r.node.x=p.x; r.node.y=p.y; r.node.z=p.z; r.mesh.position.set(p.x,p.y,p.z);} }
  commitMove(id, from, to){ if (from.x===to.x && from.y===to.y && from.z===to.z) return; this.apply({ op:'move', id, from, to }); }

  // ---- pointer (touch / mouse) selection + drag ----
  _bindPointer(){
    const c = this.canvas;
    let dragId = null, start = null, plane = new THREE.Plane(), grabOffset = new THREE.Vector3();

    const ndc = (e) => {
      const r = c.getBoundingClientRect();
      return new THREE.Vector2(((e.clientX-r.left)/r.width)*2-1, -((e.clientY-r.top)/r.height)*2+1);
    };
    const hit = (e) => {
      this.raycaster.setFromCamera(ndc(e), this.camera);
      const meshes = [...this.nodes.values()].map(v => v.mesh);
      return this.raycaster.intersectObjects(meshes, false)[0] || null;
    };

    c.addEventListener('pointerdown', (e) => {
      const h = hit(e);
      if (h){
        dragId = h.object.userData.id; this.selection = dragId; this._highlight();
        const r = this.nodes.get(dragId); start = { x:r.node.x, y:r.node.y, z:r.node.z };
        // Drag on a camera-facing plane through the object.
        plane.setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(new THREE.Vector3()).negate(), h.object.position);
        const pt = new THREE.Vector3(); this.raycaster.ray.intersectPlane(plane, pt);
        grabOffset.copy(h.object.position).sub(pt);
        c.setPointerCapture(e.pointerId);
      }
    });
    c.addEventListener('pointermove', (e) => {
      if (!dragId) return;
      this.raycaster.setFromCamera(ndc(e), this.camera);
      const pt = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(plane, pt)){ pt.add(grabOffset); this.liveMove(dragId, { x:pt.x, y:pt.y, z:pt.z }); }
    });
    const end = () => { if (dragId){ const r=this.nodes.get(dragId); this.commitMove(dragId, start, {x:r.node.x,y:r.node.y,z:r.node.z}); } dragId=null; start=null; };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  // Map a normalized screen point (0..1) to a world position on the model plane
  // — used by camera hand control to move the selection.
  screenToWorld(nx, ny){
    this.raycaster.setFromCamera(new THREE.Vector2(nx*2-1, -(ny*2-1)), this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0,0,1), 0);
    const pt = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, pt) ? { x:pt.x, y:pt.y, z:0 } : null;
  }

  // ---- persistence ----
  _save(){
    const nodes = [...this.nodes.values()].map(v => v.node);
    try{ localStorage.setItem(STORE_KEY, JSON.stringify(nodes)); }catch{}
  }
  load(){
    try{
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
      saved.forEach(n => this._buildMesh(n));
    }catch{}
    this._highlight();
  }
  _notify(){ this.onChange?.(); }
}
