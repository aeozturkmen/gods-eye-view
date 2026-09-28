import { createHash } from 'node:crypto';

/**
 * Provider "camera offline" images.
 *
 * Some operators answer a still request for an offline camera with a valid
 * JPEG that says so (City of Austin: a 12,805-byte "Image Unavailable" card).
 * The frame proxy only checks for image/*, so such cameras reported
 * SNAPSHOT · OK while showing the card. Two signals catch them:
 *
 * 1. Known placeholder bytes (sha256), recognized on the first frame.
 * 2. Learned placeholders: byte-identical frames from several DIFFERENT
 *    cameras on the same host cannot be live imagery, so that hash is treated
 *    as a placeholder for every camera on the host.
 */

/** sha256 of known provider placeholder images. */
export const KNOWN_PLACEHOLDER_SHA256 = new Set([
  // cctv.austinmobility.io — "Image Unavailable" (City of Austin logo), 12,805 B.
  'db8d3ffca668cac202fd73df14bcc10e703b22f166903e8ff9937998d963e08e',
]);

/** Distinct cameras returning the same bytes before the hash is a placeholder. */
export const LEARNED_PLACEHOLDER_CAMERAS = 3;
const MAX_TRACKED_HASHES = 4096;

export function createPlaceholderDetector({
  known = KNOWN_PLACEHOLDER_SHA256,
  threshold = LEARNED_PLACEHOLDER_CAMERAS,
} = {}) {
  /** `${host}|${sha}` -> Set(cameraId) */
  const seen = new Map();
  const learned = new Set();

  return {
    /**
     * @param {string} url Upstream frame URL (its host scopes learning).
     * @param {string} cameraId
     * @param {Buffer|Uint8Array} body Frame bytes.
     * @returns {boolean} True when the frame is a provider placeholder.
     */
    isPlaceholder(url, cameraId, body) {
      if (!body?.length) return false;
      const hash = createHash('sha256').update(body).digest('hex');
      if (known.has(hash)) return true;
      let host = '';
      try {
        host = new URL(url).host;
      } catch {
        return false;
      }
      const key = `${host}|${hash}`;
      if (learned.has(key)) return true;
      let cameras = seen.get(key);
      if (!cameras) {
        if (seen.size >= MAX_TRACKED_HASHES) seen.clear();
        seen.set(key, (cameras = new Set()));
      }
      cameras.add(String(cameraId));
      if (cameras.size >= threshold) {
        learned.add(key);
        seen.delete(key);
        return true;
      }
      return false;
    },
  };
}
