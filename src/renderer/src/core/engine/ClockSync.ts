/**
 * Maps performance.now() wall time (the domain of Web MIDI event timestamps)
 * onto AudioContext time *as heard at the speaker*.
 *
 * The two clocks are driven by different physical oscillators and drift
 * relative to each other (~tens of ppm — milliseconds per minute), so the
 * mapping is a continuously re-fitted linear model over recent
 * getOutputTimestamp() samples, not a one-shot offset.
 *
 * getOutputTimestamp() pairs { contextTime, performanceTime } meaning "the
 * sample with this context time was leaving the output device at this wall
 * time" — output latency is therefore baked into the fit, and converting a
 * MIDI timestamp through it answers exactly the question recording and
 * scoring need: what was the user HEARING when they struck the key?
 */

interface ClockPair {
  perfMs: number;
  ctxSec: number;
}

const POLL_INTERVAL_MS = 500;
const WINDOW_SIZE = 20; // ~10s of samples
const OUTLIER_RESIDUAL_SEC = 0.002;
const RESEED_AFTER_CONSECUTIVE_OUTLIERS = 5;
/** Max correction rate: 1ms of mapping shift per second of wall time. */
const SLEW_SEC_PER_SEC = 0.001;

export interface ClockSyncDiagnostics {
  /** Current fitted skew in ppm relative to nominal 1ms/ms */
  skewPpm: number;
  /** Offset between raw (currentTime, perf.now) and the speaker-referenced fit, ms */
  outputDelayMs: number;
  usingFallback: boolean;
  sampleCount: number;
  lastResidualMs: number;
}

export class ClockSync {
  private ctx: AudioContext;
  private samples: ClockPair[] = [];
  /** Fitted model: ctxSec = a * perfMs + b */
  private a = 0.001;
  private b = 0;
  private fitted = false;
  private usingFallback = false;
  private consecutiveOutliers = 0;
  private lastResidual = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Slew state: the model actually served is the fit shifted by `slewOffset` (decays to 0). */
  private slewOffset = 0;
  private lastSlewUpdatePerf = 0;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  start(): void {
    if (this.timer) return;
    this.poll();
    this.timer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * THE mapping: wall-clock instant -> context time of the audio that was at
   * the speaker at that instant. Used for all human input (MIDI timestamps).
   */
  ctxTimeAtSpeaker(perfMs: number): number {
    this.updateSlew();
    return this.a * perfMs + this.b + this.slewOffset;
  }

  diagnostics(): ClockSyncDiagnostics {
    const nowPerf = performance.now();
    const rawCtx = this.ctx.currentTime;
    const mapped = this.fitted
      ? this.a * nowPerf + this.b + this.slewOffset
      : rawCtx;
    return {
      skewPpm: (this.a / 0.001 - 1) * 1e6,
      outputDelayMs: (rawCtx - mapped) * 1000,
      usingFallback: this.usingFallback,
      sampleCount: this.samples.length,
      lastResidualMs: this.lastResidual * 1000,
    };
  }

  private poll(): void {
    if (this.ctx.state !== "running") return;

    let pair: ClockPair;
    const ts = this.ctx.getOutputTimestamp();
    const ctxTime = ts?.contextTime;
    const perfTime = ts?.performanceTime;
    if (
      ctxTime === undefined ||
      perfTime === undefined ||
      (ctxTime === 0 && perfTime === 0)
    ) {
      // Some platforms (notably certain Linux audio stacks) return zeros.
      // Fall back to (currentTime - outputLatency, now), accepting some
      // residual absolute error.
      this.usingFallback = true;
      pair = {
        perfMs: performance.now(),
        ctxSec: this.ctx.currentTime - (this.ctx.outputLatency || 0),
      };
    } else {
      this.usingFallback = false;
      pair = { perfMs: perfTime, ctxSec: ctxTime };
    }

    if (this.fitted) {
      const predicted = this.a * pair.perfMs + this.b;
      const residual = pair.ctxSec - predicted;
      this.lastResidual = residual;
      if (Math.abs(residual) > OUTLIER_RESIDUAL_SEC) {
        this.consecutiveOutliers++;
        if (this.consecutiveOutliers >= RESEED_AFTER_CONSECUTIVE_OUTLIERS) {
          // Reality changed (device switch / underrun storm): re-seed.
          this.samples = [pair];
          this.consecutiveOutliers = 0;
          this.fitted = false;
          this.refit();
        }
        return;
      }
      this.consecutiveOutliers = 0;
    }

    this.samples.push(pair);
    if (this.samples.length > WINDOW_SIZE) this.samples.shift();
    this.refit();
  }

  private refit(): void {
    const n = this.samples.length;
    if (n === 0) return;
    if (n === 1) {
      const s = this.samples[0];
      this.applyFit(0.001, s.ctxSec - 0.001 * s.perfMs);
      return;
    }
    // Least squares over the window. Center for numerical stability.
    let mp = 0;
    let mc = 0;
    for (const s of this.samples) {
      mp += s.perfMs;
      mc += s.ctxSec;
    }
    mp /= n;
    mc /= n;
    let num = 0;
    let den = 0;
    for (const s of this.samples) {
      const dp = s.perfMs - mp;
      num += dp * (s.ctxSec - mc);
      den += dp * dp;
    }
    // Guard against a degenerate window (all samples at ~the same instant) and
    // clamp skew to a sane range (±1000 ppm) — a wild slope means bad data.
    let a = den > 1e-6 ? num / den : 0.001;
    if (Math.abs(a / 0.001 - 1) > 0.001) a = 0.001;
    this.applyFit(a, mc - a * mp);
  }

  private applyFit(a: number, b: number): void {
    if (!this.fitted) {
      this.a = a;
      this.b = b;
      this.slewOffset = 0;
      this.fitted = true;
      this.lastSlewUpdatePerf = performance.now();
      return;
    }
    // Never let the served mapping step discontinuously mid-take: absorb the
    // fit change into slewOffset, which decays at a bounded rate.
    const nowPerf = performance.now();
    const oldValue = this.a * nowPerf + this.b + this.slewOffset;
    this.a = a;
    this.b = b;
    this.slewOffset = oldValue - (a * nowPerf + b);
    this.lastSlewUpdatePerf = nowPerf;
  }

  private updateSlew(): void {
    if (this.slewOffset === 0) return;
    const nowPerf = performance.now();
    const dtSec = Math.max(0, (nowPerf - this.lastSlewUpdatePerf) / 1000);
    this.lastSlewUpdatePerf = nowPerf;
    const maxStep = SLEW_SEC_PER_SEC * dtSec;
    if (Math.abs(this.slewOffset) <= maxStep) {
      this.slewOffset = 0;
    } else {
      this.slewOffset -= Math.sign(this.slewOffset) * maxStep;
    }
  }
}
