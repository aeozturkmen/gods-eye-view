# Roadmap: use-cases and optimization plan

This roadmap draws on three sources:

- this fork's own profiling (see [FORK-NOTES.md](FORK-NOTES.md));
- a read-only survey of the upstream fork network, covering 196 candidate
  forks, 73 of which have diverged from upstream;
- upstream issues, PRs and docs.

Ideas are credited to the repositories that first implemented or proposed
them. Nothing here has been merged into this fork yet.

## Priorities in brief

| Priority | Theme | Why |
|---|---|---|
| **P0** | Stop idle GPU/CPU burn | The app renders continuously even while the camera is parked. Laptops heat up. |
| **P0** | Process only what the camera can see | About 10k flights, 12k ships and thousands of cameras are processed worldwide every frame. |
| **P1** | Keep big payloads off the main thread | A single `/api/ais-live` response is 6.4 MB of JSON. |
| **P1** | Turkey / East-Med data | This fork's focus. No other fork adds official Turkish feeds. |
| **P1** | LLM backends beyond OpenAI | OpenRouter or local models for the HUD summary and voice. |
| **P2** | Deployment, MCP, mobile | Nice to have. |

## P0: performance

### 1. Paced rendering and a hidden-tab pause

- **Idea:** replace the binary continuous/on-demand render switch with one
  shared pacer. Each live layer requests its own cadence (for example flights
  at 1–2 Hz while parked), so the parked scene stops redrawing identical
  frames. rib3ye measured 79–98% of parked frames as pixel-identical.
  kuxala also lowers the parked frame rate by altitude (1/2/5 Hz) and pauses
  pollers and HUD timers while the tab is hidden.
- **Sources:**
  [rib3ye/gods-eye-view](https://github.com/rib3ye/gods-eye-view)
  ("pace live-layer rendering to data cadence") and
  [kuxala/gods-eye-view](https://github.com/kuxala/gods-eye-view).
- **Fit:** it builds on `src/renderGovernor.js`, and the new sampleHeight
  budget already works on wall time rather than frames.
- **Effort:** M.

### 2. Viewport-scoped processing

- **Idea:** keep an R-tree over contact positions, rebuilt about 120 ms after
  the camera settles and antimeridian-aware. The fleet tick, detection and
  labels then only touch contacts inside the view (plus a margin).
- **Sources:**
  - [uhrichsam4/gods-eye-view](https://github.com/uhrichsam4/gods-eye-view)
    ("Draw only what the camera can see");
  - viewport-scoped CCTV delivery in upstream
    [PR #671](https://github.com/bilawalsidhu/gods-eye-view/pull/671) and
    [Frappguy/gods-eye-view](https://github.com/Frappguy/gods-eye-view).
- **Fit:**
  - It fixes the remaining heavy-session cost: `BillboardCollection.update`
    was about 16–36% of a busy scene.
  - It also fixes the CCTV focus pass, which rewrites every camera icon while
    a tracked target moves.
- **Effort:** L. Do it per layer: flights first, then vessels, then CCTV.

### 3. Batched markers built across frames

- **Idea:** draw point-like layers through one `PointPrimitiveCollection` per
  layer and fill it in chunks over several frames.
  uhrichsam4 measured before this change: a 7.7 s UI freeze on layer enable,
  and 45 s with all layers on.
- **Caveat:** batched points cannot clamp to the ground, so give them known
  heights. That matches this fork's move away from clamped pins.
- **Source:** [uhrichsam4/gods-eye-view](https://github.com/uhrichsam4/gods-eye-view)
  ("Draw markers in one batch, built across frames").
- **Effort:** M.

### 4. Render-quality presets

- **Idea:** `?quality=` presets or auto-detection (MSAA, `resolutionScale`,
  DPR cap, no `backdrop-filter`, no `preserveDrawingBuffer`). Upstream
  PR #680 reports 17.9 → 35.1 FPS on Intel UHD.
- **Sources:** upstream
  [PR #680](https://github.com/bilawalsidhu/gods-eye-view/pull/680),
  [PR #72](https://github.com/bilawalsidhu/gods-eye-view/pull/72) and issue #8;
  kuxala's device tiers.
- **Effort:** S–M.

## P1: performance

### 5. Parse and fetch in a Web Worker

- **Idea:** move `/api/ais-live` (6.4 MB), flights, FIRMS and similar payloads
  to a worker using plain `postMessage`.
- **Source:** [uhrichsam4/gods-eye-view](https://github.com/uhrichsam4/gods-eye-view)
  ("Parse layer data on another core").
- **Effort:** M.

### 6. Smaller jobs

- **Payload trimming:** round coordinates to 4 decimals and raise the FIRMS
  confidence floor (uhrichsam4: wildfire payload −66%).
- **Timers:** cancel a layer's refresh the moment it turns off, and load the
  geoid grid at idle
  ([c0d3x/gods-eye-view](https://github.com/c0d3x/gods-eye-view)).
- **Voice stack:** lazy-chunk it (c0d3x).
- **Google 3D:** load tiles only when the photoreal stack is chosen (kuxala).
- **Traffic:** prioritize visible roads and cap dots adaptively by frame time
  (upstream `docs/KNOWN-ISSUES.md`,
  [PR #655](https://github.com/bilawalsidhu/gods-eye-view/pull/655)).

## P1: Turkey and East-Med use-cases

- **More official Turkish camera catalogs.** Şanlıurfa, İstanbul and Ankara
  come first. Rules: no login, no signed tokens, a catalog endpoint rather than
  HTML scraping, and a recorded licence.
  - Known dead ends: Ankara's public page lists only shelter cameras, and the
    EGO/ABB traffic cameras are app-only.
  - The licensed way to add Turkey, Greece and Cyprus tourism webcams is the
    official Windy Webcams API with a key (upstream
    [PR #349](https://github.com/bilawalsidhu/gods-eye-view/pull/349)).
- **GPS interference layer.** A hex grid built from the adsb.lol NACp values,
  highly relevant over the East Mediterranean and Turkey (kuxala).
- **Strait transit counter.** Adapt kuxala's Hormuz AIS transit counter to the
  Bosphorus and the Dardanelles.
- **EUMETSAT imagery.** EUMETView geostationary imagery covers Europe and the
  Middle East, which GOES does not
  ([jmtibbetts/gods-eye-view](https://github.com/jmtibbetts/gods-eye-view)).
- **Declarative CCTV catalog format.** One JSON entry per source with field
  mapping and pagination (Frappguy, 35 sources). Moving this fork's seven packs
  onto it would make new regions data-only.
- **Keyless FIRMS fallback.** NASA's public 24 h CSV (uhrichsam4).

## P1: LLM and voice backends

- **OpenAI-compatible HUD summary host.** Point it at OpenRouter, Groq or
  Ollama (upstream
  [PR #453](https://github.com/bilawalsidhu/gods-eye-view/pull/453); presets in
  PR #652). Effort S.
- **Typed prompt bar.** Uses a free OpenRouter model, so no OpenAI key is
  needed ([RudraDudhat2509/gods-eye-view](https://github.com/RudraDudhat2509/gods-eye-view)).
  Effort S.
- **Fully local voice.** Ollama with faster-whisper and Piper (upstream
  [PR #647](https://github.com/bilawalsidhu/gods-eye-view/pull/647)). This is
  the STT → LLM → TTS pipeline for anyone without an OpenAI Realtime key.
  Effort M–L.

## P2

- **Agent control:** a localhost-only MCP server for driving the globe from
  agents, with bearer auth and bind checks
  ([MJVasya/gods-eye-view](https://github.com/MJVasya/gods-eye-view)).
- **Production server:** one that keeps the dev-only API proxies, plus Docker
  (Frappguy). Add auth in front of it: an OIDC or reverse-proxy gate and a
  frame-ancestors allowlist.
- **Mobile:** a bottom-sheet shell
  ([Tuxprogrammer/gods-eye-view](https://github.com/Tuxprogrammer/gods-eye-view))
  or a PWA.
- **Upstream sync:** a daily workflow that pulls upstream into this fork.
