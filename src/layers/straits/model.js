/**
 * Summaries of the official Turkish Straits transit statistics
 * (officialStats.json, refreshed by scripts/update-strait-stats.py).
 *
 * The ministry publishes monthly totals once a quarter, so "per hour / per
 * day / per week" here are averages of the latest published month, labelled
 * as such — never presented as live counts. Live AIS has no usable receiver
 * coverage at either strait (AISStream saw 1 and 0 vessels), so it is not
 * mixed in.
 */

/** Gate midpoints: Rumeli–Anadolu Hisarı and Kilitbahir–Çanakkale narrows. */
export const STRAIT_ANCHORS = Object.freeze({
  // The Bosphorus card opens west, over Thrace, clear of the right-hand panels.
  bosphorus: Object.freeze({
    lat: 41.0842,
    lon: 29.062,
    label: 'BOSPHORUS',
    side: 'left',
  }),
  dardanelles: Object.freeze({
    lat: 40.147,
    lon: 26.389,
    label: 'DARDANELLES',
  }),
});

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const monthLabel = (ym) =>
  `${MONTHS[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}`;
const daysIn = (ym) =>
  new Date(
    Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5)), 0),
  ).getUTCDate();
const pct = (part, whole) => (whole ? Math.round((100 * part) / whole) : 0);

/** Numbers for one strait, or null when the series is unusable. */
export function summarizeStrait(months) {
  const series = (months || [])
    .filter((m) => /^\d{4}-\d{2}$/.test(m?.month) && Number.isFinite(m.vessels))
    .sort((a, b) => a.month.localeCompare(b.month));
  if (!series.length) return null;
  const latest = series.at(-1);
  const perDay = latest.vessels / daysIn(latest.month);
  const last12 = series.slice(-12);
  const prior12 = series.slice(-24, -12);
  const sum = (list) => list.reduce((total, m) => total + m.vessels, 0);
  const yearOverYear =
    last12.length === 12 && prior12.length === 12
      ? (sum(last12) - sum(prior12)) / sum(prior12)
      : null;
  const sameMonthLastYear = series.find(
    (m) =>
      m.month ===
      `${Number(latest.month.slice(0, 4)) - 1}${latest.month.slice(4)}`,
  );
  return {
    latestMonth: latest.month,
    latest: latest.vessels,
    perHour: perDay / 24,
    perDay,
    perWeek: perDay * 7,
    last3: sum(series.slice(-3)),
    last12: last12.length === 12 ? sum(last12) : null,
    yearOverYear,
    vsSameMonthLastYear: sameMonthLastYear
      ? (latest.vessels - sameMonthLastYear.vessels) / sameMonthLastYear.vessels
      : null,
    tankerShare: pct(latest.tankers ?? 0, latest.vessels),
    over200mShare: pct(latest.loaOver200m ?? 0, latest.vessels),
    naval: latest.naval ?? null,
  };
}

const signed = (ratio) =>
  `${ratio >= 0 ? '+' : '−'}${Math.abs(Math.round(ratio * 100))}%`;

/** Card text for the map label. */
export function straitCardText(label, name, s) {
  if (!s) return `${label} · ${name}\nOfficial statistics unavailable`;
  const lines = [
    `${label} · ${name}`,
    `${monthLabel(s.latestMonth)}: ${fmt(s.latest)} transits` +
      (s.vsSameMonthLastYear == null
        ? ''
        : ` (${signed(s.vsSameMonthLastYear)} y/y)`),
    `avg ≈ ${s.perHour.toFixed(1)}/h · ${fmt(s.perDay)}/day · ${fmt(s.perWeek)}/week`,
    `last 3 mo ${fmt(s.last3)}` +
      (s.last12 == null
        ? ''
        : ` · 12 mo ${fmt(s.last12)}` +
          (s.yearOverYear == null ? '' : ` (${signed(s.yearOverYear)})`)),
    `tankers ${s.tankerShare}% · >200 m ${s.over200mShare}%` +
      (s.naval == null ? '' : ` · naval ${s.naval}`),
    `Official monthly totals · UAB · through ${monthLabel(s.latestMonth)}`,
  ];
  return lines.join('\n');
}
