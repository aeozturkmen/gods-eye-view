/**
 * GNSS interference estimate from ADS-B navigation accuracy (the gpsjam.org
 * idea, reimplemented): aircraft broadcast NACp, their own position-accuracy
 * category. When GPS is jammed or spoofed, NACp collapses. Share of aircraft
 * per grid cell reporting NACp < 8 (worse than ~93 m) over a rolling window
 * is a usable, honest proxy — never proof of jamming at a point.
 *
 * Source: adsb.lol /v2/point (ODbL). Polled one anchor at a time, round
 * robin, and ONLY while a browser has asked for the layer in the last few
 * minutes — nothing runs in the background otherwise. Memory only: the
 * window restarts with the server, and the response says since when.
 */

const ADSB_LOL_POINT = 'https://api.adsb.lol/v2/point';
/** Eastern Mediterranean, Aegean, Anatolia, Levant (lat, lon, radius nm). */
export const GNSS_ANCHORS = Object.freeze([
  Object.freeze([41.0, 29.0, 250]),
  Object.freeze([38.5, 27.0, 250]),
  Object.freeze([38.5, 33.0, 250]),
  Object.freeze([35.0, 33.0, 250]),
  Object.freeze([37.0, 37.5, 250]),
]);
export const GNSS_CELL_DEG = 0.5;
/** NACp below this counts as degraded (NACp 8 = EPU < 0.05 NM ≈ 93 m). */
export const GNSS_BAD_NACP = 8;
/** Cells need this many distinct aircraft before they are shown. */
export const GNSS_MIN_AIRCRAFT = 5;
const HOUR = 3_600_000;
const WINDOW_HOURS = 24;
const POLL_GAP_MS = 12_000; // one anchor per 12 s → each anchor once a minute
const WATCH_MS = 5 * 60_000;
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * Is this aircraft record usable evidence? Only direct ADS-B from a DO-260A+
 * transponder carries a meaningful NACp; MLAT/TIS-B positions and ground
 * traffic say nothing about onboard GNSS.
 */
export function gnssEvidence(ac) {
  if (!ac || ac.type !== 'adsb_icao') return null;
  if (!(Number(ac.version) >= 1)) return null;
  const nacp = Number(ac.nac_p);
  const lat = Number(ac.lat);
  const lon = Number(ac.lon);
  if (![nacp, lat, lon].every(Number.isFinite)) return null;
  if (ac.alt_baro === 'ground') return null;
  if (Number(ac.seen_pos) > 30) return null;
  const hex = typeof ac.hex === 'string' ? ac.hex.toLowerCase() : null;
  if (!hex || !/^[0-9a-f]{6}$/.test(hex)) return null;
  return { hex, lat, lon, bad: nacp < GNSS_BAD_NACP };
}

export function gnssCellKey(lat, lon) {
  return `${Math.floor(lat / GNSS_CELL_DEG)}:${Math.floor(lon / GNSS_CELL_DEG)}`;
}

/** Rolling per-hour aggregation of distinct aircraft per cell. */
export function createGnssAggregator({ now = () => Date.now() } = {}) {
  /** @type {Map<number, Map<string, {good:Set<string>, bad:Set<string>}>>} */
  const hours = new Map();
  const startedAt = now();
  const prune = () => {
    const oldest = Math.floor(now() / HOUR) - WINDOW_HOURS;
    for (const hour of hours.keys()) if (hour <= oldest) hours.delete(hour);
  };
  return {
    add(aircraft) {
      const hour = Math.floor(now() / HOUR);
      let cells = hours.get(hour);
      if (!cells) hours.set(hour, (cells = new Map()));
      let added = 0;
      for (const ac of aircraft) {
        const evidence = gnssEvidence(ac);
        if (!evidence) continue;
        const key = gnssCellKey(evidence.lat, evidence.lon);
        let cell = cells.get(key);
        if (!cell) cells.set(key, (cell = { good: new Set(), bad: new Set() }));
        (evidence.bad ? cell.bad : cell.good).add(evidence.hex);
        added++;
      }
      prune();
      return added;
    },
    snapshot(windowHours = WINDOW_HOURS) {
      prune();
      const from =
        Math.floor(now() / HOUR) - Math.min(windowHours, WINDOW_HOURS);
      const merged = new Map();
      for (const [hour, cells] of hours) {
        if (hour <= from) continue;
        for (const [key, cell] of cells) {
          let into = merged.get(key);
          if (!into)
            merged.set(key, (into = { good: new Set(), bad: new Set() }));
          for (const hex of cell.good) into.good.add(hex);
          for (const hex of cell.bad) into.bad.add(hex);
        }
      }
      const cells = [];
      for (const [key, { good, bad }] of merged) {
        // An aircraft seen both ways in the window counts once, as degraded.
        let clean = 0;
        for (const hex of good) if (!bad.has(hex)) clean++;
        const total = clean + bad.size;
        if (total < GNSS_MIN_AIRCRAFT) continue;
        const [y, x] = key.split(':').map(Number);
        cells.push({
          south: y * GNSS_CELL_DEG,
          west: x * GNSS_CELL_DEG,
          north: (y + 1) * GNSS_CELL_DEG,
          east: (x + 1) * GNSS_CELL_DEG,
          aircraft: total,
          degraded: bad.size,
          ratio: bad.size / total,
        });
      }
      return { cells, observingSince: new Date(startedAt).toISOString() };
    },
  };
}

/** Vite plugin: GET /api/gnss-interference. */
export function gnssInterferenceProxy({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  anchors = GNSS_ANCHORS,
  pollGapMs = POLL_GAP_MS,
  timers = { setTimeout, clearTimeout },
} = {}) {
  const aggregator = createGnssAggregator({ now });
  let watchedAt = -Infinity;
  let timer = null;
  let next = 0;
  let cooldownUntil = 0;
  let lastPollAt = null;
  let lastError = null;
  let disposed = false;

  async function pollOnce() {
    const [lat, lon, radius] = anchors[next];
    next = (next + 1) % anchors.length;
    const controller = new AbortController();
    const abort = timers.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetchImpl(
        `${ADSB_LOL_POINT}/${lat}/${lon}/${radius}`,
        {
          signal: controller.signal,
          redirect: 'error',
          headers: {
            Accept: 'application/json',
            'User-Agent': 'gods-eye-view-local (gnss interference layer)',
          },
        },
      );
      if (response.status === 429 || response.status >= 500) {
        cooldownUntil = now() + (response.status === 429 ? 120_000 : 30_000);
        throw new Error(`adsb.lol HTTP ${response.status}`);
      }
      if (!response.ok) throw new Error(`adsb.lol HTTP ${response.status}`);
      const length = Number(response.headers.get('content-length'));
      if (length > MAX_BYTES) throw new Error('adsb.lol response too large');
      const text = await response.text();
      if (text.length > MAX_BYTES)
        throw new Error('adsb.lol response too large');
      const body = JSON.parse(text);
      aggregator.add(Array.isArray(body?.ac) ? body.ac : []);
      lastPollAt = now();
      lastError = null;
    } finally {
      timers.clearTimeout(abort);
    }
  }

  /** One poll loop at most; it stops by itself once nobody is watching. */
  let loopActive = false;
  function startLoop() {
    if (loopActive || disposed) return;
    loopActive = true;
    const tick = async () => {
      timer = null;
      if (disposed || now() - watchedAt > WATCH_MS) {
        loopActive = false; // nobody watching: stop polling adsb.lol
        return;
      }
      if (now() >= cooldownUntil) {
        try {
          await pollOnce();
        } catch (error) {
          lastError = error?.message || 'adsb.lol unavailable';
        }
      }
      if (disposed) {
        loopActive = false;
        return;
      }
      timer = timers.setTimeout(tick, pollGapMs);
      timer.unref?.();
    };
    // First anchor promptly, then one every gap.
    timer = timers.setTimeout(tick, 0);
    timer.unref?.();
  }

  function handler(req, res) {
    if (req.method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'method_not_allowed' }));
      return;
    }
    const url = new URL(req.url || '/', 'http://localhost');
    const windowHours = Math.max(
      1,
      Math.min(
        WINDOW_HOURS,
        Number.parseInt(url.searchParams.get('hours'), 10) || WINDOW_HOURS,
      ),
    );
    watchedAt = now();
    startLoop();
    const { cells, observingSince } = aggregator.snapshot(windowHours);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(
      JSON.stringify({
        schemaVersion: 1,
        source: 'adsb.lol',
        attribution: 'ADS-B data: adsb.lol (ODbL 1.0)',
        method: `Share of distinct ADS-B v1+ aircraft per ${GNSS_CELL_DEG}° cell reporting NACp < ${GNSS_BAD_NACP}; cells need ${GNSS_MIN_AIRCRAFT}+ aircraft.`,
        windowHours,
        observingSince,
        lastPollAt: lastPollAt ? new Date(lastPollAt).toISOString() : null,
        error: lastError,
        cells,
      }),
    );
  }

  const dispose = () => {
    disposed = true;
    loopActive = false;
    if (timer) timers.clearTimeout(timer);
    timer = null;
  };
  return {
    name: 'gnss-interference',
    configureServer(server) {
      disposed = false;
      server.middlewares.use('/api/gnss-interference', handler);
      server.httpServer?.on('close', dispose);
    },
    configurePreviewServer(server) {
      disposed = false;
      server.middlewares.use('/api/gnss-interference', handler);
      server.httpServer?.on('close', dispose);
    },
    _handler: handler,
    _dispose: dispose,
  };
}
