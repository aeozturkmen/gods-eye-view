import test from 'node:test';
import assert from 'node:assert/strict';
import { createCctvSource, createCctvLayer } from './index.js';

const camera = {
  id: 'pack/camera ?x',
  name: 'Camera & road',
  city: 'Austin',
  lat: 30.267,
  lon: -97.744,
  headingDeg: 45,
  fovDeg: 60,
  pitchDeg: -12,
};

test('camera catalog and health use fixed source routes and caller cancellation', async () => {
  const calls = [];
  const source = createCctvSource({
    fetchImpl: async (path, options) => {
      calls.push({ path, options });
      return new Response(
        JSON.stringify(
          path.endsWith('/sources') ? { sources: [] } : { cameras: [] },
        ),
      );
    },
  });
  const controller = new AbortController();
  await source.getCatalog({ signal: controller.signal });
  await source.getHealth({ signal: controller.signal });
  assert.deepEqual(
    calls.map((call) => call.path),
    ['/api/cctv/sources', '/api/cctv/health'],
  );
  for (const { options } of calls) {
    assert.equal(options.signal, controller.signal);
    assert.equal(options.cache, 'no-store');
  }
});

test('camera sources reject malformed snapshots and failures', async () => {
  for (const method of ['getCatalog', 'getHealth']) {
    const malformed = createCctvSource({
      fetchImpl: async () => new Response('{}'),
    });
    await assert.rejects(malformed[method](), /Malformed camera/);
    const denied = createCctvSource({
      fetchImpl: async () => new Response('', { status: 403 }),
    });
    await assert.rejects(denied[method](), /HTTP 403/);
  }
});

test('cancellation while reading a camera response body prevents publication', async () => {
  const controller = new AbortController();
  const source = createCctvSource({
    fetchImpl: async () => ({
      ok: true,
      json: async () => {
        controller.abort();
        return { sources: [] };
      },
    }),
  });
  await assert.rejects(source.getCatalog({ signal: controller.signal }), {
    name: 'AbortError',
  });
});

test('frame and media URLs preserve registered camera identity and encoded metadata', () => {
  const source = createCctvSource();
  const frame = new URL(source.getFrameUrl(camera), 'https://example.test');
  const media = new URL(source.getMediaUrl(camera), 'https://example.test');
  assert.equal(
    frame.pathname,
    '/api/cctv/frame/' + encodeURIComponent(camera.id),
  );
  assert.equal(
    media.pathname,
    '/api/cctv/media/' + encodeURIComponent(camera.id),
  );
  assert.equal(frame.searchParams.get('label'), camera.name);
  assert.equal(frame.searchParams.get('city'), camera.city);
  assert.equal(frame.searchParams.get('lat'), '30.267000');
  assert.equal(frame.searchParams.get('lon'), '-97.744000');
  assert.equal(frame.searchParams.get('heading'), '45');
  assert.equal(frame.searchParams.get('pitch'), '-12');
  assert.deepEqual([...media.searchParams.keys()], ['ts']);
});

test('frame URLs are memoized per camera and tick, yet follow every pose change', () => {
  const source = createCctvSource();
  const Original = globalThis.URLSearchParams;
  let built = 0;
  globalThis.URLSearchParams = class extends Original {
    constructor(...args) {
      super(...args);
      built += 1;
    }
  };
  try {
    const cam = { ...camera };
    const first = source.getFrameUrl(cam);
    // uiState rebuilds the camera list on every loading notification: the
    // same camera in the same refresh tick must not re-encode its query.
    assert.equal(source.getFrameUrl(cam), first);
    assert.equal(built, 1);
    cam.headingDeg = 90;
    const turned = new URL(source.getFrameUrl(cam), 'https://example.test');
    assert.equal(turned.searchParams.get('heading'), '90');
    assert.equal(built, 2);
    cam.name = 'Renamed';
    assert.equal(
      new URL(source.getFrameUrl(cam), 'https://example.test').searchParams.get(
        'label',
      ),
      'Renamed',
    );
    // A different refresh cadence is a different tick bucket.
    assert.notEqual(source.getFrameUrl(cam, 60_000), source.getFrameUrl(cam));
  } finally {
    globalThis.URLSearchParams = Original;
  }
});

test('camera construction is inert and destruction cancels a pending catalog and its visibility listener', async (t) => {
  const original = globalThis.document;
  const listeners = new Set();
  globalThis.document = {
    addEventListener(type, handler) {
      if (type === 'visibilitychange') listeners.add(handler);
    },
    removeEventListener(type, handler) {
      if (type === 'visibilitychange') listeners.delete(handler);
    },
  };
  t.after(() => {
    globalThis.document = original;
  });
  const noop = () => {};
  const services = {
    overlays: {
      clearOverlaySource: noop,
      hitTestWorldOverlay: noop,
      setOverlayEntries: noop,
      setOverlaySourceVisible: noop,
    },
    sprites: { registerSpriteCollection: noop },
    activation: {},
    locations: {},
    picking: { unregisterPickOwner: noop },
    terrain: {},
    ground: {},
    mesh: {},
    focus: {},
    render: { releaseContinuousRender: noop },
  };
  let resolveCatalog;
  let signal;
  const source = {
    ...createCctvSource(),
    getCatalog(options) {
      signal = options.signal;
      return new Promise((resolve) => {
        resolveCatalog = resolve;
      });
    },
  };
  const a = createCctvLayer({ services, source });
  const b = createCctvLayer({ services, source });
  assert.equal(listeners.size, 0);
  const viewer = {
    scene: { primitives: { add: (value) => value, remove: () => true } },
  };
  const initializing = a.init(viewer);
  assert.equal(listeners.size, 1);
  assert.equal(signal.aborted, false);
  a.destroy(viewer);
  assert.equal(listeners.size, 0);
  assert.equal(signal.aborted, true);
  resolveCatalog({ sources: [] });
  await assert.rejects(initializing, { name: 'AbortError' });
  assert.equal(a.getStats().count, 0);
  assert.equal(b.getStats().count, 0);
});
