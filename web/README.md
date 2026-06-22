# A.C.T.I.G. — Web App (PWA) for iPhone & iPad

Because **Swift Playgrounds is not available on iPhone**, this is the iPhone-ready
build: a **Progressive Web App** you install straight from Safari — no Mac, no
App Store, no jailbreak. It runs on **iPhone and iPad** (and Android/desktop too)
and works **offline after the first load**.

It implements all the same features as the native app, using on-device web tech:

| Feature | Technology (all on-device) |
|---|---|
| Local offline LLM brain | **WebLLM** (MLC) on **WebGPU** — Qwen2.5-1.5B, cached after first load |
| Jarvis hologram UI + chat box + mic buttons | HTML/CSS, draggable overlay |
| Voice output ("Jarvis" voice) | Web Speech Synthesis |
| Voice input (iOS-compatible) | **Whisper** via transformers.js (on-device) + VAD; uses Web Speech recognition where available |
| Reply interruption (barge-in) | Mic energy detection cancels generation + speech |
| Wake / sleep | "wake up ACTIG" / "shut down all systems" + tap-to-wake |
| 3D modelling space | **Three.js** — add/multiply/resize/move/swap/drag, undo/redo, autosave |
| Camera hand control | **MediaPipe Hand Landmarker** — pinch to grab/move shapes |
| Object analysis | **MediaPipe Image Classifier** + colour → answered by the LLM |
| Activation greeting | *"Welcome sir, ACTIG at your service sir, how may I assist you sir."* (text + voice) |

## Requirements
- **iOS / iPadOS 18 or later** recommended (for WebGPU → real on-device LLM). On
  older versions everything else still works and the LLM uses a lightweight stub.
- Safari (for installing to the Home Screen). Camera + microphone permission.

## Install on your iPhone/iPad (the "download")

**One-time setup (do this once — only the repo owner can):** GitHub's automatic
workflow token is *not allowed to turn Pages on*, so you must enable it yourself
first. This is the cause of the *"Resource not accessible by integration"* /
*"Get Pages site failed"* errors.

1. In the repo: **Settings → Pages → Build and deployment → Source: "GitHub
   Actions"**. (This creates the Pages site so the workflow no longer has to.)
2. *Only if a run still shows "Resource not accessible by integration":*
   **Settings → Actions → General → Workflow permissions → "Read and write
   permissions" → Save.**

**Then deploy and install:**
3. Open the **Actions** tab → **"Deploy A.C.T.I.G. PWA"** → **Run workflow** (or
   push a change under `web/`). When green, the job summary shows your URL, e.g.
   `https://pompomroma.github.io/a.c.t.i.g.-ipad-/`.
   *(HTTPS is mandatory: camera, mic, WebGPU and offline install all require a
   secure context.)*
4. On the iPhone, open that URL in **Safari → Share → Add to Home Screen**.

> Deploying from the **default branch (`main`)** is recommended — the included PR
> into `main` does this and also avoids the *"github-pages environment / branch
> not allowed"* protection error. If you ever deploy from a feature branch and hit
> that, allow the branch under **Settings → Environments → github-pages**.
2. On the device, **open that URL in Safari**.
3. Tap **Share → Add to Home Screen**. A.C.T.I.G. now has a real app icon and
   launches full-screen.
4. Open it. On first launch (online) it downloads the model once; after that it
   runs **fully offline**. Grant **camera** and **microphone** when asked.

## Using it
- Tap the glowing **A.C.T.I.G.** badge (or say nothing yet — the first tap is
  needed because iOS only allows mic/audio to start from a user tap). It greets
  you, then listens.
- Say or type commands — e.g. *"bring up the 3D project"*, *"add three spheres"*,
  *"make it bigger"*, *"undo"*, *"enable camera controls"*, *"scan this"*,
  *"shut down all systems"*. Talk over a reply to interrupt and restate.
- Two mic buttons mute **your** mic and **A.C.T.I.G.'s** voice independently.

## Local testing (optional, desktop)
On a computer you can serve it over `localhost` (a secure context):
```bash
cd web
python3 -m http.server 8000
# open http://localhost:8000 in Chrome/Edge (WebGPU) — camera/mic/WebGPU work on localhost
```
For on-device testing you still need the HTTPS URL (step 1).

## Notes & fallbacks
- **No WebGPU?** The LLM falls back to a stub so the UI/voice/3D/camera all still
  work; enable WebGPU (iOS 18+) for real reasoning.
- **First load is heavy** (model weights + Whisper + MediaPipe). They're cached by
  the browser, so subsequent launches are fast and offline.
- The same honesty notes from [`../docs/CAPABILITIES.md`](../docs/CAPABILITIES.md)
  apply: a web app likewise cannot read other apps' accounts, run while the device
  is off, or float over other apps. It runs as its own installed app.
