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
    // Retry with minimal options if the first context request fails so a fussy
    // browser doesn't block the whole 3D space.
    try{
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas, antialias: true, alpha: true,
        powerPreference: 'default', failIfMajorPerformanceCaveat: false,
      });
    }catch(e){
      console.warn('WebGL antialias context failed, retrying minimal:', e);
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true });
    }
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
    // Re-fit to the device frame on every kind of viewport change (orientation,
    // iOS chrome show/hide, split-view) so the 3D view always fills the screen.
    const onResize = () => this.resize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', () => setTimeout(onResize, 200));
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
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
    // Non-uniform scale (sx/sy/sz) when present — lets modelled parts be
    // elongated/flat (car bodies, roofs, legs); else the uniform scale `s`.
    if (node.sx != null || node.sy != null || node.sz != null)
      mesh.scale.set(node.sx ?? node.s, node.sy ?? node.s, node.sz ?? node.s);
    else
      mesh.scale.setScalar(node.s);
    mesh.rotation.set(node.rx || 0, node.ry || 0, node.rz || 0);   // ||0 keeps old saves valid
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
      case 'rotate': return { op:'rotate', id:c.id, from:c.to, to:c.from };
      case 'swap': return { op:'swap', a:c.a, b:c.b, pa:c.pb, pb:c.pa };
      case 'addMany': return { op:'removeMany', nodes:c.nodes };
      case 'removeMany': return { op:'addMany', nodes:c.nodes };
    }
  }

  _perform(c){
    switch(c.op){
      case 'add': this._buildMesh({ ...c.node }); this.selection = c.node.id; break;
      case 'remove': this._removeMesh(c.node.id); if (this.selection === c.node.id) this.selection = null; break;
      case 'move': { const r = this.nodes.get(c.id); if (r){ r.node.x=c.to.x; r.node.y=c.to.y; r.node.z=c.to.z; r.mesh.position.set(c.to.x,c.to.y,c.to.z);} break; }
      case 'scale': { const r = this.nodes.get(c.id); if (r){ r.node.s=c.to; r.mesh.scale.setScalar(c.to);} break; }
      case 'rotate': { const r = this.nodes.get(c.id); if (r){ r.node.rx=c.to.x; r.node.ry=c.to.y; r.node.rz=c.to.z; r.mesh.rotation.set(c.to.x,c.to.y,c.to.z);} break; }
      case 'swap': {
        const ra = this.nodes.get(c.a), rb = this.nodes.get(c.b);
        if (ra && rb){ const tmp = {...ra.node}; this._setPos(ra,c.pb); this._setPos(rb,{x:tmp.x,y:tmp.y,z:tmp.z}); }
        break;
      }
      case 'addMany': { c.nodes.forEach(n => this._buildMesh({ ...n })); this.selection = c.nodes[c.nodes.length-1]?.id ?? this.selection; break; }
      case 'removeMany': { c.nodes.forEach(n => this._removeMesh(n.id)); this.selection = null; break; }
    }
    this._highlight();
  }
  _setPos(rec, p){ rec.node.x=p.x; rec.node.y=p.y; rec.node.z=p.z; rec.mesh.position.set(p.x,p.y,p.z); }

  // ---- high-level ops (voice + touch + hands) ----
  addShape(kind, pos){
    const p = pos || { x:(Math.random()-0.5), y:(Math.random()*0.4), z:(Math.random()-0.5) };
    const node = { id: uid(), kind, x:p.x, y:p.y, z:p.z, s:0.7, rx:0, ry:0, rz:0, hue: 0.5 + Math.random()*0.12 };
    this.apply({ op:'add', node });
  }
  multiply(kind, count){ for (let i=0;i<Math.max(1,Math.min(count,25));i++) this.addShape(kind); }

  // Resolve which object a voice/touch command targets: an explicit id, else the
  // current selection, else the most-recently added object — so "make it bigger"
  // works even when nothing was tapped (e.g. right after reopening the space).
  _targetId(id){
    if (id && this.nodes.has(id)) return id;
    if (this.selection && this.nodes.has(this.selection)) return this.selection;
    const ids = [...this.nodes.keys()];
    return ids.length ? ids[ids.length-1] : null;
  }

  grow(id){ this._scale(this._targetId(id), 1.25); }
  shrink(id){ this._scale(this._targetId(id), 0.8); }
  _scale(id, f){
    const r = this.nodes.get(id); if (!r) return; this.selection = id;
    // Scale non-uniform parts on every axis so modelled pieces keep their shape.
    if (r.node.sx != null || r.node.sy != null || r.node.sz != null){
      ['sx','sy','sz'].forEach(k => { const base = r.node[k] ?? r.node.s; r.node[k] = Math.max(0.05, Math.min(base*f, 6)); });
      r.mesh.scale.set(r.node.sx ?? r.node.s, r.node.sy ?? r.node.s, r.node.sz ?? r.node.s);
      this._save(); this._notify(); return;
    }
    const to = Math.max(0.15, Math.min(r.node.s*f, 4)); this.apply({ op:'scale', id, from:r.node.s, to });
  }

  // Rotate the target object by `degrees` about `axis` ('x'|'y'|'z'). Undoable.
  rotate(axis='y', degrees=90, id){
    const tid = this._targetId(id); const r = this.nodes.get(tid); if (!r) return;
    this.selection = tid;
    const from = { x:r.node.rx||0, y:r.node.ry||0, z:r.node.rz||0 };
    const to = { ...from };
    to[axis] = (from[axis] || 0) + degrees * Math.PI/180;
    this.apply({ op:'rotate', id:tid, from, to });
  }

  deleteSelected(id){ const tid = this._targetId(id); const r = this.nodes.get(tid); if (r) this.apply({ op:'remove', node:{...r.node} }); }

  // Move the target object by a delta (voice "move left/up/forward"). Clamped so
  // it stays on the grid. Undoable via the existing 'move' op.
  moveBy(dx, dy, dz, id){
    const tid = this._targetId(id); const r = this.nodes.get(tid); if (!r) return;
    this.selection = tid;
    const clamp = (v) => Math.max(-3.5, Math.min(3.5, v));
    const from = { x:r.node.x, y:r.node.y, z:r.node.z };
    const to = { x:clamp(from.x+dx), y:clamp(from.y+dy), z:clamp(from.z+dz) };
    if (from.x===to.x && from.y===to.y && from.z===to.z) return;
    this.apply({ op:'move', id:tid, from, to });
  }
  // Move the target object to an absolute position (voice "move to the center").
  moveTo(x, y, z, id){
    const tid = this._targetId(id); const r = this.nodes.get(tid); if (!r) return;
    this.selection = tid;
    const from = { x:r.node.x, y:r.node.y, z:r.node.z };
    this.apply({ op:'move', id:tid, from, to:{ x, y, z } });
  }
  swapFirstTwo(){ const ids=[...this.nodes.keys()]; if (ids.length<2) return; const a=this.nodes.get(ids[0]).node, b=this.nodes.get(ids[1]).node;
    this.apply({ op:'swap', a:ids[0], b:ids[1], pa:{x:a.x,y:a.y,z:a.z}, pb:{x:b.x,y:b.y,z:b.z} }); }

  // Assemble a model (list of part specs from the modeler) as ONE undo-able batch.
  addModel(parts){
    if (!parts || !parts.length) return;
    const nodes = parts.map((p) => ({
      id: uid(), kind: p.kind || 'box',
      x: p.x || 0, y: p.y || 0, z: p.z || 0,
      s: p.s ?? 0.7,
      ...(p.sx != null ? { sx: p.sx } : {}), ...(p.sy != null ? { sy: p.sy } : {}), ...(p.sz != null ? { sz: p.sz } : {}),
      rx: p.rx || 0, ry: p.ry || 0, rz: p.rz || 0,
      hue: p.hue ?? (0.5 + Math.random()*0.12),
    }));
    this.apply({ op:'addMany', nodes });
  }
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
    // Default the selection to the last object so voice edits work without a tap.
    const ids = [...this.nodes.keys()];
    if (ids.length) this.selection = ids[ids.length-1];
    this._highlight();
  }
  _notify(){ this.onChange?.(); }

  // ---- export / import ----
  // Wavefront OBJ of the whole scene (world-space, triangulated). No external
  // libraries — works fully offline. Returns '' when the scene is empty.
  exportOBJ(){
    if (!this.nodes.size) return '';
    let out = '# A.C.T.I.G. 3D model export\n';
    let vOffset = 0;
    const v = new THREE.Vector3();
    for (const { node, mesh } of this.nodes.values()){
      mesh.updateMatrixWorld(true);
      const geo = mesh.geometry;
      const pos = geo.attributes.position;
      out += `o ${node.kind}_${node.id}\n`;
      for (let i = 0; i < pos.count; i++){
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        out += `v ${v.x.toFixed(5)} ${v.y.toFixed(5)} ${v.z.toFixed(5)}\n`;
      }
      const idx = geo.index;
      const faceCount = idx ? idx.count : pos.count;
      for (let i = 0; i < faceCount; i += 3){
        const a = (idx ? idx.getX(i)   : i)     + 1 + vOffset;
        const b = (idx ? idx.getX(i+1) : i+1)   + 1 + vOffset;
        const c = (idx ? idx.getX(i+2) : i+2)   + 1 + vOffset;
        out += `f ${a} ${b} ${c}\n`;
      }
      vOffset += pos.count;
    }
    return out;
  }

  // A.C.T.I.G.-native scene file (the node list) — re-openable via importJSON.
  exportJSON(){ return JSON.stringify([...this.nodes.values()].map(v => v.node), null, 2); }

  // Replace the scene with a previously exported node list (one undo-able batch).
  importJSON(nodes){
    if (!Array.isArray(nodes)) return false;
    const valid = nodes.filter(n => n && typeof n === 'object' && n.kind);
    if (!valid.length) return false;
    const old = [...this.nodes.values()].map(v => ({ ...v.node }));
    if (old.length) this.apply({ op:'removeMany', nodes: old });
    this.apply({ op:'addMany', nodes: valid.map(n => ({ id: uid(), s:0.7, rx:0, ry:0, rz:0, hue:0.55, ...n })) });
    return true;
  }
}
