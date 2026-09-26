import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  budgetedSampleHeight,
  sampleHeightBudgetAvailable,
  SAMPLE_HEIGHT_BURST_MS,
  SAMPLE_HEIGHT_DUTY,
} from './sampleHeightBudget.js';

/**
 * A scene whose sampleHeight costs `costMs` of fake time per call and, like
 * Cesium's pick path (Scene.updateFrameState), advances frameNumber on every
 * call, so a frame-number budget would reset itself each time.
 */
function fakeScene({ costMs = 3, height = 12 } = {}) {
  const clock = { now: 0 };
  const scene = {
    sampleHeightSupported: true,
    frameState: { frameNumber: 1 },
    calls: 0,
    sampleHeight() {
      scene.calls += 1;
      scene.frameState.frameNumber += 1;
      clock.now += costMs;
      return height;
    },
  };
  return { scene, clock, now: () => clock.now };
}

test('a burst of samples stops at the readback budget even though picks bump frameNumber', () => {
  const { scene, now } = fakeScene({ costMs: 3 });
  const results = [];
  for (let i = 0; i < 50; i++)
    results.push(budgetedSampleHeight(scene, {}, [], { now }));
  assert.equal(scene.calls, Math.ceil(SAMPLE_HEIGHT_BURST_MS / 3));
  assert.ok(results.slice(scene.calls).every((h) => h === undefined));
});

test('one very slow readback holds off the next ones until the bucket refills', () => {
  const { scene, clock, now } = fakeScene({ costMs: 200 });
  assert.equal(budgetedSampleHeight(scene, {}, [], { now }), 12);
  assert.equal(budgetedSampleHeight(scene, {}, [], { now }), undefined);
  assert.equal(sampleHeightBudgetAvailable(scene, { now }), false);
  // Refill runs at SAMPLE_HEIGHT_DUTY of wall time: the 200 ms readback minus
  // the starting burst allowance must be repaid before another sample runs.
  clock.now += (200 - SAMPLE_HEIGHT_BURST_MS) / SAMPLE_HEIGHT_DUTY - 1;
  assert.equal(sampleHeightBudgetAvailable(scene, { now }), false);
  clock.now += 2;
  assert.equal(budgetedSampleHeight(scene, {}, [], { now }), 12);
  assert.equal(scene.calls, 2);
});

test('readbacks cannot exceed the duty share of wall time over a long run', () => {
  const { scene, clock, now } = fakeScene({ costMs: 20 });
  let wall = 0;
  for (let frame = 0; frame < 600; frame++) {
    // 16 ms of other work per frame, then every layer asks for samples.
    clock.now += 16;
    for (let i = 0; i < 30; i++) budgetedSampleHeight(scene, {}, [], { now });
  }
  wall = clock.now;
  const spent = scene.calls * 20;
  assert.ok(spent / wall <= SAMPLE_HEIGHT_DUTY + 0.02, `${spent / wall}`);
});

test('scenes without sampleHeight and throwing samples answer undefined', () => {
  assert.equal(budgetedSampleHeight({}, {}), undefined);
  const scene = {
    sampleHeightSupported: true,
    sampleHeight() {
      throw new Error('tiles streaming');
    },
  };
  assert.equal(budgetedSampleHeight(scene, {}), undefined);
});
