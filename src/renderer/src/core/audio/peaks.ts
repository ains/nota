/**
 * Min/max peak pyramid for waveform rendering. Level 0 summarizes the signal
 * at BASE_SAMPLES_PER_BIN samples per bin; each level above halves the bin
 * count. The painter picks the coarsest level that still gives ≥1 bin per
 * pixel, so rendering cost is bounded by canvas width at any zoom.
 *
 * Built in a Web Worker to keep the scheduler's thread clean while loading
 * long files.
 */

export const BASE_SAMPLES_PER_BIN = 64;

export interface PeakPyramid {
  sampleRate: number;
  /** levels[L] = Float32Array of [min0, max0, min1, max1, ...]; level L bin = BASE*2^L samples */
  levels: Float32Array[];
}

export function binsForLevel(pyramid: PeakPyramid, level: number): number {
  return pyramid.levels[level].length / 2;
}

export function samplesPerBin(level: number): number {
  return BASE_SAMPLES_PER_BIN * 2 ** level;
}

export function secondsPerBin(pyramid: PeakPyramid, level: number): number {
  return samplesPerBin(level) / pyramid.sampleRate;
}

/**
 * Pick the coarsest level whose bins are still at most one pixel wide, so we
 * never draw more than ~2 bins per pixel.
 */
export function levelForZoom(
  pyramid: PeakPyramid,
  pxPerSecond: number,
): number {
  let level = 0;
  while (
    level + 1 < pyramid.levels.length &&
    secondsPerBin(pyramid, level + 1) * pxPerSecond <= 1
  ) {
    level++;
  }
  return level;
}

/** Synchronous pyramid build — runs inside the worker. */
export function buildPyramid(
  channelData: Float32Array[],
  sampleRate: number,
): PeakPyramid {
  const length = channelData[0]?.length ?? 0;
  const baseBins = Math.ceil(length / BASE_SAMPLES_PER_BIN);
  const base = new Float32Array(baseBins * 2);

  for (let bin = 0; bin < baseBins; bin++) {
    let min = Infinity;
    let max = -Infinity;
    const start = bin * BASE_SAMPLES_PER_BIN;
    const end = Math.min(start + BASE_SAMPLES_PER_BIN, length);
    for (const channel of channelData) {
      for (let i = start; i < end; i++) {
        const v = channel[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (min === Infinity) {
      min = 0;
      max = 0;
    }
    base[bin * 2] = min;
    base[bin * 2 + 1] = max;
  }

  const levels: Float32Array[] = [base];
  while (binsForCount(levels[levels.length - 1]) > 512) {
    const prev = levels[levels.length - 1];
    const prevBins = binsForCount(prev);
    const bins = Math.ceil(prevBins / 2);
    const next = new Float32Array(bins * 2);
    for (let b = 0; b < bins; b++) {
      const i0 = b * 2 * 2;
      const min0 = prev[i0];
      const max0 = prev[i0 + 1];
      const hasSecond = b * 2 + 1 < prevBins;
      const min1 = hasSecond ? prev[i0 + 2] : min0;
      const max1 = hasSecond ? prev[i0 + 3] : max0;
      next[b * 2] = Math.min(min0, min1);
      next[b * 2 + 1] = Math.max(max0, max1);
    }
    levels.push(next);
  }

  return { sampleRate, levels };
}

function binsForCount(arr: Float32Array): number {
  return arr.length / 2;
}
