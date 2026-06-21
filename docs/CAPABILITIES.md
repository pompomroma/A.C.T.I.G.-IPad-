# A.C.T.I.G. — Capabilities vs. Original Request

This document maps **every** feature you asked for to its real status on a
**stock (non-jailbroken) iPad**, so expectations are unambiguous. Legend:

- ✅ **Built** — implemented and works on a normal iPad.
- ⚠️ **Built, with a platform limit** — the realistic equivalent is implemented;
  a hard iPadOS rule narrows it.
- ❌ **Impossible on stock iPad** — blocked by the sandbox or by physics.
- 🔓 **Jailbreak-only** — see [`JAILBREAK.md`](JAILBREAK.md).

| # | Your requirement | Status | Notes |
|---|---|---|---|
| 1 | Local, fully offline AI on the M4 | ✅ | Apple Foundation Models (default) / MLX Qwen2.5-3B (optional) / offline stub. `Brain/`. |
| 2 | Text input (commands, files, images) | ✅ | `HologramChatBox` — text + Photos/file attach. |
| 3 | Voice input | ✅ | On-device `SFSpeechRecognizer`, `Voice/SpeechRecognizer.swift`. |
| 4 | Voice output, "Jarvis" mechanical voice | ✅ | `AVSpeechSynthesizer` tuned rate/pitch, `Voice/VoiceSynthesizer.swift`. |
| 5 | Reply **interruption** / restate (human-like fluency) | ✅ | `BargeInController` cancels generation + TTS the instant you speak. |
| 6 | Blue "Jarvis" hologram chat box always on screen | ⚠️ | Always present **inside the app**, draggable. iPadOS has **no draw-over-other-apps** API. |
| 7 | Mic mute buttons (user + AI), blue hologram | ✅ | `HologramMicButtons` — two glowing toggles. |
| 8 | Wake word "wake up ACTIG" | ⚠️ | Works while the app is foreground/active. **Always-on background** wake word is Siri-only. Mitigated by the Siri Shortcut. |
| 9 | Home-screen app icon to launch | ✅ | It's a normal app; also "Hey Siri, wake up ACTIG". |
| 10 | Buttons/box **hover over every other app** | ❌ / 🔓 | No `SYSTEM_ALERT_WINDOW` equivalent on iPadOS. Closest stock: Picture-in-Picture / Live Activities. Full overlay is jailbreak-only. |
| 11 | "shut down all systems" to stop | ✅ | `WakeWordDetector` + `ShutdownACTIGIntent`. |
| 12 | 3D modelling project space (voice/text to open) | ✅ | `Scene3D/SceneEditorView` (RealityKit). |
| 13 | Shape calling / multiplying / resize / swap / drag | ✅ | `SceneStore` + `ShapeFactory`; touch + voice. |
| 14 | Auto-save + bring back previous actions (undo) | ✅ | Command stack with undo/redo + autosave, `SceneStore`. |
| 15 | Camera-based finger control, no touch (opt-in) | ✅ | Vision hand-pose pinch-to-grab, `Vision/HandTrackingController.swift`; enabled only on command. |
| 16 | Camera object analysis + Q&A | ✅ | `Vision/ObjectAnalyzer.swift` → LLM answer. |
| 17 | Run **eternally in background, even when iPad is off** | ❌ | A powered-off device runs no code (physics). Backgrounded apps are suspended by iOS. We persist state and resume instantly on relaunch/wake. |
| 18 | Access **all** info, hardware, internet, search history, Bluetooth, browsers | ❌ | The app sandbox blocks reading other apps' data and most system internals. Not bypassable without a jailbreak, and even then see #19. |
| 19 | Access saved **accounts** (Netflix, game logins) in the device | ❌ (excluded) | Other apps' credentials live in their private keychain/sandbox. Reading them is credential theft and is **not implemented — even on jailbreak.** |

## Why the ❌ items are truly blocked

- **"Even when the iPad is off."** Power off = CPU unpowered. No software — not
  Siri, not the OS — runs. This is physics, not a setting.
- **Background always-on mic.** iOS grants continuous background microphone /
  wake-word listening only to Siri. Third-party apps are suspended in the
  background and lose the mic. (We listen while active and use a Siri Shortcut to
  launch hands-free.)
- **Overlay over other apps.** Unlike Android's `SYSTEM_ALERT_WINDOW`, iPadOS has
  no API to draw interactive UI over other apps. Allowed cross-app surfaces are
  Picture-in-Picture, Live Activities, and widgets — none is a free-floating
  control panel.
- **Other apps' data / accounts.** Each app is sandboxed; the OS does not expose
  other apps' files, keychains, browser history, or logins. This is the core iOS
  security model.

## The realistic "always there" experience we ship instead

- State (conversation + 3D scene) **autosaves** and **restores on launch**, so it
  feels continuous.
- **"Hey Siri, wake up ACTIG"** launches it from anywhere on the device.
- Inside the app, the hologram overlay genuinely **floats over every workspace**
  and is draggable.

See [`JAILBREAK.md`](JAILBREAK.md) for what changes (and the serious risks) if the
device is jailbroken.
