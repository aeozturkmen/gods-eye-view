import {
  DGT_CAMERAS_URL,
  DGT_IMAGE_ORIGIN,
  DEFAULT_DGT_MAX_SOURCES,
  DGT_CATALOG_MAX_BYTES,
  SPAIN_ANCHORS,
  MADRID_CAMERAS_KML_URL,
  MADRID_IMAGE_ORIGIN,
  MADRID_M30_CAMERAS_URL,
  MADRID_M30_IMAGE_ORIGIN,
  DEFAULT_MADRID_MAX_SOURCES,
  MADRID_CENTER,
  NORWAY_CCTV_WFS_URL,
  NORWAY_IMAGE_ORIGIN,
  DEFAULT_NORWAY_MAX_SOURCES,
  NORWAY_ANCHORS,
  ICELAND_CAMERAS_URL,
  ICELAND_IMAGE_ORIGIN,
  DEFAULT_ICELAND_MAX_SOURCES,
  ICELAND_ANCHORS,
  CITA_CAMERAS_KML_URL,
  CITA_IMAGE_ORIGIN,
  DEFAULT_CITA_MAX_SOURCES,
  LUXEMBOURG_CENTER,
} from './regionalConstants.js';
import {
  fetchCatalogText,
  xmlBlocks,
  xmlTag,
  titleCase,
  stillImageCamera,
  inBox,
  finishPack,
  toFiniteNumber,
} from './regionalCommon.js';

// Coarse national boxes: a bad upstream coordinate can't place a camera abroad.
const SPAIN_BOX = [27.5, -18.5, 44.0, 4.6]; // incl. Canaries / Balearics
const MADRID_BOX = [40.25, -3.9, 40.6, -3.5];
const NORWAY_BOX = [57.8, 4.3, 71.3, 31.3];
const ICELAND_BOX = [63.2, -24.6, 66.7, -13.3];
const LUXEMBOURG_BOX = [49.4, 5.7, 50.2, 6.6];

/**
 * Spain national roads: DGT DATEX II v3.7 DevicePublication (NAP dataset
 * camaras-dgt-datex2-v3-7, CC BY). One `<device id>` is one camera; the frame
 * is `<origin><id>.jpg`, synthesized from the numeric id. Excludes the Basque
 * Country and Catalonia, which DGT does not operate.
 */
export function parseDgtDevices(xml) {
  const cameras = [];
  for (const { attrs, body } of xmlBlocks(xml, 'device')) {
    const id = /\bid="(\d{1,9})"/.exec(attrs)?.[1];
    if (!id) continue;
    if (xmlTag(body, 'typeOfDevice') && xmlTag(body, 'typeOfDevice') !== 'camera')
      continue;
    const lat = toFiniteNumber(xmlTag(body, 'latitude'));
    const lon = toFiniteNumber(xmlTag(body, 'longitude'));
    if (!inBox(lat, lon, SPAIN_BOX)) continue;
    const road = xmlTag(body, 'roadName');
    const km = xmlTag(body, 'kilometerPoint');
    const toward = titleCase(xmlTag(body, 'roadDestination'));
    const province = titleCase(xmlTag(body, 'province'));
    const name =
      [road, km ? `km ${km}` : '', toward ? `→ ${toward}` : '']
        .filter(Boolean)
        .join(' ') || `DGT ${id}`;
    const cameraId = `es-dgt-${id}`;
    cameras.push(
      stillImageCamera({
        id: cameraId,
        name,
        city: province || 'Spain',
        cityId: 'spain-dgt',
        provider: 'DGT',
        lat,
        lon,
        url: `${DGT_IMAGE_ORIGIN}${id}.jpg`,
        sourceKind: 'dgt-nap-datex2',
        license: 'Dirección General de Tráfico (DGT), CC BY',
        groundElevationM: 600,
      }),
    );
  }
  return cameras;
}

export async function loadDgtSourcesFromNap() {
  const xml = await fetchCatalogText(DGT_CAMERAS_URL, {
    label: 'DGT Spain',
    accept: 'application/xml, text/xml',
    maxBytes: DGT_CATALOG_MAX_BYTES,
  });
  if (!xml) return [];
  return finishPack(parseDgtDevices(xml), {
    label: 'DGT Spain',
    maxEnv: 'CCTV_DGT_MAX_SOURCES',
    defaultMax: DEFAULT_DGT_MAX_SOURCES,
    ceiling: 2000,
    anchors: SPAIN_ANCHORS,
  });
}

/**
 * Madrid city traffic cameras (datos.madrid.es 202088, KML, CC BY 4.0) plus
 * the Calle 30 ring-road cameras (212166, XML, CC BY). City frames are
 * `Camara<Numero>.jpg`; M-30 frames are `<Nombre>.jpg` on mc30.es.
 */
export function parseMadridKml(kml) {
  const cameras = [];
  for (const { body } of xmlBlocks(kml, 'Placemark')) {
    const numero = /<Data name="Numero">\s*<Value>([^<]*)<\/Value>/.exec(body)?.[1]?.trim();
    if (!numero || !/^\d{3,6}$/.test(numero)) continue;
    const nombre = /<Data name="Nombre">\s*<Value>([^<]*)<\/Value>/.exec(body)?.[1];
    const coords = xmlTag(body, 'coordinates').split(',');
    const lon = toFiniteNumber(coords[0]);
    const lat = toFiniteNumber(coords[1]);
    if (!inBox(lat, lon, MADRID_BOX)) continue;
    cameras.push(
      stillImageCamera({
        id: `es-madrid-${numero}`,
        name: titleCase(nombre ? nombre.trim() : `Madrid ${numero}`),
        city: 'Madrid',
        cityId: 'madrid',
        provider: 'Ayuntamiento de Madrid',
        lat,
        lon,
        url: `${MADRID_IMAGE_ORIGIN}Camara${numero}.jpg`,
        sourceKind: 'madrid-open-data',
        license: 'Ayuntamiento de Madrid (CC BY 4.0)',
        groundElevationM: 650,
      }),
    );
  }
  return cameras;
}

export function parseMadridM30Xml(xml) {
  const cameras = [];
  for (const { body } of xmlBlocks(xml, 'Camara')) {
    const nombre = xmlTag(body, 'Nombre');
    // Ids like 09NC39TV01 or M30-PK10+900C(M.ALVARO); also the frame file name.
    if (!/^[A-Za-z0-9+().-]{4,60}$/.test(nombre)) continue;
    const lat = toFiniteNumber(xmlTag(body, 'Latitud'));
    const lon = toFiniteNumber(xmlTag(body, 'Longitud'));
    if (!inBox(lat, lon, MADRID_BOX)) continue;
    cameras.push(
      stillImageCamera({
        id: `es-m30-${nombre.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`,
        name: nombre.startsWith('M30-') ? nombre.replace(/^M30-/, 'M-30 ') : `M-30 ${nombre}`,
        city: 'Madrid',
        cityId: 'madrid',
        provider: 'Madrid Calle 30',
        lat,
        lon,
        url: `${MADRID_M30_IMAGE_ORIGIN}${encodeURIComponent(nombre)}.jpg`,
        sourceKind: 'madrid-m30-open-data',
        license: 'Ayuntamiento de Madrid / Madrid Calle 30 (CC BY)',
        groundElevationM: 600,
      }),
    );
  }
  return cameras;
}

export async function loadMadridSourcesFromOpenData() {
  const [kml, m30] = await Promise.all([
    fetchCatalogText(MADRID_CAMERAS_KML_URL, {
      label: 'Madrid',
      accept: 'application/vnd.google-earth.kml+xml, application/xml',
    }),
    fetchCatalogText(MADRID_M30_CAMERAS_URL, {
      label: 'Madrid M-30',
      accept: 'application/xml, text/xml',
    }),
  ]);
  const cameras = [
    ...(kml ? parseMadridKml(kml) : []),
    ...(m30 ? parseMadridM30Xml(m30) : []),
  ];
  if (!cameras.length) return [];
  return finishPack(cameras, {
    label: 'Madrid',
    maxEnv: 'CCTV_MADRID_MAX_SOURCES',
    defaultMax: DEFAULT_MADRID_MAX_SOURCES,
    ceiling: 500,
    anchors: MADRID_CENTER,
  });
}

/**
 * Norway: Statens vegvesen's keyless public GeoServer WFS (datex_3_1:
 * CctvSimple_v2, NLOD 2.0). Frames: `<origin><CAMERA_ID>` (JPEG). Cameras
 * reporting a fault are dropped.
 */
export function parseNorwayFeatures(payload) {
  const cameras = [];
  const features = Array.isArray(payload?.features) ? payload.features : [];
  for (const feature of features) {
    const props = feature?.properties || {};
    const cameraIdRaw = String(props.CAMERA_ID || '').trim();
    if (!/^\d{3,12}_\d{1,3}$/.test(cameraIdRaw)) continue;
    if (props.STATUS_STILL_IMAGE_AVAILABILITY !== 'videoOrImagesAvailable')
      continue;
    const lon = toFiniteNumber(feature?.geometry?.coordinates?.[0]);
    const lat = toFiniteNumber(feature?.geometry?.coordinates?.[1]);
    if (!inBox(lat, lon, NORWAY_BOX)) continue;
    const description = String(props.DESCRIPTION || '').trim();
    const road = String(props.ROAD_NUMBER || '').trim();
    const orientation = String(props.ORIENTATION_DESCRIPTION || '').trim();
    const name =
      [road, description, orientation && orientation !== 'ukjent' ? `(${orientation})` : '']
        .filter(Boolean)
        .join(' ') || `Vegvesen ${cameraIdRaw}`;
    cameras.push(
      stillImageCamera({
        id: `no-${cameraIdRaw.toLowerCase()}`,
        name,
        city: 'Norway',
        cityId: 'norway',
        provider: 'Statens vegvesen',
        lat,
        lon,
        url: `${NORWAY_IMAGE_ORIGIN}${cameraIdRaw}`,
        sourceKind: 'vegvesen-wfs',
        license: 'Statens vegvesen (NLOD 2.0)',
        groundElevationM: 150,
      }),
    );
  }
  return cameras;
}

export async function loadNorwaySourcesFromWfs() {
  const text = await fetchCatalogText(NORWAY_CCTV_WFS_URL, {
    label: 'Norway',
    accept: 'application/json',
    maxBytes: 8 * 1024 * 1024,
  });
  if (!text) return [];
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    console.warn('[CCTV] Norway catalog was not JSON');
    return [];
  }
  return finishPack(parseNorwayFeatures(payload), {
    label: 'Norway',
    maxEnv: 'CCTV_NORWAY_MAX_SOURCES',
    defaultMax: DEFAULT_NORWAY_MAX_SOURCES,
    ceiling: 900,
    anchors: NORWAY_ANCHORS,
  });
}

/**
 * Iceland: Vegagerðin web cameras (free licence; "Based on data from
 * Vegagerðin"). One row per view; `Slod` names the frame file, which is also
 * the only stable view id (`Maelist_nr` repeats across a station's views).
 */
export function parseIcelandCameras(rows) {
  const cameras = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    let file;
    try {
      const url = new URL(String(row?.Slod || ''));
      if (`${url.origin}/` !== new URL(ICELAND_IMAGE_ORIGIN).origin + '/')
        continue;
      if (!url.pathname.startsWith(new URL(ICELAND_IMAGE_ORIGIN).pathname))
        continue;
      file = url.pathname.slice(new URL(ICELAND_IMAGE_ORIGIN).pathname.length);
    } catch {
      continue;
    }
    if (!/^[a-z0-9_-]{1,80}\.jpg$/i.test(file)) continue;
    const lat = toFiniteNumber(row?.Breidd);
    const lon = toFiniteNumber(row?.Lengd);
    if (!inBox(lat, lon, ICELAND_BOX)) continue;
    const station = String(row?.Myndavel || '').trim();
    const view = String(row?.Skyring || '').trim();
    cameras.push(
      stillImageCamera({
        id: `is-${file.replace(/\.jpg$/i, '').toLowerCase()}`,
        name: view || station || file,
        city: 'Iceland',
        cityId: 'iceland',
        provider: 'Vegagerðin',
        lat,
        lon,
        url: `${ICELAND_IMAGE_ORIGIN}${file}`,
        sourceKind: 'vegagerdin-open-data',
        license: 'Based on data from Vegagerðin',
        groundElevationM: 150,
      }),
    );
  }
  return cameras;
}

export async function loadIcelandSourcesFromOpenData() {
  const text = await fetchCatalogText(ICELAND_CAMERAS_URL, {
    label: 'Iceland',
    accept: 'application/json',
  });
  if (!text) return [];
  let rows;
  try {
    rows = JSON.parse(text);
  } catch {
    console.warn('[CCTV] Iceland catalog was not JSON');
    return [];
  }
  return finishPack(parseIcelandCameras(rows), {
    label: 'Iceland',
    maxEnv: 'CCTV_ICELAND_MAX_SOURCES',
    defaultMax: DEFAULT_ICELAND_MAX_SOURCES,
    ceiling: 500,
    anchors: ICELAND_ANCHORS,
  });
}

/**
 * Luxembourg: CITA motorway cameras (data.public.lu, CC0). The KML carries an
 * iframe per `camera_<n>` placemark; the still behind it is
 * `cccam_<n>.jpg` on the same host.
 */
export function parseCitaKml(kml) {
  const cameras = [];
  for (const { attrs, body } of xmlBlocks(kml, 'Placemark')) {
    const n = /\bid="camera_(\d{1,6})"/.exec(attrs)?.[1];
    if (!n) continue;
    const coords = xmlTag(body, 'coordinates').split(',');
    const lon = toFiniteNumber(coords[0]);
    const lat = toFiniteNumber(coords[1]);
    if (!inBox(lat, lon, LUXEMBOURG_BOX)) continue;
    cameras.push(
      stillImageCamera({
        id: `lu-cita-${n}`,
        name: xmlTag(body, 'name') || `CITA ${n}`,
        city: 'Luxembourg',
        cityId: 'luxembourg',
        provider: 'CITA',
        lat,
        lon,
        url: `${CITA_IMAGE_ORIGIN}cccam_${n}.jpg`,
        sourceKind: 'cita-open-data',
        license: 'CITA / data.public.lu (CC0)',
        groundElevationM: 300,
      }),
    );
  }
  return cameras;
}

export async function loadCitaSourcesFromKml() {
  const kml = await fetchCatalogText(CITA_CAMERAS_KML_URL, {
    label: 'Luxembourg CITA',
    accept: 'application/vnd.google-earth.kml+xml, application/xml',
  });
  if (!kml) return [];
  return finishPack(parseCitaKml(kml), {
    label: 'Luxembourg CITA',
    maxEnv: 'CCTV_CITA_MAX_SOURCES',
    defaultMax: DEFAULT_CITA_MAX_SOURCES,
    ceiling: 200,
    anchors: LUXEMBOURG_CENTER,
  });
}
