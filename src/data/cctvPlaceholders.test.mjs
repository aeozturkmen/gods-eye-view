import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  createPlaceholderDetector,
  KNOWN_PLACEHOLDER_SHA256,
} from '../../server/providers/cctv/placeholders.js';

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

test('a known provider placeholder is recognized on the first frame', () => {
  const body = Buffer.from('austin-offline-placeholder');
  const detector = createPlaceholderDetector({
    known: new Set([sha(body)]),
  });
  assert.equal(
    detector.isPlaceholder(
      'https://cctv.austinmobility.io/image/354.jpg',
      '354',
      body,
    ),
    true,
  );
});

test('the same bytes from several different cameras on one host are learned as a placeholder', () => {
  const detector = createPlaceholderDetector({ known: new Set() });
  const body = Buffer.from('no-signal');
  const url = (id) => `https://cams.example/img/${id}.jpg`;
  assert.equal(detector.isPlaceholder(url(1), 'a', body), false);
  // The same camera repeating its own frame is just a parked camera.
  assert.equal(detector.isPlaceholder(url(1), 'a', body), false);
  assert.equal(detector.isPlaceholder(url(2), 'b', body), false);
  // Byte-identical frames from a third distinct camera cannot be live video.
  assert.equal(detector.isPlaceholder(url(3), 'c', body), true);
  // ...and from then on the first camera is flagged too.
  assert.equal(detector.isPlaceholder(url(1), 'a', body), true);
});

test('identical bytes on different hosts are not merged, and real frames stay live', () => {
  const detector = createPlaceholderDetector({ known: new Set() });
  const body = Buffer.from('same');
  assert.equal(detector.isPlaceholder('https://a.example/1.jpg', 'a1', body), false);
  assert.equal(detector.isPlaceholder('https://b.example/1.jpg', 'b1', body), false);
  assert.equal(detector.isPlaceholder('https://c.example/1.jpg', 'c1', body), false);
  for (let i = 0; i < 10; i++)
    assert.equal(
      detector.isPlaceholder(
        `https://a.example/${i}.jpg`,
        `cam${i}`,
        Buffer.from(`live frame ${i}`),
      ),
      false,
    );
});

test('the shipped known list includes the Austin "Image Unavailable" JPEG', () => {
  assert.ok(
    KNOWN_PLACEHOLDER_SHA256.has(
      'db8d3ffca668cac202fd73df14bcc10e703b22f166903e8ff9937998d963e08e',
    ),
  );
});
