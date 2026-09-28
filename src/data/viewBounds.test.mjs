import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createViewBounds, offscreenTurn } from './viewBounds.js';

const deg = (d) => (d * Math.PI) / 180;
const rect = (w, s, e, n) => ({
  west: deg(w),
  south: deg(s),
  east: deg(e),
  north: deg(n),
});

test('an ordinary view contains points inside its padded box only', () => {
  const b = createViewBounds(rect(28, 40, 30, 42), { padDeg: 1 });
  assert.equal(b.contains(41, 29), true);
  assert.equal(b.contains(42.9, 30.9), true, 'inside the padding');
  assert.equal(b.contains(44, 29), false);
  assert.equal(b.contains(41, 35), false);
});

test('a view across the antimeridian wraps longitude', () => {
  const b = createViewBounds(rect(170, -10, -170, 10), { padDeg: 1 });
  assert.equal(b.contains(0, 175), true);
  assert.equal(b.contains(0, -175), true);
  assert.equal(b.contains(0, 180), true);
  assert.equal(b.contains(0, 0), false);
  assert.equal(b.contains(0, 160), false);
});

test('padding that covers every longitude never splits the box (polar views)', () => {
  // A pole in view: Cesium reports lon -180..180 with a narrow latitude band.
  const b = createViewBounds(rect(-180, 70, 180, 90), { padDeg: 2 });
  for (const lon of [-179, -90, 0, 90, 179])
    assert.equal(b.contains(80, lon), true);
  assert.equal(b.contains(60, 0), false);
});

test('no view rectangle (sky in view) means everything counts as visible', () => {
  const b = createViewBounds(undefined);
  assert.equal(b.all, true);
  assert.equal(b.contains(-89, 179), true);
});

test('non-finite coordinates are treated as visible, never skipped', () => {
  const b = createViewBounds(rect(28, 40, 30, 42));
  assert.equal(b.contains(Number.NaN, 29), true);
});

test('offscreen records get one turn every `stride` ticks, spread by index', () => {
  const stride = 5;
  const turns = new Array(10).fill(0);
  for (let tick = 0; tick < stride * 4; tick++)
    for (let index = 0; index < turns.length; index++)
      if (offscreenTurn(index, tick, stride)) turns[index] += 1;
  assert.ok(
    turns.every((n) => n === 4),
    `${turns}`,
  );
});

test('fleet culling reads the coordinate fields the flight records actually store', async () => {
  // Regression: reading fix.latitude (undefined) made every contact fail open
  // as "visible", silently disabling culling.
  const { readFileSync } = await import('node:fs');
  for (const layer of ['flights', 'military']) {
    const records = readFileSync(
      new URL(`../layers/${layer}/records.js`, import.meta.url),
      'utf8',
    );
    const rendering = readFileSync(
      new URL(`../layers/${layer}/rendering.js`, import.meta.url),
      'utf8',
    );
    assert.match(
      records,
      /rawLat: lat,\s*rawLon: lon,/,
      `${layer} records store rawLat/rawLon`,
    );
    assert.match(
      rendering,
      /viewBounds\.contains\(fix\?\.rawLat, fix\?\.rawLon\)/,
      `${layer} culling reads rawLat/rawLon`,
    );
  }
});
