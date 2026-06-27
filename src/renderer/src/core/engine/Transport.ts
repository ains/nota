/**
 * Owns the AudioContext, the decoded source audio, and the playback anchor
 * state (startCtx, songOffset, loop). All timeline math flows through here.
 *
 * Anchor rule: playback always starts against an explicit FUTURE context time;
 * timeline consumers map against that anchor rather than "currentTime at the
 * moment play() was called" so speed-aware playhead/scheduler math is stable.
 */

export interface LoopSpan {
  start: number;
  end: number;
}

export type TransportState = "stopped" | "playing";

export type TransportListener = () => void;

export const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

const START_DELAY_SEC = 0.1;

export class Transport {
  readonly ctx: AudioContext;
  private buffer: AudioBuffer | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private mediaSrc: MediaElementAudioSourceNode | null = null;
  private objectUrl: string | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  readonly masterGain: GainNode;
  readonly audioGain: GainNode;

  private state: TransportState = "stopped";
  private startCtx = 0;
  private songOffset = 0;
  private loop: LoopSpan | null = null;
  /** Where the playhead rests while stopped. */
  private pausedPos = 0;
  /** Timeline position when the current playback session started. */
  private playStartPos = 0;
  private playbackSpeed = 1;
  private listeners = new Set<TransportListener>();

  constructor() {
    this.ctx = new AudioContext({ latencyHint: "interactive" });
    this.masterGain = this.ctx.createGain();
    this.masterGain.connect(this.ctx.destination);
    this.audioGain = this.ctx.createGain();
    this.audioGain.connect(this.masterGain);
  }

  // --- state ---

  get isPlaying(): boolean {
    return this.state === "playing";
  }

  get audioBuffer(): AudioBuffer | null {
    return this.buffer;
  }

  get speed(): number {
    return this.playbackSpeed;
  }

  get durationSec(): number {
    return this.buffer?.duration ?? 0;
  }

  get loopSpan(): LoopSpan | null {
    return this.loop;
  }

  /** Anchor accessors for the Scheduler / Recorder mapping. */
  get anchor(): { startCtx: number; songOffset: number } {
    return { startCtx: this.startCtx, songOffset: this.songOffset };
  }

  onChange(fn: TransportListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  // --- audio loading ---

  async loadAudio(bytes: ArrayBuffer): Promise<AudioBuffer> {
    this.stopInternal();
    this.revokeObjectUrl();
    this.pausedPos = 0;
    this.playStartPos = 0;
    // decodeAudioData detaches the buffer; callers must not reuse `bytes`.
    const copy = bytes.slice(0);
    this.buffer = await this.ctx.decodeAudioData(bytes);
    this.objectUrl = URL.createObjectURL(new Blob([copy]));
    this.audioEl = new Audio(this.objectUrl);
    this.audioEl.preload = "auto";
    this.audioEl.preservesPitch = true;
    this.audioEl.playbackRate = this.playbackSpeed;
    this.audioEl.addEventListener("ended", this.handleEnded);
    this.audioEl.addEventListener("timeupdate", this.enforceLoop);
    this.mediaSrc = this.ctx.createMediaElementSource(this.audioEl);
    this.mediaSrc.connect(this.audioGain);
    this.emit();
    return this.buffer;
  }

  // --- transport ---

  async play(fromPos?: number): Promise<void> {
    if (!this.buffer) return;
    if (this.ctx.state !== "running") await this.ctx.resume();
    this.stopInternal();

    let pos = fromPos ?? this.pausedPos;
    if (this.loop) {
      // Start inside the loop if a loop is active.
      if (pos < this.loop.start || pos >= this.loop.end) pos = this.loop.start;
    }
    pos = Math.min(Math.max(pos, 0), this.buffer.duration);

    const el = this.audioEl;
    if (!el) return;
    el.pause();
    el.currentTime = pos;
    el.playbackRate = this.playbackSpeed;
    el.preservesPitch = true;

    this.startCtx = this.ctx.currentTime + START_DELAY_SEC;
    this.playStartPos = pos;
    this.songOffset = pos;
    this.startTimer = setTimeout(() => {
      void el.play().catch((err: unknown) => {
        console.error("Audio playback failed:", err);
        if (this.audioEl === el) {
          this.state = "stopped";
          this.emit();
        }
      });
      this.startTimer = null;
    }, START_DELAY_SEC * 1000);
    this.state = "playing";
    this.emit();
  }

  pause(): void {
    if (this.state !== "playing") return;
    this.stopInternal();
    this.snapPlayheadToPlayStart();
    this.emit();
  }

  stop(): void {
    const wasPlaying = this.state === "playing";
    this.stopInternal();
    this.pausedPos = this.loop ? this.loop.start : 0;
    if (wasPlaying || this.pausedPos !== 0) this.emit();
  }

  seek(pos: number): void {
    pos = Math.min(Math.max(pos, 0), this.durationSec);
    if (this.state === "playing") {
      void this.play(pos);
    } else {
      this.pausedPos = pos;
      this.emit();
    }
  }

  setLoop(loop: LoopSpan | null): void {
    this.loop = loop;
    if (this.state === "playing") {
      // Restart from current position (folded into the new loop if needed).
      void this.play(this.posAtCtxTime(this.ctx.currentTime));
    } else {
      if (loop) this.pausedPos = loop.start;
      this.emit();
    }
  }

  setAudioMuted(muted: boolean): void {
    this.audioGain.gain.value = muted ? 0 : 1;
  }

  setPlaybackSpeed(speed: number): void {
    const clamped = Math.min(4, Math.max(0.25, speed));
    if (clamped === this.playbackSpeed) return;
    const wasPlaying = this.state === "playing";
    const pos = this.position;
    this.playbackSpeed = clamped;
    if (this.audioEl) {
      this.audioEl.playbackRate = clamped;
      this.audioEl.preservesPitch = true;
    }
    if (wasPlaying) {
      void this.play(pos);
    } else {
      this.pausedPos = pos;
      this.emit();
    }
  }

  /** Master output volume (0..1), applied to audio + synth alike. */
  setVolume(volume: number): void {
    this.masterGain.gain.value = volume;
  }

  // --- timeline math ---

  /**
   * Audio-timeline position of the sample with context time `c`, folding loop
   * passes. Formula (3): only folds once the first pass crosses the loop end.
   */
  posAtCtxTime(c: number): number {
    if (this.state !== "playing") return this.pausedPos;
    const e = this.songOffset + (c - this.startCtx) * this.playbackSpeed;
    if (!this.loop) return Math.min(Math.max(e, 0), this.durationSec);
    const { start: Ls, end: Le } = this.loop;
    if (e <= Le) return Math.max(e, 0);
    return Ls + ((e - Ls) % (Le - Ls));
  }

  /** Current playhead position using the plain context clock. */
  get position(): number {
    return this.posAtCtxTime(this.ctx.currentTime);
  }

  private snapPlayheadToPlayStart(): void {
    this.pausedPos = this.loop ? this.loop.start : this.playStartPos;
  }

  private handleEnded = (): void => {
    if (this.state !== "playing") return;
    this.pausedPos = this.buffer?.duration ?? 0;
    this.state = "stopped";
    this.emit();
  };

  private enforceLoop = (): void => {
    if (this.state !== "playing" || !this.loop || !this.audioEl) return;
    if (this.audioEl.currentTime >= this.loop.end) {
      this.audioEl.currentTime = this.loop.start;
    }
  };

  private stopInternal(): void {
    if (this.startTimer) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
    if (this.audioEl) this.audioEl.pause();
    this.state = "stopped";
  }

  private revokeObjectUrl(): void {
    if (this.audioEl) {
      this.audioEl.removeEventListener("ended", this.handleEnded);
      this.audioEl.removeEventListener("timeupdate", this.enforceLoop);
      this.audioEl.pause();
      this.audioEl.src = "";
      this.audioEl = null;
    }
    if (this.mediaSrc) {
      this.mediaSrc.disconnect();
      this.mediaSrc = null;
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }
}
