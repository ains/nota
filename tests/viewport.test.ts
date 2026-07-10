import { describe, it, expect } from "vitest";
import {
  secToPx,
  pxToSec,
  zoomAt,
  fitDuration,
  rulerTickSec,
  formatTime,
  type Viewport,
} from "@renderer/core/timeline/viewport";

const vp: Viewport = { pxPerSecond: 100, scrollSec: 10 };

describe("viewport math", () => {
  it("secToPx and pxToSec are inverses", () => {
    expect(pxToSec(vp, secToPx(vp, 12.345))).toBeCloseTo(12.345);
    expect(secToPx(vp, pxToSec(vp, 333))).toBeCloseTo(333);
  });

  it("zoomAt keeps the anchor time fixed on screen", () => {
    const anchorPx = 250;
    const anchorSec = pxToSec(vp, anchorPx);
    const zoomed = zoomAt(vp, anchorPx, 2);
    expect(pxToSec(zoomed, anchorPx)).toBeCloseTo(anchorSec);
    expect(zoomed.pxPerSecond).toBeCloseTo(200);
  });

  it("zoomAt clamps zoom level", () => {
    const z = zoomAt(vp, 0, 1e9);
    expect(z.pxPerSecond).toBeLessThanOrEqual(20000);
  });

  it("fits the entire duration from time zero", () => {
    const fitted = fitDuration(400, 800);
    expect(fitted).toEqual({ pxPerSecond: 2, scrollSec: 0 });
    expect(secToPx(fitted, 400)).toBe(800);
  });

  it("fits long durations below the interactive zoom floor", () => {
    const fitted = fitDuration(3600, 900);
    expect(fitted.pxPerSecond).toBe(0.25);
    expect(secToPx(fitted, 3600)).toBe(900);
  });
});

describe("rulerTickSec", () => {
  it("chooses finer ticks at higher zoom", () => {
    expect(rulerTickSec(10000)).toBeLessThan(rulerTickSec(10));
  });
  it("respects minimum pixel spacing", () => {
    const tick = rulerTickSec(100);
    expect(tick * 100).toBeGreaterThanOrEqual(80);
  });
});

describe("formatTime", () => {
  it("formats with milliseconds", () => {
    expect(formatTime(61.5)).toBe("1:01.500");
  });
  it("formats without milliseconds", () => {
    expect(formatTime(61.5, false)).toBe("1:01");
  });
});
