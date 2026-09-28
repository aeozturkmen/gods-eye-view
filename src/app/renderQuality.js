/**
 * Render quality presets: trade image quality for GPU/CPU headroom on
 * laptops that run hot. Opt-in — `high` is exactly the stock look.
 *
 * A preset only touches runtime-settable knobs, so switching never rebuilds
 * the viewer: MSAA sample count, render resolution, the photoreal tileset's
 * screen-space error (tile detail), and — on `low` — the frosted-glass
 * backdrop blur behind panels (`html[data-gev-quality="low"]`, see
 * ui/styles/render-quality.css). `preserveDrawingBuffer` is never changed:
 * voice/screen capture reads the canvas.
 *
 * Choice order: `?quality=` in the URL, then the remembered choice, then
 * `high`. The remembered choice lives in localStorage.
 */

export const RENDER_QUALITY_PRESETS = Object.freeze({
  high: Object.freeze({ msaa: 4, resolutionScale: 1, tileError: 16 }),
  balanced: Object.freeze({ msaa: 2, resolutionScale: 1, tileError: 24 }),
  low: Object.freeze({ msaa: 1, resolutionScale: 0.75, tileError: 40 }),
});
export const DEFAULT_RENDER_QUALITY = 'high';
export const RENDER_QUALITY_CHANGE_EVENT = 'gev:render-quality-change';
const STORAGE_KEY = 'gev:render-quality:v1';

const isPreset = (name) => Object.hasOwn(RENDER_QUALITY_PRESETS, name);

/** Pick the starting preset from the URL, then storage, then the default. */
export function resolveInitialRenderQuality({
  search = globalThis.location?.search ?? '',
  storage = safeStorage(),
} = {}) {
  const fromUrl = new URLSearchParams(search).get('quality')?.toLowerCase();
  if (isPreset(fromUrl)) return fromUrl;
  let stored = null;
  try {
    stored = storage?.getItem(STORAGE_KEY);
  } catch {
    // Blocked storage: fall through to the default.
  }
  return isPreset(stored) ? stored : DEFAULT_RENDER_QUALITY;
}

/**
 * Apply a preset to a live viewer. Unknown names fall back to the default.
 * @returns {string} the preset actually applied
 */
export function applyRenderQuality(
  viewer,
  name,
  { remember = true, storage = safeStorage() } = {},
) {
  const preset = isPreset(name) ? name : DEFAULT_RENDER_QUALITY;
  const settings = RENDER_QUALITY_PRESETS[preset];
  const scene = viewer?.scene;
  if (scene && 'msaaSamples' in scene && scene.msaaSamples !== settings.msaa)
    scene.msaaSamples = settings.msaa;
  if (viewer && viewer.resolutionScale !== settings.resolutionScale)
    viewer.resolutionScale = settings.resolutionScale;
  for (const tileset of photorealTilesets(scene))
    tileset.maximumScreenSpaceError = settings.tileError;

  const root = globalThis.document?.documentElement;
  if (root?.dataset) {
    if (preset === DEFAULT_RENDER_QUALITY) delete root.dataset.gevQuality;
    else root.dataset.gevQuality = preset;
  }
  if (remember) {
    try {
      storage?.setItem(STORAGE_KEY, preset);
    } catch {
      // Private mode: the preset still applies for this visit.
    }
  }
  scene?.requestRender?.();
  globalThis.dispatchEvent?.(
    new CustomEvent(RENDER_QUALITY_CHANGE_EVENT, { detail: { preset } }),
  );
  return preset;
}

/** 3D tilesets in the scene (duck-typed so tests need no Cesium). */
function photorealTilesets(scene) {
  const primitives = scene?.primitives;
  const out = [];
  for (let i = 0; i < (primitives?.length ?? 0); i++) {
    const p = primitives.get(i);
    if (
      p &&
      !p.isDestroyed?.() &&
      typeof p.maximumScreenSpaceError === 'number'
    )
      out.push(p);
  }
  return out;
}

function safeStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
