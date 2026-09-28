import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHealth } from './health.js';

function harness({ auto = true, rows }) {
  const activations = [];
  const state = {
    _lastHealthSyncAt: 0,
    _healthById: new Map(),
    _activeCameraId: 'austin-354',
    _activeCameraAuto: auto,
    _records: ['austin-354', 'austin-135', 'austin-133', 'austin-562'].map(
      (id) => ({ camera: { id } }),
    ),
  };
  const parts = {
    model: { safeNumber: (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d) },
    selection: {
      setActiveCamera(id) {
        activations.push(id);
        state._activeCameraId = id;
        state._activeCameraAuto = false; // explicit selections clear the flag
        return 'activated';
      },
    },
  };
  const source = { getHealth: async () => ({ cameras: rows }) };
  const health = createHealth({ state, services: {}, parts, source });
  return { state, health, activations };
}

const offline = (id) => ({
  id,
  status: 'degraded',
  sourceKind: 'synthetic',
  providerOffline: true,
});

test('an automatically chosen default camera that is offline hands over to the next usable one', async () => {
  const h = harness({
    rows: [offline('austin-354'), offline('austin-135'), { id: 'austin-133', status: 'ok' }],
  });
  await h.health.syncHealthState(true);
  assert.deepEqual(h.activations, ['austin-133']);
  // Still an automatic pick: a later offline report may move it again.
  assert.equal(h.state._activeCameraAuto, true);
  assert.equal(h.state._healthById.get('austin-354').offline, true);
});

test('a camera the user chose is never swapped, even when offline', async () => {
  const h = harness({ auto: false, rows: [offline('austin-354')] });
  await h.health.syncHealthState(true);
  assert.deepEqual(h.activations, []);
  assert.equal(h.state._activeCameraId, 'austin-354');
});

test('an online default camera stays put', async () => {
  const h = harness({ rows: [{ id: 'austin-354', status: 'ok' }] });
  await h.health.syncHealthState(true);
  assert.deepEqual(h.activations, []);
});
