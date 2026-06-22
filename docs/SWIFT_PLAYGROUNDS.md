# A.C.T.I.G. in Swift Playgrounds (iPad)

There are **two** Swift Playgrounds app packages, both importable and runnable
directly in Swift Playgrounds 4.5+ on iPad:

| Package | What it is | Best for |
|---|---|---|
| **`ACTIG.swiftpm`** | Fully **native** app (SwiftUI + RealityKit + Vision + Speech + Apple on-device LLM). | The most reliable "all functions, fully offline" experience. |
| **`ACTIGWeb.swiftpm`** | The **web app wrapped** in a WKWebView, served by a tiny in-app `127.0.0.1` server, with the whole `web/` build bundled. | Running your exact web A.C.T.I.G. inside Swift Playgrounds. |

## Import & run
1. Copy the package folder (`ACTIG.swiftpm` or `ACTIGWeb.swiftpm`) to the iPad
   (AirDrop, Files, or clone the repo) and **tap it** — it opens in Swift
   Playgrounds.
2. Press **▶ Run**. Grant **camera** and **microphone** (and, for the native app,
   **speech**) when prompted.

## Offline behaviour
- **`ACTIG.swiftpm` (native):** runs **fully offline** — the LLM (Apple Foundation
  Models / optional MLX), 3D space, camera analysis and voice are all on-device.
- **`ACTIGWeb.swiftpm` (web wrapper):** the UI, the **3D space** (Three.js is
  bundled locally), touch controls and **voice output** run **offline**. The
  conversation model (WebLLM), Whisper voice-input and MediaPipe hand/vision
  modules load from a CDN on **first use**, so those need a network the first time
  (then they're cached). Without a network they fall back gracefully (lite-mode
  chat, etc.) while everything else keeps working.

## "Background running / background voice calling" — the honest limit
iOS/iPadOS **does not allow any third-party app** (native or web) to:
- keep running or listening **in the background** or while another app is open, or
- launch itself from its **own** wake word when it isn't open.

Only **Siri** can open an app by voice. Both packages support this the supported
way:
- **Native (`ACTIG.swiftpm`):** ships an **App Shortcut** — say **"Hey Siri, wake
  up ACTIG"** to launch and bring it online (`Intents/ACTIGShortcuts.swift`).
- **Web wrapper / PWA:** open it from a **Siri Shortcut → "Open URL"** pointing at
  the app, using the `#wake` / `#scene` deep links so it auto-wakes on launch.

Once the app is open, the in-app wake word ("wake up ACTIG") and "shut down all
systems" work, and state autosaves so a relaunch resumes instantly.

## Keeping the web wrapper in sync
`ACTIGWeb.swiftpm/WebApp/` is a copy of `web/`. After changing the web build,
re-sync it:
```bash
rm -rf ACTIGWeb.swiftpm/WebApp && mkdir -p ACTIGWeb.swiftpm/WebApp
cp -R web/index.html web/manifest.webmanifest web/sw.js \
      web/css web/js web/icons web/vendor ACTIGWeb.swiftpm/WebApp/
```

## Notes
- The web wrapper needs **iPadOS 16.4+** (import maps / modern WebKit). The native
  app targets **iPadOS 18+**.
- WebGPU inside an in-app WKWebView isn't guaranteed; if it's unavailable the web
  wrapper's LLM runs in lite mode. For the full on-device model in Swift
  Playgrounds, use the **native** `ACTIG.swiftpm`.
