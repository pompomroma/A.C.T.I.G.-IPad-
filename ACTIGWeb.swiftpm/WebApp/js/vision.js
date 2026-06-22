// Camera object analysis: MediaPipe image classification + dominant colour from
// a single captured frame. The structured summary is fed to the LLM so A.C.T.I.G.
// can answer the user's question conversationally. All on-device.

import { ImageClassifier, FilesetResolver } from '@mediapipe/tasks-vision';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/image_classifier/efficientnet_lite0/float32/1/efficientnet_lite0.tflite';

export class Vision {
  constructor(){ this.classifier = null; }

  async init(){
    if (this.classifier) return true;
    try{
      const fileset = await FilesetResolver.forVisionTasks(WASM);
      this.classifier = await ImageClassifier.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL, delegate: ('gpu' in navigator) ? 'GPU' : 'CPU' },
        maxResults: 5, runningMode: 'IMAGE'
      });
      return true;
    }catch(e){ console.warn('ImageClassifier init failed', e); return false; }
  }

  /** Analyse a video frame; returns a natural-language summary string. */
  async analyze(video){
    const labels = await this._classify(video);
    const colour = this._dominantColour(video);
    const parts = [];
    if (labels.length){
      const top = labels[0];
      const others = labels.slice(1, 4).map(l => l.name).join(', ');
      parts.push(`Likely a ${top.name} (${Math.round(top.score*100)}% confidence)` + (others ? `; possibly: ${others}` : ''));
    }
    if (colour) parts.push(`Dominant colour: ${colour}`);
    return parts.length ? parts.join('. ') : 'No distinguishing features detected.';
  }

  async _classify(video){
    if (!this.classifier) return [];
    try{
      const res = this.classifier.classify(video);
      const cats = res?.classifications?.[0]?.categories || [];
      return cats.filter(c => c.score > 0.08).map(c => ({ name:(c.categoryName||'object').replace(/_/g,' '), score:c.score }));
    }catch(e){ console.warn('classify failed', e); return []; }
  }

  _dominantColour(video){
    try{
      const cnv = document.createElement('canvas'); cnv.width = 32; cnv.height = 32;
      const ctx = cnv.getContext('2d'); ctx.drawImage(video, 0, 0, 32, 32);
      const d = ctx.getImageData(0,0,32,32).data;
      let r=0,g=0,b=0,n=0;
      for (let i=0;i<d.length;i+=4){ r+=d[i]; g+=d[i+1]; b+=d[i+2]; n++; }
      r/=n; g/=n; b/=n;
      if (r>180&&g>180&&b>180) return 'white';
      if (r<60&&g<60&&b<60) return 'black';
      if (r>g&&r>b) return 'red/warm';
      if (g>r&&g>b) return 'green';
      if (b>r&&b>g) return 'blue';
      return 'neutral grey';
    }catch{ return null; }
  }
}
