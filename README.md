# A.C.T.I.G. — Offline On-Device AI Assistant for iPad & iPhone

A Jarvis-style, fully **offline** AI assistant that runs **directly on your iPad
Pro 13" (M4)** *and on iPhone*. Every function works on both, with layouts that
adapt to each screen and orientation. It ships in **two forms** so it can run on
any device with **no Mac required** — a Web App (PWA) for iPhone + iPad, and a
native Swift app for iPad.

On activation it greets you — by voice and text:
> **"Welcome sir, ACTIG at your service sir, how may I assist you sir."**

## Two ways to run it

| Build | Best for | How to install |
|---|---|---|
| **Web App / PWA** → [`web/`](web/README.md) | **iPhone *and* iPad** (and Android/desktop) | Open the HTTPS URL in Safari → **Add to Home Screen**. No Mac, no App Store. |
| **Native Swift app** → [`ACTIG.swiftpm/`](ACTIG.swiftpm) | iPad (and Mac) | Open in **Swift Playgrounds** and Run. Fully offline, all-native. |
| **Web app in Swift Playgrounds** → [`ACTIGWeb.swiftpm/`](ACTIGWeb.swiftpm) | iPad — running the web build inside Swift Playgrounds | Open in **Swift Playgrounds** and Run. Bundles the web app + local server. |

Both Swift Playgrounds packages are covered in
[`docs/SWIFT_PLAYGROUNDS.md`](docs/SWIFT_PLAYGROUNDS.md). **iPhone users: use the
PWA.** All builds run offline (the native app fully; the web builds run the UI/3D/
voice offline with the model loading once online).

---
## Native Swift app (iPad / Mac)

> **Read this first:** Some things you might expect from a "take over the whole
> device" assistant are **not possible on a normal iPad** — Apple's sandbox
> forbids them, and a couple are physically impossible. A.C.T.I.G. delivers the
> full, real version of everything that *is* possible and is honest about the
> rest. See [`docs/CAPABILITIES.md`](docs/CAPABILITIES.md) for the exact
> requirement-by-requirement breakdown, and [`docs/JAILBREAK.md`](docs/JAILBREAK.md)
> for the features that only a jailbroken device could reach.

---

## What it does (all on-device, all offline)

- 🧠 **Local LLM brain** — runs entirely on the M4. Default engine is Apple's
  on-device **Foundation Models** (Apple Intelligence, zero download). Optional
  **MLX + Qwen2.5-3B** for a custom model. Always-available offline **stub**
  fallback so the app never breaks.
- 🔵 **Jarvis hologram UI** — a draggable blue hologram chat box + pulsing core
  that floats over whatever you're doing **inside the app**. Type, attach
  files/images, or talk.
- 🎙️ **Voice in/out with barge-in** — on-device speech-to-text, a crisp
  mechanical "Jarvis" voice, and **interruption**: start talking while it's
  replying and it stops instantly so you can restate.
- 🗣️ **Wake / sleep** — say **"wake up ACTIG"** to come online and
  **"shut down all systems"** to go dormant. A **Siri Shortcut** ("Hey Siri,
  wake up ACTIG") launches it hands-free from anywhere.
- 🧊 **3D modelling project space** — call up shapes by voice, touch, or hand;
  multiply, resize, move, drag, swap, and **undo/redo** with **autosave**.
- ✋ **Camera hand control** — opt-in pinch-to-grab finger control of 3D shapes
  with **no screen touch** (front camera + Vision hand tracking).
- 🔎 **Camera object analysis** — point the camera at something, say "scan this",
  and A.C.T.I.G. identifies it (classification + on-image text + colour) and
  answers questions about it.

---

## Download, install & run on iPad (Swift Playgrounds)

> **iPhone?** Swift Playgrounds is **iPad/Mac only** — install the **[Web App
> (PWA)](web/README.md)** on iPhone instead. The steps below are for iPad.

1. **Install Swift Playgrounds** (4.5 or later) from the App Store — it's free.
2. **Get the project onto the device.** Either:
   - Clone/download this repo and AirDrop the `ACTIG.swiftpm` folder to the
     device, then tap it — it opens straight in Swift Playgrounds; **or**
   - In Swift Playgrounds tap **＋ → App**, then recreate the files from this repo.
3. **Open `ACTIG.swiftpm`** in Swift Playgrounds.
4. Tap **▶ Run**. On first launch, grant **Microphone**, **Speech Recognition**
   and **Camera** permissions when prompted.
5. (Optional, recommended) Add the **"Wake up ACTIG"** Siri phrase: it's
   registered automatically via App Shortcuts, so just say **"Hey Siri, wake up
   ACTIG"**. You can also find it in the Shortcuts app.

That's it — after setup it runs **fully offline**. Put the iPad in Airplane Mode
and it still works.

### Choosing the brain (model)

| Engine | Setup | Notes |
|---|---|---|
| **Apple Foundation Models** (default) | None | On-device Apple Intelligence (iPadOS 26+, M-series). Zero download. |
| **MLX + Qwen2.5-3B-Instruct 4-bit** | Uncomment the MLX lines in `Package.swift` | ~1.8 GB one-time download, then offline. Best for a custom/larger model. |
| **Offline stub** | Automatic fallback | No real reasoning — keeps the UI/voice loop working if no model is available. |

The app auto-selects the best available engine at launch (see
`Brain/LLMEngine.swift` → `LLMEngineFactory`).

---

## How to talk to it (examples)

| You say / type | What happens |
|---|---|
| "wake up ACTIG" | Comes online, hologram appears |
| "bring up the 3D project" | Opens the 3D modelling space |
| "add a cube", "make three spheres", "multiply the box five times" | Creates shapes |
| "make it bigger", "shrink it", "swap positions", "delete it" | Edits the selection |
| "undo" / "redo" | Steps backward/forward through your actions |
| "enable camera controls" | Turns on pinch-to-grab finger control |
| "scan this" / "what is this?" (camera mode) | Analyses the object and answers |
| "shut down all systems" | Goes dormant |

---

## Project layout

```
ACTIG.swiftpm/
  Package.swift            App manifest (capabilities, optional MLX dep)
  App/                     Entry point + shared AppState
  UI/                      Hologram overlay, chat box, mic buttons, theme
  Voice/                   Speech-to-text, TTS, barge-in, wake word
  Brain/                   LLM engines, conversation, orchestrator, intent router
  Scene3D/                 RealityKit 3D space, shapes, undo/redo store
  Vision/                  Camera, hand tracking, object analysis
  Intents/                 Siri Shortcut ("Wake up ACTIG")
docs/
  CAPABILITIES.md          Every original requirement: works / impossible / jailbreak
  JAILBREAK.md             Architectural notes + strong warnings for the rest
```

## License & honesty

A.C.T.I.G. never accesses other apps' private data, accounts, or credentials —
iPadOS forbids it and it's a security boundary worth keeping. See
[`docs/CAPABILITIES.md`](docs/CAPABILITIES.md).
