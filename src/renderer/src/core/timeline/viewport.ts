/**
 * Shared timeline viewport: every lane (ruler, waveform, piano roll, loop
 * lane, playhead) renders from the same { pxPerSecond, scrollSec } pair, so
 * cross-lane sync is free by construction.
 */

export interface Viewport {
  pxPerSecond: number;
  /** Timeline seconds at the left edge of the lanes */
  scrollSec: number;
}

export const MIN_PX_PER_SEC = 2;
export const MAX_PX_PER_SEC = 20000;

export function secToPx(vp: Viewport, sec: number): number {
  return (sec - vp.scrollSec) * vp.pxPerSecond;
}

export function pxToSec(vp: Viewport, px: number): number {
  return vp.scrollSec + px / vp.pxPerSecond;
}

export function visibleSpanSec(vp: Viewport, widthPx: number): number {
  return widthPx / vp.pxPerSecond;
}

/** Zoom by `factor` keeping the time under `anchorPx` fixed on screen. */
export function zoomAt(
  vp: Viewport,
  anchorPx: number,
  factor: number,
): Viewport {
  const anchorSec = pxToSec(vp, anchorPx);
  const pxPerSecond = clamp(
    vp.pxPerSecond * factor,
    MIN_PX_PER_SEC,
    MAX_PX_PER_SEC,
  );
  return { pxPerSecond, scrollSec: anchorSec - anchorPx / pxPerSecond };
}

/**
 * Map pxPerSecond to a 0..1 slider position on a log scale (and back), so a
 * linear slider spans the full zoom range with even perceptual steps.
 */
export function zoomToSlider(pxPerSecond: number): number {
  const lo = Math.log(MIN_PX_PER_SEC);
  const hi = Math.log(MAX_PX_PER_SEC);
  return (Math.log(pxPerSecond) - lo) / (hi - lo);
}

export function sliderToZoom(t: number): number {
  const lo = Math.log(MIN_PX_PER_SEC);
  const hi = Math.log(MAX_PX_PER_SEC);
  return Math.exp(lo + t * (hi - lo));
}

export function clampScroll(
  vp: Viewport,
  durationSec: number,
  widthPx: number,
): Viewport {
  const span = visibleSpanSec(vp, widthPx);
  const maxScroll = Math.max(0, durationSec - span * 0.5);
  return { ...vp, scrollSec: clamp(vp.scrollSec, -span * 0.25, maxScroll) };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/** Choose a "nice" ruler tick spacing for the current zoom. */
export function rulerTickSec(pxPerSecond: number, minPxPerTick = 80): number {
  const minSec = minPxPerTick / pxPerSecond;
  const steps = [
    0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30,
    60, 120, 300,
  ];
  for (const s of steps) {
    if (s >= minSec) return s;
  }
  return 600;
}

export function formatTime(sec: number, withMs = true): string {
  const sign = sec < 0 ? "-" : "";
  const abs = Math.abs(sec);
  const m = Math.floor(abs / 60);
  const s = Math.floor(abs % 60);
  if (!withMs) return `${sign}${m}:${String(s).padStart(2, "0")}`;
  const ms = Math.round((abs - Math.floor(abs)) * 1000);
  return `${sign}${m}:${String(s).padStart(2, "0")}.${String(ms).padStart(
    3,
    "0",
  )}`;
}
