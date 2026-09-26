import {
  ACTIVE_FRAME_REFRESH_MS,
  FRAME_ENDPOINT,
  MEDIA_ENDPOINT,
} from './sourcePolicy.js';
function safeNumber(value, fallback = NaN) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
/**
 * Last URL built per camera object. The CCTV UI state maps EVERY camera
 * through frameUrlFor on each loading-progress notification (~every 300 ms
 * for the whole multi-minute geometry drain), so re-encoding thousands of
 * query strings per notification dominated the main thread. Reuse the string
 * while every input is unchanged; any pose/label change or new tick rebuilds.
 */
const frameUrlCache = new WeakMap();
function frameUrlFor(camera, refreshMs = ACTIVE_FRAME_REFRESH_MS) {
  const cadenceMs = Math.max(
    1000,
    safeNumber(refreshMs, ACTIVE_FRAME_REFRESH_MS),
  );
  const tick = Math.floor(Date.now() / cadenceMs);
  const cached = frameUrlCache.get(camera);
  if (
    cached &&
    cached.tick === tick &&
    cached.id === camera.id &&
    cached.name === camera.name &&
    cached.city === camera.city &&
    cached.lat === camera.lat &&
    cached.lon === camera.lon &&
    cached.headingDeg === camera.headingDeg &&
    cached.fovDeg === camera.fovDeg &&
    cached.pitchDeg === camera.pitchDeg
  )
    return cached.url;
  const params = new URLSearchParams({
    label: camera.name,
    city: camera.city,
    lat: camera.lat.toFixed(6),
    lon: camera.lon.toFixed(6),
    heading: String(Math.round(camera.headingDeg)),
    fov: String(Math.round(camera.fovDeg)),
    pitch: String(Math.round(camera.pitchDeg || -10)),
    ts: String(tick),
  });
  const url = `${FRAME_ENDPOINT}/${encodeURIComponent(camera.id)}?${params.toString()}`;
  if (camera && typeof camera === 'object')
    frameUrlCache.set(camera, {
      tick,
      id: camera.id,
      name: camera.name,
      city: camera.city,
      lat: camera.lat,
      lon: camera.lon,
      headingDeg: camera.headingDeg,
      fovDeg: camera.fovDeg,
      pitchDeg: camera.pitchDeg,
      url,
    });
  return url;
}
function mediaUrlFor(camera) {
  return `${MEDIA_ENDPOINT}/${encodeURIComponent(camera.id)}?ts=${Math.floor(Date.now() / 15000)}`;
}
/** Supply catalog/health records and the existing registered camera URL families. */
export function createCctvSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  async function read(path, key, { signal } = {}) {
    signal?.throwIfAborted();
    const response = await fetchImpl(path, { cache: 'no-store', signal });
    if (!response.ok) throw new Error('Camera source HTTP ' + response.status);
    const payload = await response.json();
    signal?.throwIfAborted();
    if (!Array.isArray(payload?.[key]))
      throw new Error('Malformed camera ' + key + ' snapshot');
    return payload;
  }
  return {
    getCatalog(options) {
      return read('/api/cctv/sources', 'sources', options);
    },
    getHealth(options) {
      return read('/api/cctv/health', 'cameras', options);
    },
    getFrameUrl: frameUrlFor,
    getMediaUrl: mediaUrlFor,
  };
}
