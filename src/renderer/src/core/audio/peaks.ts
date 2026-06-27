/**
 * Min/max/RMS peak pyramid for waveform rendering. Level 0 summarizes the
 * signal at BASE_SAMPLES_PER_BIN samples per bin; each level above halves the
 * bin count. The painter picks the coarsest level that still gives ≥1 bin per
 * pixel, so rendering cost is bounded by canvas width at any zoom.
 *
 * Each bin stores three values: the min and max sample (the peak envelope) and
 * the RMS (root-mean-square) energy. Min/max trace every transient and read as
 * "noise" for dense music; the RMS body averages out isolated spikes and shows
 * the actual musical dynamics — drawn as a darker fill inside the lighter peak
 * outline.
 *
 * Built in a Web Worker to keep the scheduler's thread clean while loading
 * long files.
 */

export const BASE_SAMPLES_PER_BIN = 64;

/** Values stored per bin: [min, max, rms]. */
export const VALUES_PER_BIN = 3;

export interface PeakPyramid {
  sampleRate: number;
  /** levels[L] = Float32Array of [min, max, rms, ...]; level L bin = BASE*2^L samples */
  levels: Float32Array[];
}

export function binsForLevel(pyramid: PeakPyramid, level: number): number {
  return pyramid.levels[level].length / VALUES_PER_BIN;
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
  const base = new Float32Array(baseBins * VALUES_PER_BIN);

  for (let bin = 0; bin < baseBins; bin++) {
    let min = Infinity;
    let max = -Infinity;
    let sumSq = 0;
    let count = 0;
    const start = bin * BASE_SAMPLES_PER_BIN;
    const end = Math.min(start + BASE_SAMPLES_PER_BIN, length);
    for (const channel of channelData) {
      for (let i = start; i < end; i++) {
        const v = channel[i];
        if (v < min) min = v;
        if (v > max) max = v;
        sumSq += v * v;
        count++;
      }
    }
    if (min === Infinity) {
      min = 0;
      max = 0;
    }
    base[bin * VALUES_PER_BIN] = min;
    base[bin * VALUES_PER_BIN + 1] = max;
    base[bin * VALUES_PER_BIN + 2] = count > 0 ? Math.sqrt(sumSq / count) : 0;
  }

  const levels: Float32Array[] = [base];
  while (binsForCount(levels[levels.length - 1]) > 512) {
    const prev = levels[levels.length - 1];
    const prevBins = binsForCount(prev);
    const bins = Math.ceil(prevBins / 2);
    const next = new Float32Array(bins * VALUES_PER_BIN);
    for (let b = 0; b < bins; b++) {
      const i0 = b * 2 * VALUES_PER_BIN;
      const min0 = prev[i0];
      const max0 = prev[i0 + 1];
      const rms0 = prev[i0 + 2];
      const hasSecond = b * 2 + 1 < prevBins;
      const min1 = hasSecond ? prev[i0 + VALUES_PER_BIN] : min0;
      const max1 = hasSecond ? prev[i0 + VALUES_PER_BIN + 1] : max0;
      // When the second child is absent the bin holds only the first child's
      // energy, so fall back to rms0 rather than averaging in a phantom zero.
      const rms1 = hasSecond ? prev[i0 + VALUES_PER_BIN + 2] : rms0;
      next[b * VALUES_PER_BIN] = Math.min(min0, min1);
      next[b * VALUES_PER_BIN + 1] = Math.max(max0, max1);
      // RMS of two equal-length halves combines as the quadratic mean.
      next[b * VALUES_PER_BIN + 2] = Math.sqrt((rms0 * rms0 + rms1 * rms1) / 2);
    }
    levels.push(next);
  }

  return { sampleRate, levels };
}

function binsForCount(arr: Float32Array): number {
  return arr.length / VALUES_PER_BIN;
}
