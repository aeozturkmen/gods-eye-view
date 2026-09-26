import { CCTV_SOURCE_FETCH_TIMEOUT_MS } from './constants.js';
import {
  fallbackHeadingFromId,
  isPlausibleLatLon,
  prioritizeSources,
  toFiniteNumber,
} from './normalize.js';
import { readCappedResponseText } from '../common/http.js';

/**
 * Download one catalog as text: keyless GET, no redirects, bounded time and
 * bytes. Returns null (and logs) on any failure so each pack fails alone.
 *
 * @param {string} url
 * @param {{label: string, accept?: string, maxBytes?: number}} options
 * @returns {Promise<string|null>}
 */
export async function fetchCatalogText(
  url,
  { label, accept = '*/*', maxBytes = 4 * 1024 * 1024 },
) {
  try {
    const resp = await fetch(url, {
      headers: {
        Accept: accept,
        'User-Agent': 'gods-eye-view-cctv-catalog/1.0',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(CCTV_SOURCE_FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) {
      console.warn(`[CCTV] ${label} catalog download failed:`, resp.status);
      try {
        await resp.body?.cancel();
      } catch {
        /* no-op */
      }
      return null;
    }
    const { tooLarge, text } = await readCappedResponseText(resp, maxBytes);
    if (tooLarge) {
      console.warn(`[CCTV] ${label} catalog exceeded ${maxBytes} bytes`);
      return null;
    }
    return text;
  } catch (error) {
    console.warn(
      `[CCTV] ${label} catalog download error:`,
      error?.message || error,
    );
    return null;
  }
}

/** Decode the five XML entities plus numeric references. */
export function decodeXmlText(value) {
  return String(value ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

/** First `<tag>` text inside `xml` (namespace prefix optional), decoded. */
export function xmlTag(xml, tag) {
  const pattern = new RegExp(
    `<(?:[A-Za-z0-9_]+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:[A-Za-z0-9_]+:)?${tag}>`,
  );
  const match = pattern.exec(xml);
  return match ? decodeXmlText(match[1]) : '';
}

/** Split `xml` into the raw inner text of every `<tag ...>...</tag>` block. */
export function xmlBlocks(xml, tag) {
  const pattern = new RegExp(
    `<(?:[A-Za-z0-9_]+:)?${tag}\\b([^>]*)>([\\s\\S]*?)</(?:[A-Za-z0-9_]+:)?${tag}>`,
    'g',
  );
  const blocks = [];
  let match;
  while ((match = pattern.exec(xml))) blocks.push({ attrs: match[1], body: match[2] });
  return blocks;
}

/** Title-case an ALL-CAPS upstream label ("PLAZA DE CASTILLA" → "Plaza De Castilla"). */
export function titleCase(value, locale = 'en') {
  const text = String(value || '').trim();
  // Turkish casing (I→ı) only for genuinely Turkish text: ASCII-fied labels
  // like "TEPECIK KAVSAGI" mean i, and would read "Tepecık Kavsagı".
  if (locale === 'tr' && !/[İŞĞÜÖÇ]/.test(text)) locale = 'en';
  if (!text || text !== text.toLocaleUpperCase(locale)) return text;
  return text
    .toLocaleLowerCase(locale)
    .replace(
      /(^|[\s(/.-])(\p{L})/gu,
      (_, lead, letter) => lead + letter.toLocaleUpperCase(locale),
    );
}

/**
 * One still-image camera with the shared headingless personality (identical to
 * the TfL/Fintraffic priors): the client ground-snap and calibration gizmo own
 * the true pose.
 */
export function stillImageCamera({
  id,
  name,
  city,
  cityId,
  provider,
  lat,
  lon,
  url,
  sourceKind,
  license,
  groundElevationM = 50,
  feedType = 'image',
}) {
  return {
    id,
    name,
    city,
    cityId,
    provider,
    lat,
    lon,
    headingDeg: fallbackHeadingFromId(id),
    headingConfidence: 'low',
    pitchDeg: -18,
    fovDeg: 44,
    rangeM: 145,
    mountHeightM: 8,
    groundElevationM,
    feedType,
    url,
    snapshotUrl: feedType === 'image' ? url : '',
    sourceKind,
    license,
  };
}

/** Coordinates that are finite, plausible and inside a lat/lon box. */
export function inBox(lat, lon, [south, west, north, east]) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    isPlausibleLatLon(lat, lon) &&
    lat >= south &&
    lat <= north &&
    lon >= west &&
    lon <= east
  );
}

/** Env kill switch, cap parse, dedupe, anchor-prioritize and log, in one place. */
export function finishPack(cameras, { label, maxEnv, defaultMax, ceiling, anchors }) {
  const unique = Array.from(
    new Map(cameras.map((camera) => [camera.id, camera])).values(),
  );
  const maxRaw = Number(process.env[maxEnv] || defaultMax);
  const maxCount = Number.isFinite(maxRaw)
    ? Math.max(8, Math.min(ceiling, Math.floor(maxRaw)))
    : defaultMax;
  const prioritized = prioritizeSources(unique, maxCount, anchors);
  console.log(
    `[CCTV] Loaded ${label} camera sources: ${unique.length} (using nearest ${prioritized.length})`,
  );
  return prioritized;
}

export { toFiniteNumber };
