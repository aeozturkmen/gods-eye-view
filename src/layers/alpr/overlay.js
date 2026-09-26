import {
  budgetedSampleHeight,
  sampleHeightBudgetAvailable,
} from '../../services/sampleHeightBudget.js';
import * as Cesium from 'cesium';
import {
  MAX_CANVAS_FRUSTUMS,
  MARKER_ICON_SIZE,
  SELECTED_MARKER_ICON_SIZE,
} from './policy.js';
import {
  MARKER_IMAGE,
  SELECTED_IMAGE,
  BRACKETS_IMAGE,
  directionWedgePositions,
  paintDirectionWedge,
  validAlprGroundHeight,
} from './visuals.js';

/** Per-layer presentation on a caller-owned overlay; Cesium remains the fallback. */
export function createAlprOverlay({ state, services }) {
  let lane,
    removeMapListener,
    retryTimer,
    retryUntil = 0;
  let records = [],
    hits = [],
    images = [],
    destroyed = false;
  let surfaceRegime;
  const requestPaint = () => {
    if (!destroyed && state.enabled) lane?.requestPaint();
  };

  function nativeVisible(entity, visible) {
    if (!entity) return;
    const billboard = entity.billboard;
    // Keep a faint native pick target under the canvas badge so sibling layer
    // handlers recognize ALPR ownership instead of treating the click as empty.
    if (!visible && !entity.gevAlprNativeAppearance) {
      entity.gevAlprNativeAppearance = {
        position: entity.position,
        heightReference: billboard.heightReference,
        scaleByDistance: billboard.scaleByDistance,
        color: billboard.color,
      };
      entity.position = entity.gevAlprCanvasPosition;
      entity.gevAlprPickPosition = entity.position;
      billboard.heightReference = Cesium.HeightReference.NONE;
      billboard.scaleByDistance = undefined;
      billboard.color = Cesium.Color.WHITE.withAlpha(0.01);
    } else if (visible && entity.gevAlprNativeAppearance) {
      const saved = entity.gevAlprNativeAppearance;
      if (entity.position === entity.gevAlprPickPosition)
        entity.position = saved.position;
      billboard.heightReference = saved.heightReference;
      billboard.scaleByDistance = saved.scaleByDistance;
      billboard.color = saved.color;
      entity.gevAlprNativeAppearance = null;
      entity.gevAlprPickPosition = null;
    }
    // paint() calls this for every camera on every frame. Assigning a graphics
    // property always raises definitionChanged, and a ground-clamped polygon
    // answers that by re-clamping through Scene.getHeight: a GPU vertex
    // readback over Google 3D tiles. Write only on a real visibility change.
    if (entity.gevAlprNativeShown === visible) return;
    entity.gevAlprNativeShown = visible;
    billboard.show = visible;
    if (entity.polyline) entity.polyline.show = visible;
    if (entity.polygon) entity.polygon.show = visible;
  }

  function resetAnchors() {
    for (const entity of state.dataSource.entities.values) {
      entity.gevAlprCanvasPosition = null;
      entity.gevAlprWedge = null;
      entity.gevAlprDisplayPosition = null;
      entity.gevAlprSampleRetryAt = 0;
      entity.gevAlprSampleFails = 0;
      nativeVisible(entity, true);
    }
    state.lastAnchorSampleAt = 0;
    retryUntil = Date.now() + 15000;
    requestPaint();
  }

  function anchorFor(record, entity) {
    if (entity.gevAlprCanvasPosition) return entity.gevAlprCanvasPosition;
    const scene = state.viewer.scene;
    const location = Cesium.Cartographic.fromDegrees(
      record.longitude,
      record.latitude,
    );
    let height;
    const now = Date.now();
    if (
      scene.sampleHeightSupported &&
      !(entity.gevAlprSampleRetryAt > now)
    ) {
      // Each sample is a pick render + blocking GPU readback, and paint runs
      // every frame for every unresolved camera. Past the shared budget,
      // defer to a later paint instead of settling for a fallback.
      if (!sampleHeightBudgetAvailable(scene)) return null;
      height = budgetedSampleHeight(scene, location, [entity]);
      if (validAlprGroundHeight(height)) {
        entity.gevAlprSampleFails = 0;
      } else {
        // Tiles under this camera are not streamed yet: back off (0.5 s,
        // doubling to 30 s) instead of re-sampling it on every frame.
        const fails = (entity.gevAlprSampleFails || 0) + 1;
        entity.gevAlprSampleFails = fails;
        entity.gevAlprSampleRetryAt =
          now + Math.min(30000, 500 * 2 ** (fails - 1));
      }
    }
    if (!validAlprGroundHeight(height) && scene.globe.show)
      height = scene.globe.getHeight?.(location);
    if (!validAlprGroundHeight(height))
      height = services.groundFloor.cachedGroundFloor(
        record.latitude,
        record.longitude,
      );
    if (!validAlprGroundHeight(height)) return null;
    entity.gevAlprCanvasPosition = Cesium.Cartesian3.fromDegrees(
      record.longitude,
      record.latitude,
      height,
    );
    entity.gevAlprWedge = directionWedgePositions(record, height);
    return entity.gevAlprCanvasPosition;
  }

  function paint({ ctx, width, height, keyhole, occluder }) {
    hits = [];
    if (!state.enabled || destroyed) return;
    let unresolved = false;
    const painted = [];
    for (const record of records) {
      const entity = state.dataSource.entities.getById(record.id);
      if (!entity) continue;
      const selected = record.id === state.selectedId;
      const image = images[selected ? 1 : 0];
      if (
        !image?.complete ||
        !image.naturalWidth ||
        (selected && !images[2]?.naturalWidth)
      ) {
        nativeVisible(entity, true);
        continue;
      }
      const anchor = anchorFor(record, entity);
      if (!anchor) {
        nativeVisible(entity, true);
        unresolved = true;
        continue;
      }
      nativeVisible(entity, false);
      if (occluder && !occluder.isPointVisible(anchor)) continue;
      const scene = state.viewer.scene;
      const origin = Cesium.SceneTransforms.worldToWindowCoordinates(
        scene,
        anchor,
      );
      if (!origin) continue;
      const alpha =
        services.overlays.keyholeAlpha?.(origin.x, origin.y, keyhole) ?? 1;
      if (!(alpha > 0)) continue;
      const wedge = entity.gevAlprWedge;
      if (wedge) {
        const left = Cesium.SceneTransforms.worldToWindowCoordinates(
          scene,
          wedge[1],
        );
        const right = Cesium.SceneTransforms.worldToWindowCoordinates(
          scene,
          wedge[2],
        );
        if (left && right) {
          ctx.save();
          ctx.globalAlpha *= alpha;
          paintDirectionWedge(ctx, origin, left, right, selected);
          ctx.restore();
        }
      }
      if (
        origin.x < -60 ||
        origin.x > width + 60 ||
        origin.y < -60 ||
        origin.y > height + 60
      )
        continue;
      // Faint native pick target under the badge; assign only on change (see
      // nativeVisible) so a steady frame raises no definitionChanged.
      if (entity.billboard.show?.getValue?.() !== true)
        entity.billboard.show = true;
      painted.push({ record, origin, selected, image, alpha });
      if (selected) entity.gevAlprDisplayPosition = anchor;
    }
    // Paint all glyphs after the wedges so one camera's cone cannot wash out another.
    for (const { record, origin, selected, image, alpha } of painted) {
      const size = selected ? SELECTED_MARKER_ICON_SIZE : MARKER_ICON_SIZE;
      ctx.save();
      ctx.globalAlpha *= alpha;
      ctx.drawImage(
        image,
        origin.x - size / 2,
        origin.y - size / 2,
        size,
        size,
      );
      if (selected)
        ctx.drawImage(
          images[2],
          origin.x - size / 2,
          origin.y - size / 2,
          size,
          size,
        );
      ctx.restore();
      hits.push({ id: record.id, x: origin.x, y: origin.y, radius: size / 2 });
    }
    if (unresolved && !retryTimer && Date.now() < retryUntil) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        requestPaint();
      }, 250);
    }
  }

  return {
    init() {
      destroyed = false;
      if (!services.overlays?.registerPaintLane || typeof Image === 'undefined')
        return;
      lane = services.overlays.registerPaintLane('selected', paint, {
        id: `alpr-${Cesium.createGuid()}`,
        active: false,
      });
      images = [MARKER_IMAGE, SELECTED_IMAGE, BRACKETS_IMAGE].map((src) => {
        const image = new Image();
        image.onload = requestPaint;
        image.onerror = requestPaint;
        image.src = src;
        return image;
      });
      surfaceRegime = state.viewer.scene.globe.show;
      removeMapListener = services.overlays.subscribeMapStack?.((event) => {
        if (event.detail?.status !== 'ready') return;
        const next = state.viewer.scene.globe.show;
        if (next === surfaceRegime) return;
        surfaceRegime = next;
        resetAnchors();
      });
    },
    sync(visible) {
      if (!lane) return;
      for (const record of records)
        nativeVisible(state.dataSource.entities.getById(record.id), true);
      const position = state.viewer.camera.positionWC;
      records = visible
        .filter(
          (record) =>
            Number.isFinite(record.directionDeg) &&
            record.id !== state.selectedId,
        )
        .map((record) => ({
          record,
          distance: position
            ? Cesium.Cartesian3.distanceSquared(
                position,
                Cesium.Cartesian3.fromDegrees(
                  record.longitude,
                  record.latitude,
                ),
              )
            : 0,
        }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, MAX_CANVAS_FRUSTUMS)
        .map((item) => item.record);
      const selected = visible.find((record) => record.id === state.selectedId);
      if (selected) {
        if (records.length >= MAX_CANVAS_FRUSTUMS) records.pop();
        records.push(selected);
      }
      hits = [];
      retryUntil = Date.now() + 15000;
      lane.setActive(state.enabled && records.length > 0);
      requestPaint();
    },
    pick(position) {
      if (!state.enabled || !position) return null;
      let closest,
        distance = Infinity;
      for (const hit of hits) {
        const next = (hit.x - position.x) ** 2 + (hit.y - position.y) ** 2;
        if (next <= hit.radius ** 2 && next <= distance) {
          closest = hit.id;
          distance = next;
        }
      }
      return closest || null;
    },
    clear() {
      clearTimeout(retryTimer);
      retryTimer = null;
      for (const record of records)
        nativeVisible(state.dataSource?.entities.getById(record.id), true);
      records = [];
      hits = [];
      lane?.setActive(false);
    },
    destroy() {
      this.clear();
      destroyed = true;
      removeMapListener?.();
      removeMapListener = null;
      lane?.unregister();
      lane = null;
      for (const image of images) {
        image.onload = null;
        image.onerror = null;
      }
      images = [];
    },
  };
}
