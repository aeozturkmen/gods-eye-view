/**
 * Shared time budget for Cesium's synchronous `scene.sampleHeight`.
 *
 * Each call renders a pick pass and does a blocking GPU readback
 * (Context.readPixels). On the Google Photorealistic 3D stack the globe is
 * hidden, so samples at spots whose tiles have not streamed in return
 * undefined, and layers that retried every such point every frame (ALPR
 * anchors, local GeoJSON stems, bikeshare stations) spent seconds per frame
 * there: the canvas never finished a frame and read as a black screen.
 *
 * The budget is a token bucket in milliseconds of readback, refilled at a fixed
 * share of wall-clock time. It is deliberately NOT keyed to frameNumber:
 * Cesium's pick path advances frameNumber on every sample, so a per-frame
 * budget would reset after each call. A deferred call answers undefined,
 * exactly like a sample over tiles that are still streaming, so callers keep
 * their existing "retry later" behaviour.
 */

/** Largest burst of readback, in ms, allowed after an idle stretch. */
export const SAMPLE_HEIGHT_BURST_MS = 6;
/** Long-run share of wall time that readbacks may use (0.12 = 12%). */
export const SAMPLE_HEIGHT_DUTY = 0.12;

/** scene -> { tokensMs, at } */
const buckets = new WeakMap();

function bucketFor(scene, now) {
  let bucket = buckets.get(scene);
  const t = now();
  if (!bucket) {
    bucket = { tokensMs: SAMPLE_HEIGHT_BURST_MS, at: t };
    buckets.set(scene, bucket);
  } else {
    bucket.tokensMs = Math.min(
      SAMPLE_HEIGHT_BURST_MS,
      bucket.tokensMs + (t - bucket.at) * SAMPLE_HEIGHT_DUTY,
    );
    bucket.at = t;
  }
  return bucket;
}

/**
 * Whether a sample may run now.
 * @param {object} scene
 * @param {{now?: () => number}} [options] Injectable clock (tests).
 */
export function sampleHeightBudgetAvailable(
  scene,
  { now = () => performance.now() } = {},
) {
  if (!scene) return false;
  return bucketFor(scene, now).tokensMs > 0;
}

/**
 * `scene.sampleHeight(cartographic, objectsToExclude)` within the shared budget.
 *
 * @param {object} scene Cesium scene.
 * @param {object} cartographic Position to sample.
 * @param {object[]} [objectsToExclude]
 * @param {{now?: () => number}} [options] Injectable clock (tests).
 * @returns {number|undefined} Height, or undefined when unavailable or deferred.
 */
export function budgetedSampleHeight(
  scene,
  cartographic,
  objectsToExclude,
  { now = () => performance.now() } = {},
) {
  // Callers decide on capability; unsupported scenes throw, which is a miss.
  if (typeof scene?.sampleHeight !== 'function') return undefined;
  const bucket = bucketFor(scene, now);
  if (bucket.tokensMs <= 0) return undefined;
  const started = now();
  try {
    return scene.sampleHeight(cartographic, objectsToExclude);
  } catch {
    return undefined; // tiles streaming
  } finally {
    const finished = now();
    bucket.tokensMs -= Math.max(0, finished - started);
    bucket.at = finished;
  }
}
