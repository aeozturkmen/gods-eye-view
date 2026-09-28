import * as Cesium from 'cesium';
import officialStats from './officialStats.json' with { type: 'json' };
import { STRAIT_ANCHORS, straitCardText, summarizeStrait } from './model.js';
export * from './model.js';

/** A card over each Turkish strait with the ministry's transit statistics. */
export function createStraitTransitsLayer({ stats = officialStats } = {}) {
  let dataSource = null;
  let count = 0;

  function build() {
    const entities = [];
    for (const [key, anchor] of Object.entries(STRAIT_ANCHORS)) {
      const strait = stats?.straits?.[key];
      const summary = summarizeStrait(strait?.months);
      if (summary) count += summary.latest;
      entities.push(
        new Cesium.Entity({
          id: `strait-transits:${key}`,
          name: `${strait?.name ?? anchor.label} transits`,
          position: Cesium.Cartesian3.fromDegrees(anchor.lon, anchor.lat, 300),
          point: {
            pixelSize: 8,
            color: Cesium.Color.fromCssColorString('#00d4ff'),
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 1,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: straitCardText(anchor.label, strait?.name ?? '', summary),
            font: '12px "JetBrains Mono", ui-monospace, monospace',
            fillColor: Cesium.Color.fromCssColorString('#e6f7ff'),
            showBackground: true,
            backgroundColor:
              Cesium.Color.fromCssColorString('#07121a').withAlpha(0.82),
            backgroundPadding: new Cesium.Cartesian2(10, 8),
            horizontalOrigin:
              anchor.side === 'left'
                ? Cesium.HorizontalOrigin.RIGHT
                : Cesium.HorizontalOrigin.LEFT,
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            pixelOffset: new Cesium.Cartesian2(
              anchor.side === 'left' ? -14 : 14,
              0,
            ),
            scaleByDistance: new Cesium.NearFarScalar(1.5e5, 1, 3e6, 0.65),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(
              0,
              4.5e6,
            ),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        }),
      );
    }
    return entities;
  }

  return {
    id: 'strait-transits',
    name: 'Strait transits (official)',
    icon: '⛴',
    source: 'UAB · monthly',
    updateInterval: 24 * 3_600_000,

    init(viewer) {
      dataSource = new Cesium.CustomDataSource('strait-transits');
      dataSource.show = false;
      viewer.dataSources.add(dataSource);
      count = 0;
      for (const entity of build()) dataSource.entities.add(entity);
    },
    enable(viewer) {
      if (dataSource) dataSource.show = true;
      // Label glyphs reach the texture atlas a frame or two after the entity
      // first draws; in idle requestRenderMode nothing would draw them.
      for (const ms of [0, 150, 600])
        setTimeout(() => viewer?.scene?.requestRender?.(), ms);
    },
    disable(viewer) {
      if (dataSource) dataSource.show = false;
      viewer?.scene?.requestRender?.();
    },
    async update() {
      return Boolean(dataSource);
    },
    destroy(viewer) {
      if (dataSource) viewer?.dataSources?.remove(dataSource, true);
      dataSource = null;
    },
    getStats() {
      return {
        count,
        countLabel: `${count.toLocaleString('en-US')} in ${stats?.latestMonth ?? '—'}`,
        lastUpdate: Date.parse(stats?.retrievedAt) || null,
        error: stats?.straits ? null : 'Official statistics unavailable',
      };
    },
  };
}
