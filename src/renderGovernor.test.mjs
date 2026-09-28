import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  installRenderGovernor,
  holdContinuousRender,
  releaseContinuousRender,
  governorRequestRender,
  getRenderGovernorDiagnostics,
  holdPacedRender,
  releasePacedRender,
  _setPacerSchedulerForTest,
  _resetRenderGovernorForTest,
} from './renderGovernor.js';

function makeViewer() {
  const calls = { requestRender: 0 };
  const scene = {
    requestRenderMode: false,
    maximumRenderTimeChange: 0,
    requestRender() { calls.requestRender += 1; },
  };
  return { viewer: { scene }, scene, calls };
}

beforeEach(() => _resetRenderGovernorForTest());

test('install with zero holds enters idle mode and pins maximumRenderTimeChange', () => {
  const { viewer, scene } = makeViewer();
  installRenderGovernor(viewer);
  assert.equal(scene.requestRenderMode, true);
  assert.equal(scene.maximumRenderTimeChange, Infinity);
  assert.equal(getRenderGovernorDiagnostics().mode, 'idle');
});

test('a hold flips to continuous; releasing the last hold returns to idle with a settling frame', () => {
  const { viewer, scene, calls } = makeViewer();
  installRenderGovernor(viewer);
  const settleBaseline = calls.requestRender;
  holdContinuousRender('flights');
  assert.equal(scene.requestRenderMode, false);
  assert.equal(getRenderGovernorDiagnostics().mode, 'continuous');
  releaseContinuousRender('flights');
  assert.equal(scene.requestRenderMode, true);
  // Entering idle renders one settling frame.
  assert.equal(calls.requestRender, settleBaseline + 1);
});

test('holds are identity-keyed: double-hold cannot leak, double-release cannot corrupt', () => {
  const { viewer, scene } = makeViewer();
  installRenderGovernor(viewer);
  holdContinuousRender('traffic');
  holdContinuousRender('traffic');
  releaseContinuousRender('traffic');
  assert.equal(scene.requestRenderMode, true, 'single release clears an idempotent double-hold');
  releaseContinuousRender('traffic');
  releaseContinuousRender('never-held');
  assert.equal(scene.requestRenderMode, true);
});

test('mode stays continuous until the LAST holder releases', () => {
  const { viewer, scene } = makeViewer();
  installRenderGovernor(viewer);
  holdContinuousRender('flights');
  holdContinuousRender('satellites');
  releaseContinuousRender('flights');
  assert.equal(scene.requestRenderMode, false);
  assert.deepEqual(getRenderGovernorDiagnostics().holds, ['satellites']);
  releaseContinuousRender('satellites');
  assert.equal(scene.requestRenderMode, true);
});

test('governorRequestRender forwards to the scene and records reasons only in idle mode', () => {
  const { viewer, calls } = makeViewer();
  installRenderGovernor(viewer);
  const baseline = calls.requestRender;
  governorRequestRender('layer-tick:earthquakes');
  assert.equal(calls.requestRender, baseline + 1);
  assert.equal(getRenderGovernorDiagnostics().recentRequests.at(-1).reason, 'layer-tick:earthquakes');
  holdContinuousRender('flights');
  const idleRequests = getRenderGovernorDiagnostics().recentRequests.length;
  governorRequestRender('slider');
  assert.equal(
    getRenderGovernorDiagnostics().recentRequests.length,
    idleRequests,
    'continuous-mode requests are not recorded as idle diagnostics',
  );
});

test('hold/release/request are safe no-ops before install (test environments without a viewer)', () => {
  holdContinuousRender('flights');
  releaseContinuousRender('flights');
  governorRequestRender('noop');
  assert.equal(getRenderGovernorDiagnostics().installed, false);
});

test('holds registered before install apply at install time', () => {
  holdContinuousRender('flights');
  const { viewer, scene } = makeViewer();
  installRenderGovernor(viewer);
  assert.equal(scene.requestRenderMode, false, 'pre-install hold keeps continuous mode');
  releaseContinuousRender('flights');
  assert.equal(scene.requestRenderMode, true);
});

// ── Paced mode ──────────────────────────────────────────────────────────

/** Manual scheduler: tests fire the pacer timer by hand. */
function manualScheduler() {
  const pending = [];
  return {
    pending,
    schedule(fn, ms) {
      const entry = { fn, ms, cancelled: false };
      pending.push(entry);
      return entry;
    },
    cancel(entry) {
      if (entry) entry.cancelled = true;
    },
    fireNext() {
      let entry = pending.shift();
      while (entry?.cancelled) entry = pending.shift();
      if (entry) entry.fn();
      return entry;
    },
  };
}

test('paced holds keep requestRenderMode and request frames at the fastest cadence', () => {
  const clock = manualScheduler();
  _setPacerSchedulerForTest(clock, () => false);
  const { viewer, scene, calls } = makeViewer();
  installRenderGovernor(viewer);
  holdPacedRender('ais-vessels', 800);
  holdPacedRender('flights', 80);
  assert.equal(scene.requestRenderMode, true);
  const diag = getRenderGovernorDiagnostics();
  assert.equal(diag.mode, 'paced');
  assert.deepEqual(diag.holds, []);
  assert.deepEqual(diag.paced, { 'ais-vessels': 800, flights: 80 });
  const before = calls.requestRender;
  const tick = clock.pending.at(-1);
  assert.equal(tick.ms, 80);
  clock.fireNext();
  assert.ok(calls.requestRender > before);
  // The chain re-arms itself at the current fastest interval.
  assert.equal(clock.pending.filter((e) => !e.cancelled).at(-1).ms, 80);
});

test('a continuous hold wins over paced holds, and releasing it returns to paced', () => {
  _setPacerSchedulerForTest(manualScheduler(), () => false);
  const { viewer, scene } = makeViewer();
  installRenderGovernor(viewer);
  holdPacedRender('flights', 80);
  holdContinuousRender('tracked-entity');
  assert.equal(scene.requestRenderMode, false);
  assert.equal(getRenderGovernorDiagnostics().mode, 'continuous');
  releaseContinuousRender('tracked-entity');
  assert.equal(scene.requestRenderMode, true);
  assert.equal(getRenderGovernorDiagnostics().mode, 'paced');
});

test('releasing the last paced hold stops the pacer and returns to idle', () => {
  const clock = manualScheduler();
  _setPacerSchedulerForTest(clock, () => false);
  const { viewer, calls } = makeViewer();
  installRenderGovernor(viewer);
  holdPacedRender('flights', 80);
  releasePacedRender('flights');
  assert.equal(getRenderGovernorDiagnostics().mode, 'idle');
  const before = calls.requestRender;
  for (const entry of clock.pending) if (!entry.cancelled) entry.fn();
  assert.equal(calls.requestRender, before, 'no frames after release');
});

test('the pacer requests nothing while the tab is hidden', () => {
  const clock = manualScheduler();
  let hidden = true;
  _setPacerSchedulerForTest(clock, () => hidden);
  const { viewer, calls } = makeViewer();
  installRenderGovernor(viewer);
  holdPacedRender('flights', 80);
  const before = calls.requestRender;
  clock.fireNext();
  assert.equal(calls.requestRender, before);
  hidden = false;
  clock.fireNext();
  assert.equal(calls.requestRender, before + 1);
});
