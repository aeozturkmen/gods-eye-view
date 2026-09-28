/**
 * Padded lat/lon box of what the camera can see, for skipping per-tick work
 * on contacts that are far off screen.
 *
 * Built from Cesium's `camera.computeViewRectangle()` (radians). Handles a
 * view across the antimeridian (west > east) and polar views (padding that
 * would cover every longitude is clamped to the full range instead of being
 * wrapped into a half-width box). Anything uncertain fails OPEN: no
 * rectangle, or non-finite coordinates, count as visible.
 *
 * Pure (no Cesium import) so it can be unit-tested and reused by any layer.
 */

const RAD = 180 / Math.PI;
const ALL = Object.freeze({ all: true, contains: () => true });

/**
 * @param {{west:number,south:number,east:number,north:number}|undefined} rectRad
 * @param {{padDeg?: number, padFraction?: number}} [options]
 *   Padding: the larger of `padDeg` and `padFraction` of the span.
 */
export function createViewBounds(
  rectRad,
  { padDeg = 1.5, padFraction = 0.25 } = {},
) {
  if (!rectRad) return ALL;
  const west = rectRad.west * RAD;
  const east = rectRad.east * RAD;
  const south = rectRad.south * RAD;
  const north = rectRad.north * RAD;
  if (![west, east, south, north].every(Number.isFinite)) return ALL;

  const wraps = west > east;
  const lonSpan = wraps ? 360 - (west - east) : east - west;
  const latSpan = north - south;
  const lonPad = Math.max(padDeg, lonSpan * padFraction);
  const latPad = Math.max(padDeg, latSpan * padFraction);
  const s = Math.max(-90, south - latPad);
  const n = Math.min(90, north + latPad);

  if (lonSpan + 2 * lonPad >= 360) {
    // Every longitude is in range: only the latitude band matters.
    return {
      all: false,
      contains: (lat) => !Number.isFinite(lat) || (lat >= s && lat <= n),
    };
  }
  const w = normalizeLon(west - lonPad);
  const e = normalizeLon(east + lonPad);
  const split = w > e;
  return {
    all: false,
    contains(lat, lon) {
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return true;
      if (lat < s || lat > n) return false;
      const x = normalizeLon(lon);
      return split ? x >= w || x <= e : x >= w && x <= e;
    },
  };
}

function normalizeLon(lon) {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/**
 * Round-robin gate for off-screen records: record `index` gets its update on
 * one tick out of every `stride`, spread across the population.
 */
export function offscreenTurn(index, tick, stride) {
  return (index + tick) % stride === 0;
}
