/**
 * Catalog endpoints, frame origins and caps for the Europe and Turkey CCTV
 * packs (sourcesEurope.js / sourcesTurkey.js). Every frame URL is synthesized
 * from a validated id onto one of these fixed origins, so no upstream field
 * can steer the frame proxy off-host.
 *
 * Default caps are deliberately small: CCTV loading cost grows with the total
 * camera count (see cctv/presentation.js uiState), so the Europe packs add a
 * sample per country; raise with CCTV_<PACK>_MAX_SOURCES. Turkey loads in full.
 */

// ── Spain: DGT national roads (NAP, DATEX II v3.7) ─────────────────────
export const DGT_CAMERAS_URL =
  'https://nap.dgt.es/datex2/v3/dgt/DevicePublication/camaras_datex2_v37.xml';
export const DGT_IMAGE_ORIGIN = 'https://etraffic.dgt.es/camarasEtraffic/';
export const DEFAULT_DGT_MAX_SOURCES = 120;
export const DGT_CATALOG_MAX_BYTES = 12 * 1024 * 1024;
export const SPAIN_ANCHORS = [
  { lat: 40.4168, lon: -3.7038 }, // Madrid
  { lat: 37.3891, lon: -5.9845 }, // Seville
  { lat: 39.4699, lon: -0.3763 }, // Valencia
  { lat: 41.6488, lon: -0.8891 }, // Zaragoza
  { lat: 36.7213, lon: -4.4214 }, // Málaga
  { lat: 43.3623, lon: -8.4115 }, // A Coruña
];

// ── Madrid city (datos.madrid.es 202088) + Calle 30 (212166) ───────────
// datos.madrid.es dataset 202088 redirects (via its /dataset/ page) to this
// file on the city's own traffic host; fetch it directly, redirects refused.
export const MADRID_CAMERAS_KML_URL =
  'https://informo.madrid.es/informo/tmadrid/CCTV.kml';
export const MADRID_IMAGE_ORIGIN = 'https://informo.madrid.es/cameras/';
// Dataset 212166 resolves to this file on the Calle 30 operator's host.
export const MADRID_M30_CAMERAS_URL = 'https://mc30.es/xml-data/camaras.xml';
export const MADRID_M30_IMAGE_ORIGIN =
  'https://mc30.es/xml-data/imagenes_camaras/'; // www. 301s here, cross-host
export const DEFAULT_MADRID_MAX_SOURCES = 120;
export const MADRID_CENTER = [{ lat: 40.4168, lon: -3.7038 }];

// ── Norway: Statens vegvesen public WFS (NLOD) ─────────────────────────
export const NORWAY_CCTV_WFS_URL =
  'https://ogckart-sn1.atlas.vegvesen.no/datex_3_1/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=datex_3_1:CctvSimple_v2&outputFormat=application/json&srsName=EPSG:4326';
export const NORWAY_IMAGE_ORIGIN =
  'https://kamera.atlas.vegvesen.no/api/images/';
export const DEFAULT_NORWAY_MAX_SOURCES = 100;
export const NORWAY_ANCHORS = [
  { lat: 59.9139, lon: 10.7522 }, // Oslo
  { lat: 60.3913, lon: 5.3221 }, // Bergen
  { lat: 63.4305, lon: 10.3951 }, // Trondheim
  { lat: 58.97, lon: 5.7331 }, // Stavanger
  { lat: 69.6492, lon: 18.9553 }, // Tromsø
];

// ── Iceland: Vegagerðin web cameras ────────────────────────────────────
export const ICELAND_CAMERAS_URL =
  'https://gagnaveita.vegagerdin.is/api/vefmyndavelar2014_1';
export const ICELAND_IMAGE_ORIGIN =
  'https://www.vegagerdin.is/vgdata/vefmyndavelar/';
export const DEFAULT_ICELAND_MAX_SOURCES = 60;
export const ICELAND_ANCHORS = [
  { lat: 64.1466, lon: -21.9426 }, // Reykjavík
  { lat: 65.6885, lon: -18.1262 }, // Akureyri
  { lat: 65.2653, lon: -14.3948 }, // Egilsstaðir
];

// ── Luxembourg: CITA motorway cameras (data.public.lu, CC0) ────────────
export const CITA_CAMERAS_KML_URL = 'https://www.cita.lu/kml/cameras.kml';
export const CITA_IMAGE_ORIGIN =
  'https://www.cita.lu/info_trafic/cameras/images/';
export const DEFAULT_CITA_MAX_SOURCES = 40;
export const LUXEMBOURG_CENTER = [{ lat: 49.6116, lon: 6.1319 }];

// ── Istanbul: İBB Ulaşım Yönetim Merkezi (public HLS) ─────────────────
export const IBB_CAMERAS_URL =
  'https://tkmservices.ibb.gov.tr/web/api/IntensityMap/v1/Camera';
export const IBB_HLS_ORIGIN = 'https://hls.ibb.gov.tr';
export const DEFAULT_IBB_MAX_SOURCES = 300;
export const ISTANBUL_ANCHORS = [
  { lat: 41.0082, lon: 28.9784 }, // Fatih / historic peninsula
  { lat: 41.0369, lon: 28.985 }, // Beyoğlu / Şişli
  { lat: 40.9906, lon: 29.0253 }, // Kadıköy
];

// ── İzmir: İZUM (İzmir Ulaşım Merkezi) MJPEG cameras ───────────────────
export const IZUM_CAMERAS_URL =
  'https://izum.izmir.bel.tr/v1/workspaces/cameras';
export const IZUM_MJPEG_ORIGIN = 'https://izum-cams.izmir.bel.tr';
export const DEFAULT_IZUM_MAX_SOURCES = 120;
export const IZMIR_CENTER = [{ lat: 38.4237, lon: 27.1428 }];
/** One MJPEG part is ~10-30 KB at 240x180; never buffer more than this. */
export const MJPEG_STILL_MAX_BYTES = 1024 * 1024;
