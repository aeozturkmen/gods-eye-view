import * as Cesium from 'cesium';
export { createGnssInterferenceSource } from './source.js';

/** gpsjam.org's thresholds on the share of degraded aircraft per cell. */
export const GNSS_LEVELS = Object.freeze([
  Object.freeze({ id: 'low', max: 0.02, css: '#3ddc84', alpha: 0.1 }),
  Object.freeze({ id: 'medium', max: 0.1, css: '#ffd43b', alpha: 0.32 }),
  Object.freeze({ id: 'high', max: Infinity, css: '#ff4d4f', alpha: 0.48 }),
]);
/** Cells float at cruise level: this is airspace evidence, not ground truth. */
const CELL_HEIGHT_M = 10_000;

export function gnssLevel(ratio) {
  return GNSS_LEVELS.find((level) => ratio < level.max) ?? GNSS_LEVELS.at(-1);
}

/** GPS interference estimate over the eastern Mediterranean, 24 h rolling. */
export function createGnssInterferenceLayer({ source } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('GNSS interference requires a snapshot source');
  let dataSource = null;
  let request = null;
  let enabled = false;
  let count = 0;
  let flagged = 0;
  let lastUpdate = null;
  let lastError = null;

  return {
    id: 'gnss-interference',
    name: 'GPS interference (24h)',
    icon: '⌖',
    source: 'adsb.lol · NACp',
    updateInterval: 120_000,

    init(viewer) {
      dataSource = new Cesium.CustomDataSource('gnss-interference');
      dataSource.show = false;
      viewer.dataSources.add(dataSource);
    },

    enable() {
      enabled = true;
      if (dataSource) dataSource.show = true;
    },

    disable() {
      enabled = false;
      request?.abort();
      request = null;
      if (dataSource) dataSource.show = false;
    },

    async update(viewer) {
      if (!enabled || !dataSource) return false;
      request?.abort();
      const current = new AbortController();
      request = current;
      try {
        const snapshot = await source.getSnapshot({ signal: current.signal });
        if (current.signal.aborted || request !== current || !enabled)
          return false;
        const entities = [];
        let bad = 0;
        for (const cell of snapshot.cells) {
          const level = gnssLevel(cell.ratio);
          if (level.id !== 'low') bad++;
          const color = Cesium.Color.fromCssColorString(level.css);
          entities.push(
            new Cesium.Entity({
              id: `gnss:${cell.south}:${cell.west}`,
              name: `GPS accuracy · ${Math.round(cell.ratio * 100)}% degraded`,
              description:
                `${cell.degraded} of ${cell.aircraft} aircraft reported NACp < 8 ` +
                `(position accuracy worse than ~93 m) in the last ${snapshot.windowHours} h. ` +
                'An interference indicator, not proof of jamming at this spot.',
              rectangle: {
                coordinates: Cesium.Rectangle.fromDegrees(
                  cell.west,
                  cell.south,
                  cell.east,
                  cell.north,
                ),
                height: CELL_HEIGHT_M,
                material: color.withAlpha(level.alpha),
                outline: level.id !== 'low',
                outlineColor: color.withAlpha(0.8),
              },
            }),
          );
        }
        dataSource.entities.suspendEvents();
        dataSource.entities.removeAll();
        for (const entity of entities) dataSource.entities.add(entity);
        dataSource.entities.resumeEvents();
        viewer?.scene?.requestRender?.();
        count = entities.length;
        flagged = bad;
        lastUpdate = Date.now();
        lastError = snapshot.error;
        return true;
      } catch (error) {
        if (current.signal.aborted || request !== current) return false;
        lastError = error?.message || 'GNSS interference unavailable';
        return false;
      } finally {
        if (request === current) request = null;
      }
    },

    destroy(viewer) {
      request?.abort();
      request = null;
      enabled = false;
      if (dataSource) viewer?.dataSources?.remove(dataSource, true);
      dataSource = null;
    },

    getStats() {
      return {
        count: flagged,
        countLabel: `${flagged} flagged / ${count} cells`,
        lastUpdate,
        error: lastError,
      };
    },
  };
}
