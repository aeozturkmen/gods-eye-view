import { test } from 'node:test';
import assert from 'node:assert/strict';
import { straitCardText, summarizeStrait } from './model.js';
import stats from './officialStats.json' with { type: 'json' };

const month = (m, vessels, extra = {}) => ({ month: m, vessels, ...extra });

test('averages come from the latest published month, labelled as averages', () => {
  const s = summarizeStrait([
    month('2025-06', 3000),
    month('2026-06', 3220, { tankers: 749, loaOver200m: 401, naval: 7 }),
  ]);
  assert.equal(s.latestMonth, '2026-06');
  assert.equal(Math.round(s.perDay), 107); // 3220 / 30 days
  assert.equal(s.perHour.toFixed(1), '4.5');
  assert.equal(Math.round(s.vsSameMonthLastYear * 100), 7);
  assert.equal(s.tankerShare, 23);
  const text = straitCardText('BOSPHORUS', 'İstanbul Boğazı', s);
  assert.match(text, /Jun 2026: 3,220 transits \(\+7% y\/y\)/);
  assert.match(text, /avg ≈ 4\.5\/h · 107\/day/);
  assert.match(text, /Official monthly totals · UAB · through Jun 2026/);
});

test('12-month comparison needs two full years; unusable series say so', () => {
  const months = [];
  for (let y = 2024; y <= 2025; y++)
    for (let m = 1; m <= 12; m++)
      months.push(
        month(`${y}-${String(m).padStart(2, '0')}`, y === 2024 ? 100 : 110),
      );
  const s = summarizeStrait(months);
  assert.equal(s.last12, 1320);
  assert.equal(Math.round(s.yearOverYear * 100), 10);
  assert.equal(summarizeStrait([]), null);
  assert.match(straitCardText('X', 'Y', null), /unavailable/);
});

test('the bundled official file matches the published first half of 2026', () => {
  const total = (key) =>
    stats.straits[key].months
      .filter((m) => m.month >= '2026-01' && m.month <= '2026-06')
      .reduce((sum, m) => sum + m.vessels, 0);
  // UAB: 19,277 İstanbul and 20,941 Çanakkale transits in Jan–Jun 2026.
  assert.equal(total('bosphorus'), 19277);
  assert.equal(total('dardanelles'), 20941);
});
