import { readResponseJsonCapped } from '../../sources/httpBody.js';

const MAX_BYTES = 2 * 1024 * 1024;

/** Validate one grid cell; anything malformed is dropped, never drawn. */
function cell(value) {
  if (!value || typeof value !== 'object') return null;
  const { south, west, north, east, aircraft, degraded, ratio } = value;
  if (
    ![south, west, north, east, aircraft, degraded, ratio].every(
      Number.isFinite,
    ) ||
    south < -90 ||
    north > 90 ||
    west < -180 ||
    east > 180 ||
    south >= north ||
    west >= east ||
    aircraft < 1 ||
    degraded < 0 ||
    degraded > aircraft ||
    ratio < 0 ||
    ratio > 1
  )
    return null;
  return { south, west, north, east, aircraft, degraded, ratio };
}

/** Same-origin GNSS interference grid from the local server. */
export function createGnssInterferenceSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl('/api/gnss-interference', { signal });
      if (!response.ok) throw new Error(`GNSS grid HTTP ${response.status}`);
      const body = await readResponseJsonCapped(response, MAX_BYTES, signal);
      if (body?.schemaVersion !== 1 || !Array.isArray(body.cells))
        throw new Error('Malformed GNSS interference grid');
      return {
        cells: body.cells.map(cell).filter(Boolean),
        observingSince: body.observingSince ?? null,
        lastPollAt: body.lastPollAt ?? null,
        error: body.error ?? null,
        windowHours: body.windowHours ?? 24,
      };
    },
  };
}
