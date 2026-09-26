import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createRendering } from './rendering.js';

test('landing pins clamp to terrain only, never to Google 3D tile meshes', () => {
  const rendering = createRendering({
    state: {
      _lastPublishedIds: [],
      _lastPublishedPriorities: [],
      landingColor: Cesium.Color.ORANGE,
      cableOutline: Cesium.Color.BLACK,
    },
  });
  const entity = new Cesium.Entity({
    position: Cesium.Cartesian3.fromDegrees(28.97, 41.0),
    billboard: { heightReference: Cesium.HeightReference.CLAMP_TO_GROUND },
  });
  rendering.styleLandingEntity(entity, { properties: {} });
  // ~1,900 worldwide coastal pins: CLAMP_TO_GROUND re-ran a 3D-tile vertex
  // readback for every pin under each Google 3D tile that streamed in.
  assert.equal(
    entity.billboard.heightReference.getValue(),
    Cesium.HeightReference.CLAMP_TO_TERRAIN,
  );
});
