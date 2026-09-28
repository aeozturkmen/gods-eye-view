import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGnssAggregator,
  gnssEvidence,
  gnssInterferenceProxy,
} from '../../server/providers/gnssInterference.js';
import { gnssLevel } from '../layers/gnss/index.js';

const ac = (hex, nac_p, lat = 35.2, lon = 33.2, extra = {}) => ({
  hex,
  type: 'adsb_icao',
  version: 2,
  nac_p,
  lat,
  lon,
  alt_baro: 36000,
  seen_pos: 1,
  ...extra,
});

test('only direct ADS-B v1+ airborne fixes count as GNSS evidence', () => {
  assert.equal(gnssEvidence(ac('abc123', 9)).bad, false);
  assert.equal(gnssEvidence(ac('abc123', 0)).bad, true);
  assert.equal(gnssEvidence(ac('abc123', 0, 35, 33, { type: 'mlat' })), null);
  assert.equal(gnssEvidence(ac('abc123', 0, 35, 33, { version: 0 })), null);
  assert.equal(
    gnssEvidence(ac('abc123', 0, 35, 33, { alt_baro: 'ground' })),
    null,
  );
  assert.equal(gnssEvidence(ac('abc123', 0, 35, 33, { seen_pos: 90 })), null);
  assert.equal(gnssEvidence(ac('~tisb1', 0)), null);
});

test('cells count distinct aircraft and need five before they show', () => {
  let t = Date.parse('2026-09-28T10:00:00Z');
  const agg = createGnssAggregator({ now: () => t });
  agg.add([ac('aaaaa1', 9), ac('aaaaa2', 9), ac('aaaaa4', 9), ac('aaaaa5', 9)]);
  assert.equal(agg.snapshot().cells.length, 0, 'four aircraft are not enough');
  agg.add([ac('aaaaa1', 9), ac('aaaaa3', 3)]); // repeat + one degraded
  const [cell] = agg.snapshot().cells;
  assert.equal(cell.aircraft, 5);
  assert.equal(cell.degraded, 1);
  assert.equal(cell.south, 35);
  assert.equal(cell.west, 33);
  // Same aircraft later degraded counts once, as degraded.
  agg.add([ac('aaaaa1', 2)]);
  assert.equal(agg.snapshot().cells[0].degraded, 2);
  assert.equal(agg.snapshot().cells[0].aircraft, 5);
  // Rolls off after 24 h.
  t += 25 * 3_600_000;
  assert.equal(agg.snapshot().cells.length, 0);
});

test('gpsjam thresholds: <2% low, 2–10% medium, above high', () => {
  assert.equal(gnssLevel(0).id, 'low');
  assert.equal(gnssLevel(0.05).id, 'medium');
  assert.equal(gnssLevel(0.5).id, 'high');
});

function manualTimers() {
  const queue = [];
  return {
    queue,
    setTimeout(fn, ms) {
      const t = { fn, ms, cancelled: false, unref() {} };
      queue.push(t);
      return t;
    },
    clearTimeout(t) {
      if (t) t.cancelled = true;
    },
    async runNext() {
      let t = queue.shift();
      while (t?.cancelled) t = queue.shift();
      if (t) await t.fn();
    },
  };
}

function request(handler, url = '/') {
  let status = 0;
  let body = '';
  handler(
    { method: 'GET', url },
    {
      writeHead: (s) => (status = s),
      end: (b) => (body = b),
    },
  );
  return { status, body: JSON.parse(body) };
}

test('polls adsb.lol only while someone watches, one anchor at a time', async () => {
  let t = 0;
  const calls = [];
  const timers = manualTimers();
  const proxy = gnssInterferenceProxy({
    now: () => t,
    timers,
    pollGapMs: 12_000,
    anchors: [
      [41, 29, 250],
      [35, 33, 250],
    ],
    fetchImpl: async (url) => {
      calls.push(url);
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () =>
          JSON.stringify({
            ac: ['bbbbb1', 'bbbbb2', 'bbbbb3', 'bbbbb4', 'bbbbb5'].map(
              (hex, i) => ac(hex, i ? 9 : 1),
            ),
          }),
      };
    },
  });
  assert.equal(calls.length, 0, 'nothing runs before the layer is opened');
  const first = request(proxy._handler);
  assert.equal(first.status, 200);
  assert.equal(first.body.cells.length, 0);
  await timers.runNext(); // immediate first anchor
  assert.deepEqual(calls, ['https://api.adsb.lol/v2/point/41/29/250']);
  // A second request while the loop runs must not start another loop.
  request(proxy._handler);
  const pendingBefore = timers.queue.filter((x) => !x.cancelled).length;
  assert.equal(pendingBefore, 1);
  t += 12_000;
  await timers.runNext();
  assert.equal(calls.at(-1), 'https://api.adsb.lol/v2/point/35/33/250');
  assert.equal(request(proxy._handler).body.cells.length, 1);
  // Nobody asks for 5+ minutes: the loop stops, no further upstream calls.
  t += 6 * 60_000;
  const count = calls.length;
  await timers.runNext();
  assert.equal(calls.length, count);
  assert.equal(timers.queue.filter((x) => !x.cancelled).length, 0);
  proxy._dispose();
});
