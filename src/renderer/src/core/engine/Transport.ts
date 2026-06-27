/**
 * Owns the AudioContext, the decoded source audio, and the playback anchor
 * state (startCtx, songOffset, loop). All timeline math flows through here.
 *
 * Anchor rule: playback always starts with an explicit FUTURE context time
 * passed to source.start(startCtx, songOffset) — never "currentTime at the
 * moment start() was called" — so the anchor is sample-accurate by
 * construction.
 */

export interface LoopSpan {
  start: number;
  end: number;
}

export type TransportState = "stopped" | "playing";

export type TransportListener = () => void;

const START_DELAY_SEC = 0.1;

export class Transport {
  readonly ctx: AudioContext;
  private buffer: AudioBuffer | null = null;
  private src: AudioBufferSourceNode | null = null;
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
    this.pausedPos = 0;
    this.playStartPos = 0;
    // decodeAudioData detaches the buffer; callers must not reuse `bytes`.
    this.buffer = await this.ctx.decodeAudioData(bytes);
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

    const src = new AudioBufferSourceNode(this.ctx, { buffer: this.buffer });
    if (this.loop) {
      src.loop = true;
      src.loopStart = this.loop.start;
      src.loopEnd = this.loop.end;
    }
    src.connect(this.audioGain);
    src.onended = () => {
      // Natural end of (non-looping) playback.
      if (this.src === src && this.state === "playing") {
        this.pausedPos = this.buffer?.duration ?? 0;
        this.src = null;
        this.state = "stopped";
        this.emit();
      }
    };

    this.startCtx = this.ctx.currentTime + START_DELAY_SEC;
    this.playStartPos = pos;
    this.songOffset = pos;
    src.start(this.startCtx, pos);
    this.src = src;
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
    const e = this.songOffset + (c - this.startCtx);
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

  private stopInternal(): void {
    if (this.src) {
      this.src.onended = null;
      try {
        this.src.stop();
      } catch {
        // already stopped
      }
      this.src.disconnect();
      this.src = null;
    }
    this.state = "stopped";
  }
}
