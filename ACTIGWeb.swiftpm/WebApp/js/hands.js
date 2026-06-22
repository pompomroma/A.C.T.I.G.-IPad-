// Camera-based finger control via MediaPipe Hand Landmarker. Pinch (thumb tip
// near index tip) grabs the selected 3D shape; moving the pinched hand drags it;
// releasing drops it (committing the move to the undo stack). Opt-in only.

import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export class Hands {
  constructor(video, scene, overlay){
    this.video = video; this.scene = scene; this.overlay = overlay;
    this.landmarker = null;
    this.active = false;
    this._raf = null;
    this._grabId = null; this._grabStart = null; this._pinching = false;
    this.onIndicator = null;   // (x,y,pinching) for HUD
  }

  async init(){
    if (this.landmarker) return true;
    try{
      const fileset = await FilesetResolver.forVisionTasks(WASM);
      this.landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL, delegate: ('gpu' in navigator) ? 'GPU' : 'CPU' },
        numHands: 1, runningMode: 'VIDEO'
      });
      return true;
    }catch(e){ console.warn('HandLandmarker init failed', e); return false; }
  }

  start(){ if (this.active) return; this.active = true; this._loop(); }
  stop(){ this.active = false; if (this._raf) cancelAnimationFrame(this._raf); this._endGrab(); this._clearOverlay(); }

  _loop(){
    if (!this.active || !this.landmarker) return;
    const run = () => {
      if (!this.active) return;
      if (this.video.readyState >= 2){
        let res;
        try{ res = this.landmarker.detectForVideo(this.video, performance.now()); }catch{}
        if (res && res.landmarks && res.landmarks[0]) this._handle(res.landmarks[0]);
        else { this._endGrab(); this._clearOverlay(); }
      }
      this._raf = requestAnimationFrame(run);
    };
    this._raf = requestAnimationFrame(run);
  }

  _handle(lm){
    const thumb = lm[4], index = lm[8];
    const dist = Math.hypot(thumb.x-index.x, thumb.y-index.y);
    const pinching = dist < 0.06;
    const x = index.x, y = index.y;   // normalized 0..1
    this._drawIndicator(x, y, pinching);
    this.onIndicator?.(x, y, pinching);

    if (pinching && !this._pinching) this._beginGrab();
    else if (pinching && this._grabId){ const w = this.scene.screenToWorld(x, y); if (w) this.scene.liveMove(this._grabId, w); }
    else if (!pinching && this._pinching) this._endGrab();
    this._pinching = pinching;
  }

  _beginGrab(){
    this._grabId = this.scene.selection || [...this.scene.nodes.keys()].pop() || null;
    const r = this._grabId && this.scene.nodes.get(this._grabId);
    this._grabStart = r ? { x:r.node.x, y:r.node.y, z:r.node.z } : null;
  }
  _endGrab(){
    if (this._grabId && this._grabStart){
      const r = this.scene.nodes.get(this._grabId);
      if (r) this.scene.commitMove(this._grabId, this._grabStart, { x:r.node.x, y:r.node.y, z:r.node.z });
    }
    this._grabId = null; this._grabStart = null;
  }

  _drawIndicator(x, y, pinching){
    const c = this.overlay; if (!c) return;
    const ctx = c.getContext('2d');
    if (c.width !== c.clientWidth) c.width = c.clientWidth;
    if (c.height !== c.clientHeight) c.height = c.clientHeight;
    ctx.clearRect(0,0,c.width,c.height);
    ctx.beginPath();
    ctx.arc(x*c.width, y*c.height, pinching ? 16 : 12, 0, Math.PI*2);
    ctx.fillStyle = pinching ? 'rgba(255,90,107,.9)' : 'rgba(140,230,255,.9)';
    ctx.shadowColor = '#52bcff'; ctx.shadowBlur = 14; ctx.fill();
  }
  _clearOverlay(){ const c=this.overlay; if (c){ const ctx=c.getContext('2d'); ctx && ctx.clearRect(0,0,c.width,c.height); } }
}
