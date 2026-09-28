# Fork notes: Europe/Turkey CCTV, map controls and Google 3D performance

This fork of [bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view)
branches from upstream `b210ab0` and adds six things:

1. a hardened local launcher (`gev.sh`),
2. a Google Earth-style zoom control and a "quiet map" declutter toggle,
3. seven CCTV packs for Europe and Turkey,
4. a fix for the CCTV loading phase, whose cost grew quadratically with camera count,
5. a fix for the black screen and single-digit FPS on the Google Photorealistic 3D map,
6. offline provider cameras no longer masquerading as healthy frames.

Every change is covered by unit tests: `npm test` runs 5,091 tests and passes.
`npm run check:boundaries` also passes.

## Contents

- [Run it](#run-it)
- [1. Local security hardening (`gev.sh`)](#1-local-security-hardening-gevsh)
- [2. Map controls](#2-map-controls)
- [3. CCTV packs: Europe and Turkey](#3-cctv-packs-europe-and-turkey)
- [4. CCTV loading cost (O(N²) → O(N))](#4-cctv-loading-cost-on²--on)
- [5. Black screen on Google 3D: synchronous GPU readbacks](#5-black-screen-on-google-3d-synchronous-gpu-readbacks)
- [6. Offline cameras reported as "SNAPSHOT · OK"](#6-offline-cameras-reported-as-snapshot--ok)
- [How it was measured](#how-it-was-measured)
- [Trade-offs and known limits](#trade-offs-and-known-limits)
- [Commits](#commits)

## Run it

```bash
nvm use 24            # Node 24.x (the app refuses Node 20)
npm ci
./gev.sh              # localhost only, keys from the macOS Keychain
```

`./gev.sh key OPENAI_API_KEY` stores a key in the Keychain; macOS prompts for
it, so the value never appears on the command line or in shell history.
`./gev.sh keys` lists which keys are in the Keychain and which are still
plaintext in `.env`. `npm run dev` still works exactly as upstream.

## 1. Local security hardening (`gev.sh`)

Upstream already binds to localhost by default and keeps secret keys on the
server. The launcher adds guard rails around the remaining foot-guns:

| Risk | What `gev.sh` does |
|---|---|
| `HOST=0.0.0.0` exposes the key-brokering dev server to the LAN, so anyone on the network could spend the paid API quotas | Refuses any non-loopback `HOST` |
| Keys stored in plaintext `.env` / `pinokio/ENVIRONMENT` | Sets the files to `chmod 600` and warns about each plaintext key; the `key` subcommand moves keys to the Keychain |
| Paid proxies (OpenAI, Google) can be called without limit | Sets `GEV_RATELIMIT_OPENAI_PER_MIN=30` and `GEV_RATELIMIT_GOOGLE_PER_MIN=60` (per-minute throttles, not billing caps) |
| AISStream subscribes to the **whole world** and never disconnects, so the server parsed every ship message on Earth once any tab asked for ships (23–29% of a CPU core, constantly) | `AISSTREAM_BOUNDING_BOXES` defaults to Turkey + Europe + Mediterranean + Black Sea (server CPU ≈ 8%). Override to widen |
| Two Turkish camera hosts omit their intermediate TLS certificate (browsers fetch it themselves, Node does not) | `NODE_EXTRA_CA_CERTS=config/tls/cctv-intermediates.pem`, which holds the two public intermediates. Both chain to Mozilla-trusted roots; fingerprints are in the file header |

Two things still need doing outside the code: restrict the browser-exposed
Google Maps / Cesium ion keys by HTTP referrer, and set budget alerts with the
key providers.

## 2. Map controls

### Zoom control (bottom left)

Files: `src/ui/mapZoomControls.js`, `src/ui/styles/map-zoom.css`, and markup in
`src/ui/templates/scene-chrome.html`.

- The control has a magnifier icon, a **−** button, a logarithmic altitude
  slider (30 m to 30,000 km **above ground**) and a **+** button. The `+`/`-`
  keys also zoom. Cmd, Ctrl and Alt combinations are left to the browser, so
  page zoom still works.
- A zoom changes only the orbit *range* around the point at the screen centre,
  or around the tracked target. It uses the same frame helpers as the tilt and
  north-up buttons, so tracking survives a zoom. The range is clamped to 150 m
  while tracking, the same limit the follow camera uses.
- The control is hidden in cockpit, scene playback, recording and clean-view
  modes. It sits above the Cesium credit line without moving it, and it is
  registered as an obstacle for the left panel rail.

### Quiet map (declutter) toggle

The toggle is the ⋮⋮ button in the same pill, or the `X` key. Files:
`src/declutter.js`, `src/cyberSonarGpu.js`, `src/overlays/worldOverlay.js` and
`src/data/detection.js`.

While it is on, every native contact is drawn at **55% size and 40% opacity**.
That covers billboards, points and label glyphs from every layer. Ambient
overlay cards shrink at layout time, and detection brackets and callouts dim.
**Nothing is hidden**, and switching it off restores the exact previous look.

- The contact change is made in the existing derived-shader pass as a new
  uniform, so no layer state is written. The per-tick writers in the flights,
  focus and traffic layers therefore cannot undo it.
- Picking still uses the native full-size commands, so hit areas are
  unchanged.
- Selected and tracked targets stay at full size.
- The setting is remembered in `localStorage`.

## 3. CCTV packs: Europe and Turkey

Files: `server/providers/cctv/sourcesEurope.js`, `sourcesTurkey.js`,
`regionalCommon.js` and `regionalConstants.js`.

| Pack | Catalog | Frames | Licence | Default cap |
|---|---|---|---|---|
| DGT Spain (national roads) | DATEX II v3.7, NAP | `etraffic.dgt.es/camarasEtraffic/<id>.jpg` | CC BY | 120 of 1,952 |
| Madrid city + Calle 30 | city KML + M-30 XML | `informo.madrid.es`, `mc30.es` | CC BY 4.0 | 120 of 393 |
| Statens vegvesen (Norway) | public WFS GeoJSON | `kamera.atlas.vegvesen.no` | NLOD 2.0 | 100 of 850 |
| Vegagerðin (Iceland) | JSON | `vegagerdin.is/vgdata/vefmyndavelar` | Free licence, attribution | 60 of 497 |
| CITA (Luxembourg) | KML | `cita.lu/.../cccam_<n>.jpg` | CC0 | 40 of 96 |
| İBB İstanbul | UYM `IntensityMap/v1/Camera` | HTTPS HLS on `hls.ibb.gov.tr` | No reuse licence stated; personal local viewing only | 300 of 648 |
| İZUM İzmir | İZUM JSON | first JPEG of each MJPEG stream | Camera list CC BY 4.0 (İzmir open data) | all 91 |

All seven packs follow the same safety rules as the upstream packs:

- **Keyless catalogs:** every catalog is fetched without a key, with redirects
  refused and bounded time and bytes.
- **Coordinate checks:** each pack keeps only cameras inside a national or city
  bounding box.
- **Frame URLs:** every frame URL is **synthesized from a validated id** onto
  one fixed origin, so no upstream field can steer the frame proxy off-host.

İZUM stills come through a new MJPEG path in `media.js`. It is allowlisted to
one host, reads the first complete JPEG (capped at 1 MB) and then disconnects.
Each pack has a kill switch (`CCTV_<PACK>_ENABLED=0`), a cap
(`CCTV_<PACK>_MAX_SOURCES`), an attribution credit and a `DATA_SOURCES.md`
entry.

Camera health: roughly 40% of İBB streams and 25–35% of İZUM streams are
offline at any given moment. The operators take them down, not this code.

The Europe caps are deliberately small. CCTV cost scales with the total camera
count, so each country adds a sample; raise the cap per pack if you want more.

## 4. CCTV loading cost (O(N²) → O(N))

**Symptom:** after CCTV was switched on, the UI stuttered for the whole
multi-minute geometry drain. The drain took about 3 minutes for 4,500 cameras.

**Cause:** every geometry-progress notification, about every 300 ms, rebuilt
the public state of *every* camera. That included a fresh frame URL built with
`URLSearchParams`. The panel then walked thousands of DOM `<option>`s to check
whether its camera list had changed. Total work was therefore
O(cameras × notifications): about 16% of the main thread during loading.

**Fix:**

- **Frame URLs** are memoized per camera and refresh tick
  (`src/layers/cctv/source.js`). They are rebuilt on any pose or label change,
  so the output is identical.
- **The option list** is compared against a plain id array instead of the DOM
  (`src/ui/cctvPresentation.js`).

In the same scenario the main thread went from 99% busy to 84%, and the
frame-URL work disappeared from the profile.

## 5. Black screen on Google 3D: synchronous GPU readbacks

**Symptom:** with a restored 20-layer session on the Google Photorealistic 3D
map, the globe stayed black and FPS was in single digits. This happens with the
upstream code too, as soon as a Google Maps key selects the photoreal stack.

**How it was found:** Chrome CPU profiles of the exact restored session, taken
at DPR 2 on an Apple M3. In a 50 s capture:

- **33 s** in `Context.readPixels`
- **17 s** in `Buffer.getBufferData`

Both are synchronous GPU reads. Every item below is one confirmed cause,
together with its fix:

| Cause | Fix |
|---|---|
| ALPR `paint()` runs every frame. For every camera without a height it called `scene.sampleHeight`, which does a pick render plus a GPU readback. Over Google 3D, tiles that have not streamed in yet return nothing, so the call was retried every frame | Per-camera exponential backoff (0.5 s up to 30 s), and the shared budget below |
| ALPR `nativeVisible()` re-assigned `billboard/polyline/polygon.show` for every camera on every frame. In Cesium each assignment raises `definitionChanged`, and a ground-clamped polygon answers that by re-clamping through `Scene.getHeight` → `Cesium3DTileset.getHeight` → `Model.pick`, a CPU pick that reads tile vertices back from the GPU | Write only on a real change |
| Five callers used `scene.sampleHeight` without any limit: ALPR, local GeoJSON stems, bikeshare, `groundSnap` and the mesh floor sampler | New `src/services/sampleHeightBudget.js`: a token bucket that allows readbacks for at most **12% of wall time** (6 ms bursts). It is time-based because Cesium's pick path advances `frameNumber` on every sample, so a per-frame budget resets after each call. A deferred call returns `undefined`, the same as "tiles still streaming", so every caller keeps its existing retry logic |
| The datacenter and dam GeoJSON kept the `CLAMP_TO_GROUND` pins that `GeoJsonDataSource` creates, next to the stems that replace them | Remove the redundant pin |
| About 1,900 worldwide submarine cable landing pins were clamped to 3D tiles. Google 3D's coarse tiles cover continents, so each tile load re-clamped all of them (35,000 height callbacks in 45 s) | Clamp to terrain only. The points are coastal, so terrain, or sea level while the globe is hidden, is enough |
| Proximity aircraft models churn: about 280 were created in 45 s over a busy city. Each one built a dynamic environment map with a spherical-harmonics readback | Static lighting on aircraft models (`environmentMapOptions.enabled = false`) |

**Result on the same restored session:**

| | Before | After |
|---|---:|---:|
| FPS (last 10 s) | 2.8 | **24.6** |
| Main thread blocked | 99% | **24%** |
| `readPixels` per 50 s | 33.4 s | 4.8 s |
| Height callbacks fired per 45 s | 35,354 | ~1,000 |
| Environment-map regenerations | 125 | 1 |

## 6. Offline cameras reported as "SNAPSHOT · OK"

**Symptom:** the default CCTV camera, Austin "5th St / Congress Ave", showed
the City of Austin "Image Unavailable" card while the panel said
`SNAPSHOT · OK`.

**Cause:** some operators answer an offline camera with a valid JPEG card. The
Austin card is 12,805 bytes and is served for several cameras. The frame proxy
only checked `image/*`. The default camera is also simply the first catalog
record, and that record was offline.

**Fix** (`server/providers/cctv/placeholders.js`, `src/layers/cctv/health.js`):

- **Placeholder detection:**
  - Known placeholder bytes (sha256) are recognized on the first frame.
  - Byte-identical frames from three or more *different* cameras on one host
    are learned as a placeholder. A parked camera repeating its own frame does
    not count.
- **Offline handling:** a detected card goes through the normal fallback chain
  (Street View, then synthetic "CAMERA OFFLINE"). The health entry records
  `providerOffline`, and the panel shows the real status.
- **Default camera:** an *automatically chosen* default camera that turns out to
  be offline hands over to the next camera not known to be offline. A camera
  the user or voice chose is never swapped.

## How it was measured

- **Browser and setup:** headless Chrome 152 with Metal ANGLE on an Apple M3,
  at 1440×932 or 1710×951 and DPR 2. Measurements used a `PerformanceObserver`
  for long tasks, `requestAnimationFrame` counts for FPS, and the CDP
  `Profiler` for CPU profiles, attributed to the nearest `src/` frame.
- **A/B runs:** the same scenario ran against upstream `b210ab0` in a separate
  worktree.
- **Height callbacks:** attributed by wrapping `Scene.prototype.updateHeight`
  and `Billboard._updateClamping` in the page.
- **Noise:** absolute FPS varies between runs, especially while other GPU work
  such as a second open tab competes. The profile attributions are the reliable
  signal.

## Trade-offs and known limits

- **Aircraft 3D models** no longer get dynamic sky reflections; they use static
  lighting. At map scale the difference is hard to see.
- **Budgeted height samples** mean some ground anchors (ALPR, GeoJSON stems,
  bikeshare) settle over a few frames instead of all at once.
- **Heavy sessions stay heavy.** With every layer on, the app still processes
  about 10k flights, 12k ships and thousands of cameras worldwide on every
  frame, including those far off-screen. Viewport-scoped processing would be
  the next structural step; see the optimization plan.
- **Caltrans and Ontario 511:** upstream CCTV feeds from these two can fail
  outside North America (connection timeouts and HTTP 400). This is unrelated
  to the fork.
- **İBB streams** carry no stated reuse licence. Keep them to personal local
  viewing, or ask İBB first.

## Commits

1. `feat(ui)`: bottom-left Google Earth-style map zoom control
2. `feat(ui)`: quiet map toggle shrinks and dims markers without hiding them
3. `feat(cctv)`: add Europe and Turkey camera packs
4. `perf(cctv)`: stop O(N²) main-thread work while cameras load
5. `perf`: stop synchronous GPU readbacks that froze the Google 3D stack
6. `chore`: hardened local launcher and these notes
