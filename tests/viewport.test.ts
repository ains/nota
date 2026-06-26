import { describe, it, expect } from "vitest";
import {
  secToPx,
  pxToSec,
  zoomAt,
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
