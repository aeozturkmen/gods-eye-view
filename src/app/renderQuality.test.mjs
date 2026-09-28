import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyRenderQuality,
  resolveInitialRenderQuality,
  RENDER_QUALITY_PRESETS,
} from './renderQuality.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    map,
  };
}

function fakeViewer() {
  const tileset = { maximumScreenSpaceError: 16, isDestroyed: () => false };
  const other = { show: true };
  const list = [other, tileset];
  let renders = 0;
  return {
    tileset,
    renders: () => renders,
    resolutionScale: 1,
    scene: {
      msaaSamples: 4,
      primitives: { length: list.length, get: (i) => list[i] },
      requestRender: () => (renders += 1),
    },
  };
}

test('the URL wins over the remembered choice, which wins over the default', () => {
  const storage = memoryStorage({ 'gev:render-quality:v1': 'balanced' });
  assert.equal(
    resolveInitialRenderQuality({ search: '?quality=LOW', storage }),
    'low',
  );
  assert.equal(
    resolveInitialRenderQuality({ search: '', storage }),
    'balanced',
  );
  assert.equal(
    resolveInitialRenderQuality({
      search: '?quality=ultra',
      storage: memoryStorage(),
    }),
    'high',
  );
});

test('a preset sets MSAA, resolution and tile detail on the live viewer', () => {
  const viewer = fakeViewer();
  const storage = memoryStorage();
  assert.equal(applyRenderQuality(viewer, 'low', { storage }), 'low');
  const low = RENDER_QUALITY_PRESETS.low;
  assert.equal(viewer.scene.msaaSamples, low.msaa);
  assert.equal(viewer.resolutionScale, low.resolutionScale);
  assert.equal(viewer.tileset.maximumScreenSpaceError, low.tileError);
  assert.equal(storage.map.get('gev:render-quality:v1'), 'low');
  assert.ok(viewer.renders() >= 1, 'requests a frame in idle render mode');
});

test('high restores the stock settings; unknown names fall back to high', () => {
  const viewer = fakeViewer();
  applyRenderQuality(viewer, 'low', { storage: memoryStorage() });
  assert.equal(
    applyRenderQuality(viewer, 'nonsense', { storage: memoryStorage() }),
    'high',
  );
  assert.equal(viewer.scene.msaaSamples, 4);
  assert.equal(viewer.resolutionScale, 1);
  assert.equal(viewer.tileset.maximumScreenSpaceError, 16);
});

test('remember:false applies without overwriting the stored choice', () => {
  const storage = memoryStorage({ 'gev:render-quality:v1': 'balanced' });
  applyRenderQuality(fakeViewer(), 'low', { remember: false, storage });
  assert.equal(storage.map.get('gev:render-quality:v1'), 'balanced');
});
