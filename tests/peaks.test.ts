import { describe, it, expect } from "vitest";
import {
  buildPyramid,
  BASE_SAMPLES_PER_BIN,
  VALUES_PER_BIN,
  levelForZoom,
} from "@renderer/core/audio/peaks";

describe("peak pyramid", () => {
  it("computes correct min/max on a synthetic ramp", () => {
    const n = BASE_SAMPLES_PER_BIN * 4;
    const ramp = new Float32Array(n);
    for (let i = 0; i < n; i++) ramp[i] = i / n; // 0 .. ~1 ascending
    const pyramid = buildPyramid([ramp], 48000);
    const base = pyramid.levels[0];
    // First bin: min = 0, max = (BASE-1)/n
    expect(base[0]).toBeCloseTo(0);
    expect(base[1]).toBeCloseTo((BASE_SAMPLES_PER_BIN - 1) / n);
    // Last bin max ~ (n-1)/n
    const lastBin = base.length / VALUES_PER_BIN - 1;
    expect(base[lastBin * VALUES_PER_BIN + 1]).toBeCloseTo((n - 1) / n);
  });

  it("merges channels with overall min/max", () => {
    const a = new Float32Array(BASE_SAMPLES_PER_BIN).fill(0.5);
    const b = new Float32Array(BASE_SAMPLES_PER_BIN).fill(-0.25);
    const pyramid = buildPyramid([a, b], 48000);
    expect(pyramid.levels[0][0]).toBeCloseTo(-0.25);
    expect(pyramid.levels[0][1]).toBeCloseTo(0.5);
  });

  it("builds coarser levels that bound finer ones", () => {
    const n = BASE_SAMPLES_PER_BIN * 2048;
    const noise = new Float32Array(n);
    let seed = 1;
    for (let i = 0; i < n; i++) {
      seed = (seed * 16807) % 2147483647;
      noise[i] = (seed / 2147483647) * 2 - 1;
    }
    const pyramid = buildPyramid([noise], 48000);
    expect(pyramid.levels.length).toBeGreaterThan(1);
    const fine = pyramid.levels[0];
    const coarse = pyramid.levels[1];
    // Coarse bin 0 covers fine bins 0..1
    expect(coarse[0]).toBeLessThanOrEqual(
      Math.min(fine[0], fine[VALUES_PER_BIN]),
    );
    expect(coarse[1]).toBeGreaterThanOrEqual(
      Math.max(fine[1], fine[VALUES_PER_BIN + 1]),
    );
    // Coarse RMS is the quadratic mean of the two fine halves.
    expect(coarse[2]).toBeCloseTo(
      Math.sqrt(
        (fine[2] * fine[2] +
          fine[VALUES_PER_BIN + 2] * fine[VALUES_PER_BIN + 2]) /
          2,
      ),
    );
  });

  it("computes RMS energy below the peak amplitude", () => {
    // Full-scale square wave: every sample is ±1, so RMS == peak == 1.
    const square = new Float32Array(BASE_SAMPLES_PER_BIN);
    for (let i = 0; i < square.length; i++) square[i] = i % 2 === 0 ? 1 : -1;
    const squarePyramid = buildPyramid([square], 48000);
    expect(squarePyramid.levels[0][2]).toBeCloseTo(1);

    // Sine at amplitude 1: RMS settles to 1/√2 ≈ 0.707, well below the peak.
    const n = BASE_SAMPLES_PER_BIN * 64;
    const sine = new Float32Array(n);
    for (let i = 0; i < n; i++) sine[i] = Math.sin((2 * Math.PI * i) / 32);
    const sinePyramid = buildPyramid([sine], 48000);
    const coarsest = sinePyramid.levels[sinePyramid.levels.length - 1];
    expect(coarsest[1]).toBeCloseTo(1, 1); // peak ≈ 1
    expect(coarsest[2]).toBeCloseTo(Math.SQRT1_2, 1); // rms ≈ 0.707
  });

  it("levelForZoom picks coarser levels when zoomed out", () => {
    const n = BASE_SAMPLES_PER_BIN * 4096;
    const data = new Float32Array(n);
    const pyramid = buildPyramid([data], 48000);
    const zoomedIn = levelForZoom(pyramid, 10000);
    const zoomedOut = levelForZoom(pyramid, 5);
    expect(zoomedOut).toBeGreaterThan(zoomedIn);
  });
});
