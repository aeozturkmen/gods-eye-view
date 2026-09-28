import { HEALTH_SYNC_INTERVAL_MS, HEALTH_ENDPOINT } from './policy.js';

export function createHealth({ state: layerState, services, parts, source }) {
  /**
   * Fetches per-camera health status from the backend and updates _healthById.
   * Rate-limited to HEALTH_SYNC_INTERVAL_MS unless forced.
   * @param {boolean} [force=false] - Bypass the interval check.
   */

  async function syncHealthState(force = false) {
    const now = Date.now();
    if (!force && now - layerState._lastHealthSyncAt < HEALTH_SYNC_INTERVAL_MS)
      return;
    layerState._lastHealthSyncAt = now;

    try {
      const signal = layerState._sourceAbort?.signal;
      const data = await source.getHealth({ signal });
      signal?.throwIfAborted();
      const rows = Array.isArray(data?.cameras) ? data.cameras : [];
      const next = new Map();
      for (const row of rows) {
        const id = String(row?.id || '').trim();
        if (!id) continue;
        next.set(id, {
          status: String(row.status || '').toLowerCase() || 'unknown',
          sourceKind: String(
            row.sourceKind || row.feedType || '',
          ).toLowerCase(),
          label: String(row.label || row.provider || ''),
          message: String(row.message || ''),
          offline: row.providerOffline === true,
          updatedAt: parts.model.safeNumber(row.updatedAt, now),
        });
      }
      layerState._healthById = next;
      skipOfflineDefaultCamera();
    } catch {
      // keep previous health map
    }
  }
  /**
   * The enable-time default camera is simply the first catalog record. When the
   * proxy reports it as offline (the provider sent a "camera offline" card),
   * hand over to the next camera not known to be offline. Only an automatic
   * pick moves; a camera the user or voice chose stays put.
   */
  function skipOfflineDefaultCamera() {
    if (!layerState._activeCameraAuto) return;
    const activeId = layerState._activeCameraId;
    if (!activeId || !layerState._healthById.get(activeId)?.offline) return;
    const next = layerState._records.find(
      (record) =>
        record.camera.id !== activeId &&
        !layerState._healthById.get(record.camera.id)?.offline,
    );
    if (!next) return;
    parts.selection.setActiveCamera(next.camera.id);
    layerState._activeCameraAuto = true;
  }

  return { syncHealthState };
}
