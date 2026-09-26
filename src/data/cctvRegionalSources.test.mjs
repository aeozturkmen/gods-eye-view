import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDgtDevices,
  parseMadridKml,
  parseMadridM30Xml,
  parseNorwayFeatures,
  parseIcelandCameras,
  parseCitaKml,
} from '../../server/providers/cctv/sourcesEurope.js';
import {
  parseIbbCameras,
  parseIzumCameras,
} from '../../server/providers/cctv/sourcesTurkey.js';
import { titleCase } from '../../server/providers/cctv/regionalCommon.js';
import { readFirstMjpegFrame } from '../../server/providers/cctv/media.js';

const dgtDevice = (id, lat, lon, extra = '') => `
  <ns2:device xsi:type="fse:ExtendedDevice" id="${id}" version="2">
    <ns2:typeOfDevice>camera</ns2:typeOfDevice>
    <loc:roadDestination>BURGOS</loc:roadDestination><loc:roadName>A-62</loc:roadName>
    <loc:latitude>${lat}</loc:latitude><loc:longitude>${lon}</loc:longitude>
    <lse:kilometerPoint>25.3</lse:kilometerPoint><lse:province>BURGOS</lse:province>
    ${extra}
    <fse:deviceUrl>https://evil.example/steal.jpg</fse:deviceUrl>
  </ns2:device>`;

test('DGT: frame URL is synthesized from the numeric id, never the payload URL', () => {
  const cams = parseDgtDevices(
    dgtDevice('176130', 42.2624, -3.9403) +
      dgtDevice('../x', 42.2, -3.9) +
      dgtDevice('9', 51.5, -0.1), // London: outside Spain
  );
  assert.equal(cams.length, 1);
  assert.equal(cams[0].id, 'es-dgt-176130');
  assert.equal(cams[0].url, 'https://etraffic.dgt.es/camarasEtraffic/176130.jpg');
  assert.equal(cams[0].name, 'A-62 km 25.3 → Burgos');
  assert.equal(cams[0].city, 'Burgos');
  assert.equal(cams[0].feedType, 'image');
});

test('Madrid: city KML and Calle 30 XML, with encoded M-30 file names', () => {
  const kml = `<kml><Placemark>
    <ExtendedData><Data name="Numero"><Value>06303</Value></Data>
    <Data name="Nombre"><Value>PLAZA DE CASTILLA (NORTE)</Value></Data></ExtendedData>
    <Point><coordinates>-3.6889,40.4660,10 </coordinates></Point></Placemark>
    <Placemark><ExtendedData><Data name="Numero"><Value>x/../1</Value></Data></ExtendedData>
    <Point><coordinates>-3.6,40.4,0</coordinates></Point></Placemark></kml>`;
  const city = parseMadridKml(kml);
  assert.equal(city.length, 1);
  assert.equal(city[0].url, 'https://informo.madrid.es/cameras/Camara06303.jpg');
  assert.equal(city[0].name, 'Plaza De Castilla (Norte)');

  const m30 = parseMadridM30Xml(
    '<Camaras><Camara><Posicion><Latitud>40.392318</Latitud><Longitud>-3.676831</Longitud></Posicion>' +
      '<Nombre>M30-PK10+900C(M.ALVARO)</Nombre></Camara></Camaras>',
  );
  assert.equal(m30.length, 1);
  assert.equal(m30[0].id, 'es-m30-m30-pk10-900c-m-alvaro');
  assert.equal(
    m30[0].url,
    'https://mc30.es/xml-data/imagenes_camaras/M30-PK10%2B900C(M.ALVARO).jpg',
  );
});

test('Norway: faulted cameras and malformed ids are dropped', () => {
  const feature = (id, status = 'videoOrImagesAvailable') => ({
    geometry: { coordinates: [10.45, 63.44] },
    properties: {
      CAMERA_ID: id,
      DESCRIPTION: 'Haakon VII gate',
      ROAD_NUMBER: 'F6668',
      ORIENTATION_DESCRIPTION: 'ukjent',
      STATUS_STILL_IMAGE_AVAILABILITY: status,
    },
  });
  const cams = parseNorwayFeatures({
    features: [
      feature('3000082_1'),
      feature('3000083_1', 'videoOrImagesUnavailableDueToCameraFault'),
      feature('../../x'),
    ],
  });
  assert.equal(cams.length, 1);
  assert.equal(cams[0].url, 'https://kamera.atlas.vegvesen.no/api/images/3000082_1');
  assert.equal(cams[0].name, 'F6668 Haakon VII gate');
});

test('Iceland: only frame files on the official path are registered', () => {
  const row = (Slod, Breidd = 64.02, Lengd = -21.34) => ({
    Myndavel: 'Hellisheiði',
    Skyring: 'Hellisheiði séð til vesturs',
    Slod,
    Breidd,
    Lengd,
  });
  const cams = parseIcelandCameras([
    row('https://www.vegagerdin.is/vgdata/vefmyndavelar/hellisheidi_1.jpg'),
    row('https://evil.example/vgdata/vefmyndavelar/x.jpg'),
    row('https://www.vegagerdin.is/other/x.jpg'),
  ]);
  assert.equal(cams.length, 1);
  assert.equal(cams[0].id, 'is-hellisheidi_1');
});

test('Luxembourg CITA: stills are synthesized from the placemark number', () => {
  const cams = parseCitaKml(
    '<kml><Placemark id="camera_3"><name>A6 - Camera 3</name>' +
      '<Point><coordinates>5.9212,49.6369,0</coordinates></Point></Placemark></kml>',
  );
  assert.equal(cams.length, 1);
  assert.equal(
    cams[0].url,
    'https://www.cita.lu/info_trafic/cameras/images/cccam_3.jpg',
  );
});

test('İBB: HLS only on hls.ibb.gov.tr, nested groups included, strings parsed', () => {
  const cam = (ID, url, extra = {}) => ({
    ID,
    Name: 'TAKSİM MEYDANI',
    XCoord: '28.9869',
    YCoord: '41.0370',
    VideoURL_SSL: url,
    Group: [],
    ...extra,
  });
  const cams = parseIbbCameras([
    cam(2, 'https://hls.ibb.gov.tr/tkm4/hls/2.stream/playlist.m3u8', {
      Group: [cam(700, 'https://hls.ibb.gov.tr/tkm1/hls/700.stream/playlist.m3u8')],
    }),
    cam(3, 'https://evil.example/tkm4/hls/3.stream/playlist.m3u8'),
    cam(4, 'rtsp://10.0.0.1/stream'),
  ]);
  assert.deepEqual(
    cams.map((c) => c.id).sort(),
    ['tr-ibb-2', 'tr-ibb-700'],
  );
  const taksim = cams.find((c) => c.id === 'tr-ibb-2');
  assert.equal(taksim.feedType, 'hls');
  assert.equal(taksim.name, 'Taksim Meydanı');
  assert.equal(taksim.lat, 41.037);
  assert.equal(taksim.snapshotUrl, '');
});

test('İZUM: MJPEG streams only on the İZUM camera host, by UUID', () => {
  const row = (url, ufid = 'CAM-TR-IZM-K68') => ({
    ufid,
    name: 'TEPECIK KAVSAGI',
    mjpegStreamUrl: url,
    lat: 38.4222,
    lng: 27.1529,
  });
  const cams = parseIzumCameras([
    row('https://izum-cams.izmir.bel.tr/mjpeg/f83633c5-f837-4f7d-afda-c0446eada095'),
    row('https://evil.example/mjpeg/f83633c5-f837-4f7d-afda-c0446eada095', 'K2'),
    row('https://izum-cams.izmir.bel.tr/mjpeg/not-a-uuid', 'K3'),
  ]);
  assert.equal(cams.length, 1);
  assert.equal(cams[0].id, 'tr-izum-cam-tr-izm-k68');
  assert.equal(cams[0].name, 'Tepecik Kavsagi');
});

test('titleCase keeps Spanish i and uses Turkish casing only when asked', () => {
  assert.equal(titleCase('PLAZA DE CASTILLA'), 'Plaza De Castilla');
  assert.equal(titleCase('TAKSİM MEYDANI', 'tr'), 'Taksim Meydanı');
  assert.equal(titleCase('Already Mixed'), 'Already Mixed');
});

test('readFirstMjpegFrame returns the first complete JPEG and stops reading', async () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
  const part = (body) =>
    Buffer.concat([
      Buffer.from('--myboundary\r\nContent-Type: image/jpeg\r\n\r\n'),
      body,
      Buffer.from('\r\n'),
    ]);
  let pulls = 0;
  const stream = new ReadableStream({
    pull(controller) {
      pulls++;
      // Split the first frame across chunks, then stream forever.
      if (pulls === 1) controller.enqueue(part(jpeg).subarray(0, 50));
      else controller.enqueue(part(jpeg).subarray(pulls === 2 ? 50 : 0));
    },
  });
  const frame = await readFirstMjpegFrame(new Response(stream), 1024);
  assert.deepEqual(frame, jpeg);
  assert.ok(pulls <= 3);

  const endless = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(512));
    },
  });
  assert.equal(await readFirstMjpegFrame(new Response(endless), 2048), null);
});
