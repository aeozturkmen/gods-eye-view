import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { gzipSync } from 'node:zlib';
import { createMultiAddressFetch } from '../../server/providers/cctv/multiAddress.js';
import { fetchHlsBytes } from '../../server/providers/cctv/stream.js';

const listen = (server, host, port = 0) =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server.address().port));
  });
const close = (server) => new Promise((resolve) => server.close(resolve));

/** A good server on 127.0.0.1 and a resetting one on ::1, same port. */
async function fixture(t) {
  let hits = 0;
  const good = http.createServer((_req, res) => {
    hits++;
    res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
    res.end('#EXTM3U\n');
  });
  const port = await listen(good, '127.0.0.1');
  let resets = 0;
  const bad = net.createServer((socket) => {
    resets++;
    socket.resetAndDestroy();
  });
  try {
    await listen(bad, '::1', port);
  } catch {
    await close(good);
    t.skip('IPv6 loopback unavailable');
    return null;
  }
  t.after(() => Promise.all([close(good), close(bad)]));
  // DNS lists the resetting address first, like hls.ibb.gov.tr does.
  const lookup = (_host, _opts, cb) =>
    cb(null, [
      { address: '::1', family: 6 },
      { address: '127.0.0.1', family: 4 },
    ]);
  return {
    url: `http://cams.test:${port}/live/playlist.m3u8`,
    lookup,
    counts: () => ({ hits, resets }),
  };
}

test('a reset from the first resolved address falls through to the next', async (t) => {
  const f = await fixture(t);
  if (!f) return;
  const fetchImpl = createMultiAddressFetch({ lookup: f.lookup });
  const body = await fetchHlsBytes(f.url, { fetchImpl, maxBytes: 1024 });
  assert.equal(body.toString(), '#EXTM3U\n');
  assert.deepEqual(f.counts(), { hits: 1, resets: 1 });
});

test('the address that answered is tried first next time', async (t) => {
  const f = await fixture(t);
  if (!f) return;
  const fetchImpl = createMultiAddressFetch({ lookup: f.lookup });
  await fetchHlsBytes(f.url, { fetchImpl, maxBytes: 1024 });
  await fetchHlsBytes(f.url, { fetchImpl, maxBytes: 1024 });
  assert.deepEqual(f.counts(), { hits: 2, resets: 1 });
});

test('fails when no address answers, and honours an aborted signal', async () => {
  const lookup = (_host, _opts, cb) =>
    cb(null, [{ address: '127.0.0.1', family: 4 }]);
  const fetchImpl = createMultiAddressFetch({ lookup });
  // Port 9 (discard) is closed on a normal machine.
  await assert.rejects(fetchImpl('http://cams.test:9/x.m3u8'));
  await assert.rejects(
    fetchImpl('http://cams.test:9/x.m3u8', { signal: AbortSignal.abort() }),
    { name: 'AbortError' },
  );
});

test('non-ok and redirect responses are returned, not followed', async (t) => {
  const server = http.createServer((_req, res) => {
    res.writeHead(302, { Location: 'https://evil.example/' });
    res.end();
  });
  const port = await listen(server, '127.0.0.1');
  t.after(() => close(server));
  const lookup = (_host, _opts, cb) =>
    cb(null, [{ address: '127.0.0.1', family: 4 }]);
  const res = await createMultiAddressFetch({ lookup })(
    `http://cams.test:${port}/x`,
  );
  assert.equal(res.status, 302);
  assert.equal(res.ok, false);
});

test('gzip bodies sent without being asked for are decoded, like fetch does', async (t) => {
  const text = '#EXTM3U\n#EXT-X-VERSION:3\n';
  const server = http.createServer((_req, res) => {
    const body = gzipSync(text);
    res.writeHead(200, {
      'Content-Encoding': 'gzip',
      'Content-Length': body.length,
    });
    res.end(body);
  });
  const port = await listen(server, '127.0.0.1');
  t.after(() => close(server));
  const lookup = (_host, _opts, cb) =>
    cb(null, [{ address: '127.0.0.1', family: 4 }]);
  const body = await fetchHlsBytes(`http://cams.test:${port}/x.m3u8`, {
    fetchImpl: createMultiAddressFetch({ lookup }),
    maxBytes: 1024,
  });
  assert.equal(body.toString(), text);
});
