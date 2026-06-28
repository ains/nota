/**
 * Owns the AudioContext, the decoded source audio, and the playback anchor
 * state (startCtx, songOffset, loop). All timeline math flows through here.
 *
 * Two audio sources back playback:
 *  - rate 1: a native AudioBufferSourceNode, started at an explicit FUTURE
 *    context time so the anchor is sample-accurate by construction (recording
 *    and normal playback rely on this).
 *  - rate ≠ 1: a Rubber Band worklet source node that time-stretches without
 *    changing pitch. It owns its own transport, so its anchor is recovered
 *    from the audible-position reports it emits; the timeline math is otherwise
 *    identical (position advances at `rate` song-seconds per wall-clock second).
 */
import { RubberBandNode } from "@ainsej/rubberband-wasm";
// Served as static assets by Vite (dev) and emitted into the build. The package
// has no `exports` map, so these deep paths resolve via `?url`. The worklet is
// registered via addModule; the wasm is fetched and compiled inside it.
import rubberbandProcessorUrl from "@ainsej/rubberband-wasm/dist/rubberband-processor.js?url";
import rubberbandWasmUrl from "@ainsej/rubberband-wasm/dist/rubberband.wasm?url";

export interface LoopSpan {
  start: number;
  end: number;
}

export type TransportState = "stopped" | "playing";

export type TransportListener = () => void;

const START_DELAY_SEC = 0.1;

/** Clamp `v` into the inclusive range [lo, hi]. */
function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

export class Transport {
  readonly ctx: AudioContext;
  private buffer: AudioBuffer | null = null;
  private src: AudioBufferSourceNode | null = null;

  /**
   * Rubber Band source node, created up front in loadAudio (so play() can stay
   * synchronous) and reused. Created per channel count (output channels are
   * fixed at construction), connected to audioGain.
   */
  private rbNode: RubberBandNode | null = null;
  private rbNodeChannels = 0;
  /** What audio is currently loaded into rbNode: "whole", "Ls:Le", or null. */
  private rbLoadedKey: string | null = null;
  /** True while the Rubber Band node is the active source. */
  private activeIsRb = false;

  /** Playback speed multiplier; pitch is preserved across all rates. */
  private rate = 1;

  readonly masterGain: GainNode;
  readonly audioGain: GainNode;
  readonly synthGain: GainNode;

  /** Music mute/volume are composed onto audioGain; keep both to recombine. */
  private audioMuted = false;
  private audioVolume = 1;

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
    this.synthGain = this.ctx.createGain();
    this.synthGain.connect(this.masterGain);
  }

  // --- state ---

  get isPlaying(): boolean {
    return this.state === "playing";
  }

  get durationSec(): number {
    return this.buffer?.duration ?? 0;
  }

  get loopSpan(): LoopSpan | null {
    return this.loop;
  }

  /** Anchor accessors for the Scheduler / Recorder mapping. */
  get anchor(): { startCtx: number; songOffset: number; rate: number } {
    return {
      startCtx: this.startCtx,
      songOffset: this.songOffset,
      rate: this.rate,
    };
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
    const buffer = await this.ctx.decodeAudioData(bytes);
    // Resume the context (load is a user gesture) and fully build the Rubber
    // Band node for this channel count BEFORE exposing the buffer, so play()
    // can stay synchronous: whenever `buffer` is set, the node is ready too.
    void this.ctx.resume();
    await this.ensureRbNode(buffer.numberOfChannels);
    this.buffer = buffer;
    this.rbLoadedKey = null; // node holds no/old audio until first play loads it
    this.emit();
    return buffer;
  }

  /**
   * Create (or recreate, on a channel-count change) the Rubber Band source
   * node and wire it to audioGain. Awaited from loadAudio; callers are
   * serialised, so no in-flight de-duplication is needed.
   */
  private async ensureRbNode(channels: number): Promise<void> {
    if (this.rbNode && this.rbNodeChannels === channels) return;
    if (this.rbNode) {
      this.rbNode.close();
      this.rbNode = null;
    }
    this.rbLoadedKey = null;
    this.rbNodeChannels = channels;
    const node = await RubberBandNode.create(this.ctx, {
      processorUrl: rubberbandProcessorUrl,
      wasmUrl: rubberbandWasmUrl,
      channelCount: channels,
    });
    node.connect(this.audioGain);
    this.rbNode = node;
  }

  // --- transport ---

  play(fromPos?: number): void {
    if (!this.buffer) return;
    const rate = this.rate;
    // Best-effort resume (play is a user gesture); the node + context are made
    // ready in loadAudio, so play() needs no awaits.
    if (this.ctx.state !== "running") void this.ctx.resume();
    this.stopInternal();

    let pos = fromPos ?? this.pausedPos;
    if (this.loop) {
      // Start inside the loop if a loop is active.
      if (pos < this.loop.start || pos >= this.loop.end) pos = this.loop.start;
    }
    pos = clamp(pos, 0, this.buffer.duration);
    this.playStartPos = pos;

    if (rate === 1) {
      this.startNative(pos);
    } else if (this.rbNode) {
      this.startRubberBand(pos, rate);
    } else {
      // Node not ready yet (shouldn't happen: loadAudio builds it before the
      // buffer is exposed). Stay stopped rather than play with the wrong pitch,
      // and emit so listeners resync (stopInternal already flipped to stopped).
      console.error(
        `Transport.play: Rubber Band node not ready. Staying stopped.`,
      );
      this.emit();
      return;
    }
    this.state = "playing";
    this.emit();
  }

  /** Native, sample-accurate path (rate 1). */
  private startNative(pos: number): void {
    const buffer = this.buffer!;
    const src = new AudioBufferSourceNode(this.ctx, { buffer });
    if (this.loop) {
      src.loop = true;
      src.loopStart = this.loop.start;
      src.loopEnd = this.loop.end;
    }
    src.connect(this.audioGain);
    src.onended = () => {
      // Natural end of (non-looping) playback.
      if (this.src === src && this.state === "playing") {
        this.src = null;
        this.finishAtEnd();
      }
    };
    this.startCtx = this.ctx.currentTime + START_DELAY_SEC;
    this.songOffset = pos;
    src.start(this.startCtx, pos);
    this.src = src;
    this.activeIsRb = false;
  }

  /** Pitch-preserving time-stretch path (rate ≠ 1); node is already created. */
  private startRubberBand(pos: number, rate: number): void {
    const node = this.rbNode!;

    // Loop a region by loading only that slice and looping the whole node
    // buffer (the node has no sub-region loop); otherwise load the whole file.
    const loop = this.loop;
    const key = loop ? `${loop.start}:${loop.end}` : "whole";
    if (key !== this.rbLoadedKey) {
      node.setBuffer(loop ? this.sliceChannels(loop) : this.buffer!);
      this.rbLoadedKey = key;
    }
    node.loop = !!loop;
    node.setTempo(rate); // speed only; pitch unchanged

    const base = loop ? loop.start : 0;
    node.seek(Math.max(0, pos - base));

    // Provisional anchor until the first audible-position report refines it.
    this.startCtx = this.ctx.currentTime;
    this.songOffset = pos;
    this.activeIsRb = true;

    let anchored = false;
    node.onposition = (sec: number): void => {
      if (anchored) return;
      anchored = true;
      // Refine the anchor to the true audible position (corrects the provisional
      // anchor for worklet startup latency); the audio and ctx clocks are the
      // same, so this single fixed anchor stays accurate for the session.
      // posAtCtxTime and the Recorder read these fields directly, and the
      // Scheduler folds in the new anchor on its next tick — so we deliberately
      // do NOT emit() here, which would resetPending() and cut in-flight voices.
      this.songOffset = base + sec;
      this.startCtx = this.ctx.currentTime;
    };
    node.onended = (): void => {
      this.activeIsRb = false;
      this.finishAtEnd();
    };
    node.play();
  }

  /**
   * Extract a loop region as per-channel PCM (context sample rate). The slice
   * length is rounded to the nearest whole sample of the region duration so the
   * node's loop period matches the Scheduler's loop length (Le − Ls) to within
   * half a sample — avoiding the per-pass drift that floor/ceil boundaries
   * (up to +2 samples) would accumulate over a long looped session.
   */
  private sliceChannels(loop: LoopSpan): Float32Array[] {
    const buffer = this.buffer!;
    const sr = buffer.sampleRate;
    const from = clamp(Math.round(loop.start * sr), 0, buffer.length);
    const len = Math.round((loop.end - loop.start) * sr);
    const to = Math.min(buffer.length, from + len);
    const out: Float32Array[] = [];
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      out.push(buffer.getChannelData(ch).slice(from, to));
    }
    return out;
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
    pos = clamp(pos, 0, this.durationSec);
    if (this.state === "playing") {
      this.play(pos);
    } else {
      this.pausedPos = pos;
      this.emit();
    }
  }

  setLoop(loop: LoopSpan | null): void {
    this.loop = loop;
    if (this.state === "playing") {
      // Restart from current position (folded into the new loop if needed).
      this.play(this.position);
    } else {
      if (loop) this.pausedPos = loop.start;
      this.emit();
    }
  }

  /**
   * Set the playback speed (pitch preserved). The timeline position stays in
   * original-audio seconds; only the time→position scale changes. Restarts
   * playback in place so the new source and a fresh anchor take over.
   */
  setRate(rate: number): void {
    if (rate === this.rate) return;
    // Capture the current position under the OLD rate before switching.
    const pos = this.position;
    this.rate = rate;
    if (this.state === "playing") {
      this.play(pos);
    } else {
      this.emit();
    }
  }

  setAudioMuted(muted: boolean): void {
    this.audioMuted = muted;
    this.applyAudioGain();
  }

  /** Music (audio file) playback volume (0..1), independent of mute. */
  setMusicVolume(volume: number): void {
    this.audioVolume = volume;
    this.applyAudioGain();
  }

  private applyAudioGain(): void {
    this.audioGain.gain.value = this.audioMuted ? 0 : this.audioVolume;
  }

  /** Synth (sampler) playback volume (0..1). */
  setSynthVolume(volume: number): void {
    this.synthGain.gain.value = volume;
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
    // Position advances at `rate` original-seconds per wall-clock second.
    const e = this.songOffset + (c - this.startCtx) * this.rate;
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

  /** Settle state when playback reaches the end: rest at the end and stop. */
  private finishAtEnd(): void {
    this.pausedPos = this.buffer?.duration ?? 0;
    this.state = "stopped";
    this.emit();
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
    if (this.rbNode && this.activeIsRb) {
      this.rbNode.onposition = null;
      this.rbNode.onended = null;
      this.rbNode.pause();
    }
    this.activeIsRb = false;
    this.state = "stopped";
  }
}
