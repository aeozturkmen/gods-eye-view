import * as Cesium from 'cesium';
import {
  readCameraTargetFrame,
  setCameraTargetFrame,
} from './cameraOrientationControls.js';
import { isPickedWorldPosition } from '../data/scenePick.js';

/** One button press halves (zoom in) or doubles (zoom out) the orbit range. */
export const ZOOM_STEP_FACTOR = 2;
/** Slider ends, as camera height above the ellipsoid in metres (log scale). */
export const ZOOM_SLIDER_MIN_HEIGHT_M = 30;
export const ZOOM_SLIDER_MAX_HEIGHT_M = 30_000_000;
const SLIDER_STEPS = 1000;
/** Same floor the follow camera uses for a tracked target (trackedCamera.js). */
const MIN_TRACKED_RANGE_M = 150;
const MIN_FREE_RANGE_M = 20;
const MAX_RANGE_M = 45_000_000;
const ANIMATION_MS = 380;

const LOG_MIN = Math.log(ZOOM_SLIDER_MIN_HEIGHT_M);
const LOG_SPAN = Math.log(ZOOM_SLIDER_MAX_HEIGHT_M) - LOG_MIN;

/** Map a camera height to a slider position; 0 = whole globe, SLIDER_STEPS = closest
 * (so the slider reads left-to-right like its − and + buttons). */
export function heightToSliderValue(heightM) {
  const height = Cesium.Math.clamp(
    Number.isFinite(heightM) ? heightM : ZOOM_SLIDER_MAX_HEIGHT_M,
    ZOOM_SLIDER_MIN_HEIGHT_M,
    ZOOM_SLIDER_MAX_HEIGHT_M,
  );
  return Math.round(
    (1 - (Math.log(height) - LOG_MIN) / LOG_SPAN) * SLIDER_STEPS,
  );
}

/** Inverse of {@link heightToSliderValue}. */
export function sliderValueToHeight(value) {
  const t = 1 - Cesium.Math.clamp(Number(value) / SLIDER_STEPS, 0, 1);
  return Math.exp(LOG_MIN + t * LOG_SPAN);
}

/** Clamp an orbit range to what the current camera mode allows. */
export function clampZoomRange(range, { tracked = false } = {}) {
  return Cesium.Math.clamp(
    range,
    tracked ? MIN_TRACKED_RANGE_M : MIN_FREE_RANGE_M,
    MAX_RANGE_M,
  );
}

/**
 * Camera height above the ground under it (falls back to the ellipsoid height).
 * Above-ground is what "zoom level" means to a viewer: over a plateau the
 * ellipsoid height never gets near the slider's close end.
 */
function cameraHeight(viewer) {
  const cartographic = viewer?.camera?.positionCartographic;
  const height = cartographic?.height;
  if (!Number.isFinite(height)) return null;
  let ground = 0;
  try {
    ground = viewer.scene?.globe?.getHeight?.(cartographic) ?? 0;
  } catch {
    ground = 0;
  }
  const aboveGround = height - (Number.isFinite(ground) ? ground : 0);
  return aboveGround > 1 ? aboveGround : Math.max(1, height);
}

/**
 * Bind the bottom-left zoom cluster: − button, log-height slider, + button.
 *
 * Zoom changes only the orbit RANGE around the point under the screen centre
 * (or the tracked entity), through the same frame helpers the tilt and
 * north-up buttons use, so a tracked target stays tracked and centred.
 */
export function bindMapZoomControls({ viewer, elements, runNavigation }) {
  const zoomInButton = elements?.zoomInButton;
  const zoomOutButton = elements?.zoomOutButton;
  const slider = elements?.slider;
  const removers = [];
  let destroyed = false;
  let removeAnimation = null;
  let pendingRange = null;
  let dragging = false;
  let sliderFrame = 0;
  let appliedSliderValue = null;

  const cancelAnimation = () => {
    removeAnimation?.();
    removeAnimation = null;
    pendingRange = null;
  };

  /** Ease the orbit range in log space so each step feels the same size. */
  function animateRange(frame, range) {
    cancelAnimation();
    const scene = viewer?.scene;
    if (!scene?.preUpdate?.addEventListener) {
      return setCameraTargetFrame(viewer, { ...frame, range });
    }
    const entity = viewer.trackedEntity;
    const start = performance.now();
    const fromLog = Math.log(frame.range);
    const toLog = Math.log(range);
    pendingRange = range;
    removeAnimation = scene.preUpdate.addEventListener(() => {
      if (viewer.isDestroyed?.() || viewer.trackedEntity !== entity) {
        cancelAnimation();
        return;
      }
      const progress = Cesium.Math.clamp(
        (performance.now() - start) / ANIMATION_MS,
        0,
        1,
      );
      const eased = Cesium.EasingFunction.QUADRATIC_OUT(progress);
      const current = entity ? readCameraTargetFrame(viewer) : null;
      const target = current?.target || frame.target;
      if (
        !isPickedWorldPosition(target) ||
        !setCameraTargetFrame(viewer, {
          ...frame,
          ...(current
            ? { heading: current.heading, pitch: current.pitch }
            : {}),
          target,
          range: Math.exp(Cesium.Math.lerp(fromLog, toLog, eased)),
        })
      ) {
        cancelAnimation();
        return;
      }
      if (progress === 1) cancelAnimation();
    });
    scene.requestRender?.();
    return true;
  }

  /**
   * Multiply the view distance by `factor` (< 1 zooms in).
   * @returns {boolean} Whether the camera moved.
   */
  function zoomBy(factor, { animate = true } = {}) {
    if (destroyed || !Number.isFinite(factor) || factor <= 0) return false;
    const base = pendingRange;
    const result = runNavigation('camera', () => {
      const frame = readCameraTargetFrame(viewer);
      const tracked = Boolean(viewer.trackedEntity);
      if (frame) {
        const range = clampZoomRange((base ?? frame.range) * factor, {
          tracked,
        });
        if (animate) return animateRange(frame, range);
        cancelAnimation();
        return setCameraTargetFrame(viewer, { ...frame, range });
      }
      // Nothing under the screen centre (looking at sky or space): move along
      // the view direction by the same proportion of the camera's height.
      const height = cameraHeight(viewer);
      const camera = viewer?.camera;
      if (!camera || !height) return false;
      const amount = height * Math.abs(1 - factor);
      if (factor < 1)
        camera.zoomIn(Math.min(amount, height - MIN_FREE_RANGE_M));
      else camera.zoomOut(amount);
      viewer.scene?.requestRender?.();
      return true;
    });
    return Boolean(result);
  }

  const zoomIn = () => zoomBy(1 / ZOOM_STEP_FACTOR);
  const zoomOut = () => zoomBy(ZOOM_STEP_FACTOR);

  /** Keep the slider thumb on the camera's current height (cheap; per frame). */
  function sync() {
    if (destroyed || dragging || !slider) return;
    const height = cameraHeight(viewer);
    if (height === null) return;
    const value = heightToSliderValue(height);
    if (value === appliedSliderValue) return;
    appliedSliderValue = value;
    slider.value = String(value);
    slider.setAttribute(
      'aria-valuetext',
      height >= 10_000
        ? `${Math.round(height / 1000).toLocaleString()} km above ground`
        : `${Math.round(height).toLocaleString()} m above ground`,
    );
  }

  function applySlider() {
    sliderFrame = 0;
    const height = cameraHeight(viewer);
    if (!slider || !height) return;
    const wanted = sliderValueToHeight(slider.value);
    const factor = wanted / height;
    if (Math.abs(Math.log(factor)) < 0.01) return;
    zoomBy(factor, { animate: false });
  }

  const listen = (element, type, handler, options) => {
    if (!element) return;
    element.addEventListener(type, handler, options);
    removers.push(() => element.removeEventListener(type, handler, options));
  };
  listen(zoomInButton, 'click', zoomIn);
  listen(zoomOutButton, 'click', zoomOut);
  listen(slider, 'input', () => {
    dragging = true;
    if (!sliderFrame) sliderFrame = requestAnimationFrame(applySlider);
  });
  listen(slider, 'change', () => {
    dragging = false;
    appliedSliderValue = null;
    sync();
  });
  listen(slider, 'pointerup', () => {
    dragging = false;
  });
  listen(slider, 'blur', () => {
    dragging = false;
  });

  const subscribe = (event, handler) => {
    const remove = event?.addEventListener?.(handler);
    if (typeof remove === 'function') removers.push(remove);
  };
  subscribe(viewer?.scene?.preRender, sync);
  subscribe(viewer?.trackedEntityChanged, cancelAnimation);
  const canvas = viewer?.scene?.canvas;
  for (const type of ['pointerdown', 'wheel']) {
    canvas?.addEventListener?.(type, cancelAnimation, { passive: true });
    removers.push(() => canvas?.removeEventListener?.(type, cancelAnimation));
  }
  sync();

  return {
    zoomIn,
    zoomOut,
    zoomBy,
    sync,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelAnimation();
      if (sliderFrame) cancelAnimationFrame(sliderFrame);
      for (const remove of removers.splice(0)) remove();
    },
  };
}
