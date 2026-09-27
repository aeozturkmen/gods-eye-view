import {
  IBB_CAMERAS_URL,
  IBB_HLS_ORIGIN,
  DEFAULT_IBB_MAX_SOURCES,
  ISTANBUL_ANCHORS,
  IZUM_CAMERAS_URL,
  IZUM_MJPEG_ORIGIN,
  DEFAULT_IZUM_MAX_SOURCES,
  IZMIR_CENTER,
} from './regionalConstants.js';
import {
  fetchCatalogText,
  titleCase,
  stillImageCamera,
  inBox,
  finishPack,
  toFiniteNumber,
} from './regionalCommon.js';

const ISTANBUL_BOX = [40.75, 27.95, 41.6, 29.95];
const IZMIR_BOX = [37.8, 26.2, 39.4, 28.5];

/**
 * Istanbul: İBB Ulaşım Yönetim Merkezi public camera list (the same endpoint
 * İBB's own traffic map uses; keyless). Live video only: the `Images` still
 * handler currently answers one "no camera" placeholder for every camera, so
 * cameras register as HTTPS HLS on hls.ibb.gov.tr, which the bounded Node
 * puller (stream.js) relays like DelDOT. Nested `Group` cameras are included.
 *
 * This pack only ever reads IntensityMap/v1/Camera.
 */
export function parseIbbCameras(rows) {
  const cameras = [];
  const visit = (row) => {
    if (!row || typeof row !== 'object') return;
    for (const child of Array.isArray(row.Group) ? row.Group : []) visit(child);
    const id = String(row.ID ?? '').trim();
    if (!/^\d{1,6}$/.test(id)) return;
    let stream;
    try {
      stream = new URL(String(row.VideoURL_SSL || row.VideoURL || ''));
    } catch {
      return;
    }
    if (
      stream.origin !== IBB_HLS_ORIGIN ||
      stream.username ||
      stream.password ||
      stream.search ||
      !/^\/tkm\d{1,2}\/hls\/\d{1,6}\.stream\/playlist\.m3u8$/.test(
        stream.pathname,
      )
    )
      return;
    // Coordinates arrive as strings, X = longitude, Y = latitude.
    const lon = toFiniteNumber(row.XCoord);
    const lat = toFiniteNumber(row.YCoord);
    if (!inBox(lat, lon, ISTANBUL_BOX)) return;
    cameras.push(
      stillImageCamera({
        id: `tr-ibb-${id}`,
        name: titleCase(String(row.Name || '').trim(), 'tr') || `İBB ${id}`,
        city: 'İstanbul',
        cityId: 'istanbul',
        provider: 'İBB UYM',
        lat,
        lon,
        url: `${IBB_HLS_ORIGIN}${stream.pathname}`,
        sourceKind: 'ibb-uym',
        license:
          'İBB Ulaşım Yönetim Merkezi (public stream, no stated reuse licence)',
        groundElevationM: 60,
        feedType: 'hls',
      }),
    );
  };
  for (const row of Array.isArray(rows) ? rows : []) visit(row);
  return cameras;
}

export async function loadIbbSourcesFromUym() {
  const text = await fetchCatalogText(IBB_CAMERAS_URL, {
    label: 'İBB Istanbul',
    accept: 'application/json',
  });
  if (!text) return [];
  let rows;
  try {
    rows = JSON.parse(text);
  } catch {
    console.warn('[CCTV] İBB Istanbul catalog was not JSON');
    return [];
  }
  return finishPack(parseIbbCameras(rows), {
    label: 'İBB Istanbul',
    maxEnv: 'CCTV_IBB_MAX_SOURCES',
    defaultMax: DEFAULT_IBB_MAX_SOURCES,
    ceiling: 700,
    anchors: ISTANBUL_ANCHORS,
  });
}

/**
 * İzmir: İZUM (İzmir Ulaşım Merkezi) camera list. Frames come from the live
 * MJPEG stream on izum-cams.izmir.bel.tr: the frame proxy reads the first JPEG
 * part and disconnects (media.js). The catalog's `snapshotUrl` stills are
 * stale (2023), so they are not used. Camera list data: İzmir Büyükşehir
 * Belediyesi Açık Veri Portalı, CC BY 4.0.
 */
export function parseIzumCameras(rows) {
  const cameras = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const ufid = String(row?.ufid || '').trim();
    if (!/^[A-Za-z0-9-]{3,40}$/.test(ufid)) continue;
    let stream;
    try {
      stream = new URL(String(row?.mjpegStreamUrl || ''));
    } catch {
      continue;
    }
    const uuid =
      /^\/mjpeg\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(
        stream.pathname,
      )?.[1];
    if (stream.origin !== IZUM_MJPEG_ORIGIN || stream.search || !uuid) continue;
    const lat = toFiniteNumber(row?.lat);
    const lon = toFiniteNumber(row?.lng);
    if (!inBox(lat, lon, IZMIR_BOX)) continue;
    cameras.push(
      stillImageCamera({
        id: `tr-izum-${ufid.toLowerCase()}`,
        name: titleCase(String(row?.name || '').trim(), 'tr') || ufid,
        city: 'İzmir',
        cityId: 'izmir',
        provider: 'İZUM',
        lat,
        lon,
        url: `${IZUM_MJPEG_ORIGIN}/mjpeg/${uuid.toLowerCase()}`,
        sourceKind: 'izum-mjpeg',
        license: 'İzmir Büyükşehir Belediyesi Açık Veri (CC BY 4.0)',
        groundElevationM: 30,
      }),
    );
  }
  return cameras;
}

export async function loadIzumSourcesFromOpenData() {
  const text = await fetchCatalogText(IZUM_CAMERAS_URL, {
    label: 'İZUM İzmir',
    accept: 'application/json',
  });
  if (!text) return [];
  let rows;
  try {
    rows = JSON.parse(text);
  } catch {
    console.warn('[CCTV] İZUM İzmir catalog was not JSON');
    return [];
  }
  return finishPack(parseIzumCameras(rows), {
    label: 'İZUM İzmir',
    maxEnv: 'CCTV_IZUM_MAX_SOURCES',
    defaultMax: DEFAULT_IZUM_MAX_SOURCES,
    ceiling: 200,
    anchors: IZMIR_CENTER,
  });
}
