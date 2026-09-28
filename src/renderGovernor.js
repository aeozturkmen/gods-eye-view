/**
 * Idle render governor — the wave-2 flagship of the 2026-08-05 perf
 * investigation.
 *
 * The problem: Cesium's default render loop repaints every vsync forever, so
 * the app burned ~60% GPU + ~54% of a core with ZERO layers enabled and a
 * parked camera. The fix: flip the scene into Cesium's `requestRenderMode`
 * whenever nothing animates per frame, and return to the continuous loop the
 * moment something does.
 *
 * Architecture — a binary mode driven by ref-counted holds:
 *
 * - **Continuous mode** (`requestRenderMode = false`, today's behavior)
 *   while ANY hold is registered. Every per-frame animator — fleet
 *   interpolation, traffic sim, satellite motion, tracked-entity follow,
 *   style crossfades, CCTV projection — registers a hold for exactly the
 *   lifetime of its scene-loop listener or animation. While one is active,
 *   behavior is byte-identical to pre-governor main: the locked
 *   interpolation/tracking invariants are preserved by construction.
 * - **Idle mode** (`requestRenderMode = true`) when zero holds. Cesium
 *   auto-renders on camera input and tile loads; every other scene mutation
 *   must call `governorRequestRender()` for its one frame. Discrete
 *   mutators (layer poll ticks, slider writes, annotation changes) route
 *   through that.
 *
 * Holds are identity-keyed (a Set of owner ids), NOT a counter — a module
 * that double-holds or double-releases cannot corrupt the mode. Owners are
 * short stable strings ('flights', 'traffic', 'style-anim', …) so the
 * diagnostics read like a story.
 *
 * The governor is O(1) passive: no per-frame work of its own, ever.
 *
 * **Paced mode** (fork addition): a data layer whose per-frame work only
 * needs to show new state at its own cadence (fleet dead reckoning ~12 Hz,
 * AIS ~1 Hz) registers a *paced* hold instead of a continuous one. The scene
 * then stays in `requestRenderMode` and ONE shared timer requests a frame at
 * the fastest registered interval, skipping ticks while the tab is hidden.
 * Camera input still renders every frame natively, so motion stays smooth;
 * only a parked camera stops redrawing identical frames at 60 Hz. Any
 * continuous hold still wins (cockpit, orbit, tracked entity, ...).
 */

let _viewer = null;
let _installed = false;
const _holds = new Set();
/** Paced owners -> requested interval (ms). */
const _paced = new Map();
let _pacerTimer = null;
let _pacerMs = 0;
const _defaultScheduler = {
  schedule: (fn, ms) => setTimeout(fn, ms),
  cancel: (timer) => clearTimeout(timer),
};
let _scheduler = _defaultScheduler;
let _isHidden = () => globalThis.document?.hidden === true;

/** Debug trail of the most recent one-shot render requests (idle mode only). */
const _recentRequests = [];
const RECENT_REQUEST_CAP = 16;

function stopPacer() {
  if (_pacerTimer !== null) _scheduler.cancel(_pacerTimer);
  _pacerTimer = null;
  _pacerMs = 0;
}

function pacerInterval() {
  let ms = Infinity;
  for (const value of _paced.values()) if (value < ms) ms = value;
  return ms;
}

function armPacer() {
  const ms = pacerInterval();
  if (!Number.isFinite(ms)) {
    stopPacer();
    return;
  }
  if (_pacerTimer !== null && _pacerMs === ms) return;
  stopPacer();
  _pacerMs = ms;
  const tick = () => {
    _pacerTimer = null;
    if (!_installed || !_viewer?.scene || _holds.size > 0 || !_paced.size)
      return;
    if (!_isHidden()) _viewer.scene.requestRender?.();
    _pacerMs = 0;
    armPacer();
  };
  _pacerTimer = _scheduler.schedule(tick, ms);
}

function applyMode() {
  if (!_installed || !_viewer?.scene) return;
  const continuous = _holds.size > 0;
  if (continuous || !_paced.size) stopPacer();
  else armPacer();
  const scene = _viewer.scene;
  if (scene.requestRenderMode === !continuous) return;
  scene.requestRenderMode = !continuous;
  if (!continuous) {
    // Entering idle: render one settling frame so anything the last
    // continuous frame mutated is on screen before the loop stops.
    scene.requestRender?.();
  }
}

/**
 * Install the governor on the viewer. Idempotent. Before install,
 * hold/release still record into the holds set (and apply at install time);
 * requests are safe no-ops — so modules can call all three unconditionally
 * in tests without a viewer.
 * @param {Cesium.Viewer} viewer
 * @returns {void}
 */
export function installRenderGovernor(viewer) {
  if (!viewer?.scene)
    throw new TypeError('installRenderGovernor requires a Cesium viewer');
  _viewer = viewer;
  _installed = true;
  // Never let Cesium re-render on simulation-time deltas behind our back —
  // idle means idle. All re-renders are camera/tiles (Cesium-native) or
  // explicit requests.
  viewer.scene.maximumRenderTimeChange = Infinity;
  applyMode();
}

/**
 * Register a continuous-render hold. Idempotent per owner.
 * Call where the owner's per-frame work BEGINS (scene listener installed,
 * animation starts, tracking begins).
 * @param {string} ownerId Short stable id, e.g. 'flights', 'traffic'.
 * @returns {void}
 */
export function holdContinuousRender(ownerId) {
  if (!ownerId) return;
  _holds.add(ownerId);
  applyMode();
}

/**
 * Release a hold. Safe when never held.
 * Call where the owner's per-frame work ENDS (listener removed, animation
 * settled, tracking stopped, layer disabled).
 * @param {string} ownerId
 * @returns {void}
 */
export function releaseContinuousRender(ownerId) {
  if (!ownerId) return;
  _holds.delete(ownerId);
  applyMode();
}

/**
 * Register a paced hold: the owner's per-frame work only needs a frame every
 * `intervalMs` while the camera is parked. Re-calling re-paces the owner.
 * @param {string} ownerId
 * @param {number} intervalMs Desired frame interval (clamped to >= 16 ms).
 * @returns {void}
 */
export function holdPacedRender(ownerId, intervalMs) {
  if (!ownerId) return;
  const ms = Number(intervalMs);
  _paced.set(ownerId, Number.isFinite(ms) ? Math.max(16, ms) : 100);
  applyMode();
}

/**
 * Release a paced hold. Safe when never held.
 * @param {string} ownerId
 * @returns {void}
 */
export function releasePacedRender(ownerId) {
  if (!ownerId) return;
  _paced.delete(ownerId);
  applyMode();
}

/**
 * One-shot render request for a discrete scene mutation (layer tick, slider
 * write, annotation change). Always forwards to scene.requestRender() — in
 * continuous mode that is a harmless flag set (and forwarding closes the
 * request-then-last-release race); only idle-mode requests are recorded in
 * diagnostics. Cheap enough to call unconditionally after any mutation.
 * @param {string} [reason] For diagnostics only.
 * @returns {void}
 */
export function governorRequestRender(reason = 'unspecified') {
  if (!_installed || !_viewer?.scene) return;
  if (_holds.size === 0) {
    _recentRequests.push({ reason, at: Date.now() });
    if (_recentRequests.length > RECENT_REQUEST_CAP) _recentRequests.shift();
  }
  _viewer.scene.requestRender?.();
}

/**
 * @returns {{installed: boolean, mode: 'continuous'|'idle', holds: string[],
 *   recentRequests: Array<{reason: string, at: number}>}}
 */
export function getRenderGovernorDiagnostics() {
  return {
    installed: _installed,
    mode: _holds.size > 0 ? 'continuous' : _paced.size > 0 ? 'paced' : 'idle',
    holds: [..._holds].sort(),
    paced: Object.fromEntries([..._paced].sort(([a], [b]) => (a < b ? -1 : 1))),
    recentRequests: [..._recentRequests],
  };
}

/** Release the installed viewer after its animation owners have stopped. */
export function uninstallRenderGovernor(viewer) {
  if (_viewer !== viewer) return;
  stopPacer();
  _viewer = null;
  _installed = false;
  _holds.clear();
  _paced.clear();
  _recentRequests.length = 0;
}

/** Test seam: reset module state between unit tests. */
export function _resetRenderGovernorForTest() {
  stopPacer();
  _viewer = null;
  _installed = false;
  _holds.clear();
  _paced.clear();
  _recentRequests.length = 0;
  _scheduler = _defaultScheduler;
  _isHidden = () => globalThis.document?.hidden === true;
}

/** Test seam: inject the pacer's timer and hidden-tab probe. */
export function _setPacerSchedulerForTest(scheduler, isHidden) {
  _scheduler = scheduler || _defaultScheduler;
  if (typeof isHidden === 'function') _isHidden = isHidden;
}
