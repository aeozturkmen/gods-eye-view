/**
 * Declutter: a reversible "quiet map" mode. While on, every native contact
 * (billboards, points, label glyphs) and every ambient overlay card/label is
 * drawn smaller and dimmer — never hidden — so the ground underneath is easy
 * to read. Nothing here writes layer state: the GPU contact pass and the world
 * overlay read these factors at draw time, so turning it off restores the
 * exact previous look.
 *
 * State lives on `<html data-declutter="on">` (like the cyber sonar settings)
 * and is remembered per browser in localStorage.
 */

/** Contacts shrink to this fraction of their native on-screen size. */
export const DECLUTTER_SCALE = 0.55;
/** ...and draw at this fraction of their native opacity. */
export const DECLUTTER_ALPHA = 0.4;
const STORAGE_KEY = 'gev:declutter:v1';
export const DECLUTTER_CHANGE_EVENT = 'gev:declutter-change';

const OFF = Object.freeze({ enabled: false, scale: 1, alpha: 1 });
const ON = Object.freeze({
  enabled: true,
  scale: DECLUTTER_SCALE,
  alpha: DECLUTTER_ALPHA,
});

const root = () => globalThis.document?.documentElement;

/** Whether declutter is currently on. */
export function isDeclutterEnabled() {
  return root()?.dataset?.declutter === 'on';
}

/** Draw-time factors; `{scale: 1, alpha: 1}` when off. Allocation-free. */
export function declutterFactors() {
  return isDeclutterEnabled() ? ON : OFF;
}

/** Turn declutter on/off, remember the choice, and announce the change. */
export function setDeclutterEnabled(enabled) {
  const element = root();
  if (!element?.dataset) return false;
  const next = Boolean(enabled);
  if (next) element.dataset.declutter = 'on';
  else delete element.dataset.declutter;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, next ? '1' : '0');
  } catch {
    // Private mode / blocked storage: the toggle still works for this visit.
  }
  globalThis.dispatchEvent?.(
    new CustomEvent(DECLUTTER_CHANGE_EVENT, { detail: { enabled: next } }),
  );
  return next;
}

/** Restore the remembered choice (default off). */
export function restoreDeclutterPreference() {
  let stored = null;
  try {
    stored = globalThis.localStorage?.getItem(STORAGE_KEY);
  } catch {
    stored = null;
  }
  return setDeclutterEnabled(stored === '1');
}
