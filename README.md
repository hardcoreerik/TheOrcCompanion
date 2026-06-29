<div align="center">

![TheOrc Companion App Icon](assets/02_app_icon.png)

[![Platform](https://img.shields.io/badge/platform-Android%20%2B%20Web-21C55D?style=for-the-badge)](#quick-start)
[![React](https://img.shields.io/badge/React-19-111827?style=for-the-badge&logo=react)](#quick-start)
[![Capacitor](https://img.shields.io/badge/Capacitor-7-0EA5E9?style=for-the-badge&logo=capacitor)](#android-build)
[![Tailscale](https://img.shields.io/badge/Tailscale-ready-0F172A?style=for-the-badge&logo=tailscale)](#what-it-does-today)

**TheOrc Companion is the field node for TheOrc's HIVE MIND.**

It gives your phone a real job: discover local nodes, verify LAN and Tailscale routes, run first-run setup, and contribute small constrained edge work back to the swarm.

</div>

---

## What is it?

TheOrc Companion is the Android-facing control surface for [TheOrc](https://github.com/hardcoreerik/TheOrc).

Instead of being a fake mobile mockup or a second dashboard that just repeats desktop UI, the companion is aimed at real field-node work:

- discovering TheOrc and Ollama endpoints over **LAN** and **Tailscale**
- probing whether a host actually exposes the HIVE APIs you need
- persisting a local first-run setup profile
- acting as a constrained **companion edge node**
- queueing small jobs that make sense on a lightweight device or helper node

Right now the project is a React app with an Android wrapper, plus a local Express server that handles discovery, setup state, and the edge-job queue.

---

## Visual Language

The branding here is intentionally a sibling to TheOrc, not a clone:

- the same neon-green-on-black warband palette
- the same octagonal circuit frame language
- a **field node / uplink** posture instead of the full boss-orchestrator stance
- a companion emblem built around a mobile device carrying the orc signal

<div align="center">

![TheOrc Icon](assets/icon.png)

</div>

---

## What It Does Today

### Network gateway

The companion can:

- enumerate route candidates from `localhost`, private LAN IPs, and Tailscale IPs
- detect a configured TheOrc desktop host from `%APPDATA%\OrchestratorIDE\settings.json`
- probe `http://<host>:7078/hive/info`
- probe `http://<host>:11434/api/tags`
- summarize whether a route is **optimal**, **unstable**, or **offline**

This is the minimum needed for a real phone app to tell the truth about the HIVE instead of pretending a tunnel is healthy when it is not.

### First-run setup

The companion persists setup state to:

`%APPDATA%\TheOrcCompanion\settings.json`

That setup profile currently includes:

- companion name
- preferred host
- whether to join the HIVE MIND
- enabled edge capabilities
- battery cutoff percentage
- whether metered network use is allowed

### Constrained edge jobs

The companion does **not** invent a new boss role. It follows the role-architecture direction from TheOrc:

- `scrape_url`
  - logical role: `RESEARCHER`
  - execution lane: `RESEARCHER`
  - capability: `slow_scrape`
- `organize_directory`
  - logical role: `DATA_ENGINEER`
  - execution lane: `CODER`
  - capability: `file_sorting`

Current built-in job types:

- slow web scraping / summary extraction
- file sorting
- file naming suggestions

Those are intentionally narrow, useful, and cheap enough to fit a helper-node model.

### Local agent tools (chat)

The Chat tab can run a **local tool-calling loop** on Android without cloud API keys:

- `web_search` — DuckDuckGo HTML search (no API key)
- `fetch_page` — fetch and summarize a public URL
- `get_device_profile` — battery, time, device model, owner name
- `get_hive_status` — probe the selected HIVE route when the companion server is reachable
- `queue_scrape_url` — queue a background scrape job on the companion server

Settings:

- **Agent tools** — on by default; uses prompt-based JSON tool calls with the loaded local model
- **Web search + page fetch** — network gate for search/scrape tools

Limits:

- Tools run in the app layer so packaged Android builds work standalone
- DuckDuckGo HTML scraping can rate-limit; results are not JavaScript-rendered
- Qwen2.5 1.5B is more reliable for tool JSON than Qwen3 0.6B
- HIVE/job tools need the dev server or `VITE_API_BASE`; search/fetch work on-device

Dev-only debug endpoints (when `npm run dev` is running):

- `POST /api/agent/tools/web_search` `{ "query": "..." }`
- `POST /api/agent/tools/fetch_page` `{ "url": "https://..." }`

---

## HIVE Shape

<div align="center">

![TheOrc Companion Topology](assets/companion-topology.svg)

</div>

The intended relationship is:

1. TheOrc remains the planner and boss node.
2. The companion becomes a truthful network/control console.
3. Small edge-safe workloads can be routed to the companion node when capability and battery gates allow it.

This repo is the bridge between "phone UI for a demo" and "phone as a real member of the swarm."

---

## Quick Start

### Web development

```powershell
git clone https://github.com/hardcoreerik/TheOrcCompanion.git
cd TheOrcCompanion
npm install
npm run dev
```

Then open:

`http://127.0.0.1:3000`

### Requirements

- Node.js
- TheOrc desktop environment on the same LAN or Tailscale network if you want real route testing
- Ollama if you want the companion to verify model availability

### Optional AI key

If you want the Google AI Studio orchestration and research endpoints active, provide a Gemini key in local env configuration.

Without it, parts of the original AI Studio-generated app still fall back to simulation behavior.

---

## Android Build

This repo now includes a Capacitor Android wrapper.

### Sync the Android shell

```powershell
npm run android:sync
```

### Open in Android Studio

```powershell
npm run android:open
```

### Build manually with Gradle

```powershell
cd android
.\gradlew.bat assembleDebug
```

The debug APK lands at:

`android/app/build/outputs/apk/debug/app-debug.apk`

### Development server override

Android builds now use packaged web assets by default, so release builds are not pinned to a desktop or Tailscale URL.

For live development against the Vite/dev server, set `CAP_SERVER_URL` before syncing:

```powershell
$env:CAP_SERVER_URL="http://192.168.1.227:3000"
npm run android:sync
```

Clear that variable and sync again before release packaging.

### Release build

```powershell
npm run android:sync
cd android
.\gradlew.bat assembleRelease
```

Release signing still needs a real keystore before Play/internal distribution. Add signing material through Android Studio or local Gradle properties; do not commit keys, passwords, or generated `local.properties`.

---

## Repo Layout

| Path | Purpose |
|---|---|
| `src/App.tsx` | Main dashboard tabs, local chat agent, and top-level app layout |
| `src/lib/agent/` | Local tool-calling loop and tool registry |
| `src/lib/tools/` | DuckDuckGo search, page fetch, device/HIVE tool helpers |
| `src/components/AndroidCompanionHub.tsx` | Legacy companion setup UI (not mounted in current App) |
| `server.ts` | Discovery, probing, setup persistence, and companion-node job queue |
| `android/` | Capacitor Android wrapper project |
| `assets/` | README branding and companion visuals |

---

## Current Status

This project is no longer just the stock AI Studio export. It now has:

- real LAN/Tailscale route discovery
- real HIVE and Ollama probing
- persisted first-run setup
- Android packaging and deployment
- native LiteRT-LM download, load, stream, cancel, unload, and delete plumbing
- local chat agent tools with DuckDuckGo search and page fetch (no cloud search API)
- a public first-run default model: Qwen3 0.6B Mixed INT4 for LiteRT-LM
- a companion-node job queue aligned with TheOrc role architecture

What it does **not** claim yet:

- full distributed HIVE task execution from TheOrc
- autonomous mobile inference scheduling
- measured S23 performance/thermal tuning
- production signing
- broad local model catalog support

That honesty matters. The companion is now useful, but it is still in the "groundwork and field-node bring-up" phase.

---

## Next Steps

The strongest next upgrades are:

- signed work packets from TheOrc into the companion queue
- capability heartbeat reporting back to HIVE
- route auto-selection between LAN and Tailscale
- validate LiteRT-LM download/load/chat/cancel on the S23
- add production release signing
- add optional licensed Gemma models after the in-app model catalog can handle gated downloads cleanly
- optional native LiteRT `@Tool` providers once a tool-capable on-device model is added

---

## Related Project

The desktop boss, HIVE design, and broader swarm runtime live here:

[TheOrc](https://github.com/hardcoreerik/TheOrc)

If TheOrc is the warboss, this repo is the scout, relay, and field terminal.
