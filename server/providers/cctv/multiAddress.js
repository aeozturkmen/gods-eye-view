import { lookup as dnsLookup } from 'node:dns';
import https from 'node:https';
import http from 'node:http';
import { Readable } from 'node:stream';
import zlib from 'node:zlib';

const DECODERS = {
  gzip: () => zlib.createGunzip(),
  'x-gzip': () => zlib.createGunzip(),
  deflate: () => zlib.createInflate(),
  br: () => zlib.createBrotliDecompress(),
};

/**
 * A fetch() for hosts that publish dead addresses in DNS.
 *
 * hls.ibb.gov.tr resolves to four addresses; only one completes a TLS
 * handshake, the others refuse or reset it. Node's fetch picks the first
 * address and moves on only when TCP itself fails, so a TLS reset from the
 * first address fails every request. This tries each resolved address in
 * turn until one answers and remembers the one that worked per host.
 *
 * TLS uses Node's default trust store, so the intermediates that ./gev.sh
 * adds through NODE_EXTRA_CA_CERTS (config/tls) still apply.
 *
 * Like fetch, it decodes gzip/deflate/br bodies: one İBB pool compresses
 * playlists even when the request did not ask for it.
 *
 * It never follows redirects (a 3xx comes back as a non-ok Response) and
 * returns a WHATWG Response, so it drops into fetchHlsBytes as fetchImpl.
 */
export function createMultiAddressFetch({
  lookup = dnsLookup,
  transports = { 'https:': https, 'http:': http },
  // A dead address may hang instead of refusing; give up on it quickly so
  // the next one still fits in the caller's overall timeout.
  connectTimeoutMs = 2500,
} = {}) {
  /** host -> address that last answered */
  const preferred = new Map();

  const resolveAll = (hostname) =>
    new Promise((resolve, reject) =>
      lookup(hostname, { all: true }, (err, addrs) =>
        err ? reject(err) : resolve(addrs),
      ),
    );

  const attempt = (url, addr, { headers, signal }) =>
    new Promise((resolve, reject) => {
      const transport = transports[url.protocol];
      if (!transport) return reject(new Error('Unsupported protocol'));
      const req = transport.request(url, {
        method: 'GET',
        headers,
        signal,
        // Pin the connection to one address; TLS still verifies the hostname.
        lookup: (_host, opts, cb) =>
          opts?.all
            ? cb(null, [{ address: addr.address, family: addr.family }])
            : cb(null, addr.address, addr.family),
      });
      const connected = url.protocol === 'https:' ? 'secureConnect' : 'connect';
      let timer;
      req.once('socket', (socket) => {
        timer = setTimeout(
          () => req.destroy(new Error('Connect timeout')),
          connectTimeoutMs,
        );
        socket.once(connected, () => clearTimeout(timer));
      });
      req.once('response', (res) => {
        clearTimeout(timer);
        resolve(res);
      });
      req.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      req.end();
    });

  return async function multiAddressFetch(input, init = {}) {
    const url = new URL(String(input));
    const { signal } = init;
    signal?.throwIfAborted();
    const addrs = await resolveAll(url.hostname);
    const best = preferred.get(url.hostname);
    addrs.sort((a, b) => (b.address === best) - (a.address === best));
    let lastError;
    for (const addr of addrs) {
      signal?.throwIfAborted();
      let res;
      try {
        res = await attempt(url, addr, { headers: init.headers, signal });
      } catch (error) {
        if (signal?.aborted) throw error;
        lastError = error;
        if (preferred.get(url.hostname) === addr.address)
          preferred.delete(url.hostname);
        continue;
      }
      preferred.set(url.hostname, addr.address);
      const headers = new Headers();
      for (const [k, v] of Object.entries(res.headers)) {
        if (v === undefined) continue;
        for (const value of Array.isArray(v) ? v : [v])
          headers.append(k, value);
      }
      const nullBody = [204, 304].includes(res.statusCode);
      if (nullBody) res.resume();
      let body = res;
      const decoder = DECODERS[headers.get('content-encoding')?.trim()];
      if (decoder && !nullBody) {
        body = res.pipe(decoder());
        res.once('error', (error) => body.destroy(error));
        // The declared length is the compressed size, not what callers read.
        headers.delete('content-encoding');
        headers.delete('content-length');
      }
      return new Response(nullBody ? null : Readable.toWeb(body), {
        status: res.statusCode,
        headers,
      });
    }
    throw lastError || new Error('No address answered');
  };
}
