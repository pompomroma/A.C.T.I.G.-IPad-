# A.C.T.I.G. — Jailbreak Addendum (read the warnings)

You asked for the features that a stock iPad cannot provide. This document
explains, **at an architectural level**, what a jailbreak would change and why
most of it is still a bad idea. It is **not** a step-by-step jailbreak guide and
contains **no exploit code**.

## ⚠️ Before you consider this

- **Warranty & support:** jailbreaking voids your Apple warranty and can break
  Apple Intelligence, Apple Pay, and OS updates.
- **Security:** a jailbreak disables the protections that keep your banking,
  passwords, and accounts safe. The same holes A.C.T.I.G. would use, malware uses.
- **Stability:** background daemons and UI hooks can cause crashes, battery
  drain, and boot loops.
- **It still can't run when the device is OFF.** No jailbreak changes physics.
- **This is for YOUR OWN device only.** None of this should ever target someone
  else's device or defeat another person's security.

If you proceed, you do so at your own risk. The maintainers don't recommend it;
the stock build above already delivers the safe, supported feature set.

## What a jailbreak *could* enable (and how, conceptually)

These map to the ❌ items in [`CAPABILITIES.md`](CAPABILITIES.md).

### 1. A true system-wide hovering overlay (the chat box over every app)
- **Stock blocker:** no `SYSTEM_ALERT_WINDOW`-style API.
- **Jailbreak approach (concept):** a SpringBoard tweak built with a tooling
  framework like **Theos** injects a always-on-top `UIWindow` at a high window
  level into the system UI process, so the hologram renders above other apps.
- **Cost:** ties the assistant to a specific jailbroken iOS build; updates break it.

### 2. Always-on background wake word
- **Stock blocker:** only Siri may background-listen.
- **Jailbreak approach (concept):** a **LaunchDaemon** (a background process
  registered with `launchd`) holds a persistent audio session and runs a small
  keyword-spotting model continuously.
- **Cost:** constant battery/thermal load; fragile across reboots.

### 3. "Persistent" running across relaunch
- **Jailbreak approach (concept):** the same LaunchDaemon relaunches the
  assistant's core service after respring/reboot. Still **off when the device is
  off** — see the physics note above. This is the only ❌ item that becomes a real
  "always running" once granted root, within power constraints.

### 4. Broader hardware / system access
- **Jailbreak approach (concept):** running as `root` outside the sandbox grants
  read access to system frameworks and some device internals not exposed to App
  Store apps.

## What stays OUT even with a jailbreak — by design

**Reading other apps' saved accounts (Netflix, game logins), passwords, or
private browser history is excluded from this project entirely.** Those live in
other apps' private keychains and sandboxes; harvesting them is credential theft
and a security boundary worth keeping intact even on your own device. A.C.T.I.G.
will not implement it.

## A safer middle path

If your goal is "the assistant feels omnipresent" without jailbreaking:
- Use the **Siri Shortcut** to launch from anywhere ("Hey Siri, wake up ACTIG").
- Pin A.C.T.I.G. in **Slide Over** / **Stage Manager** so it floats beside other
  apps (Apple-supported multitasking, no overlay hack).
- Add a **Live Activity** / **widget** for at-a-glance presence outside the app.

These give most of the "always there" feel with none of the risk.
