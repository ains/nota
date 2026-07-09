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
   * Separated stem buffers (one stereo AudioBuffer per stem, in stem order).
   * When set, playback uses one source per stem — each through its own gain
   * into audioGain, so the "Music" volume stays the group control — instead
   * of the single source over `buffer`. `buffer` remains the timeline's
   * source of truth (duration, peaks); stem lengths may differ by a few
   * samples after the separator's internal resampling round-trip.
   */
  private stemBuffers: AudioBuffer[] | null = null;
  private stemSrcs: AudioBufferSourceNode[] = [];
  private stemGains: GainNode[] = [];
  private stemVolumes: number[] = [];
  private stemMutes: boolean[] = [];

  /**
   * Rubber Band source node, created up front in loadAudio (so play() can stay
   * synchronous) and reused. Created per channel count (output channels are
   * fixed at construction), connected to audioGain.
   */
  private rbNode: RubberBandNode | null = null;
  private rbNodeChannels = 0;
  /** Whether the current rbNode was built for stem (multi-pair) playback. */
  private rbForStems = false;
  /**
   * Fan-out for stem playback through the Rubber Band node: the node carries
   * all stems as one interleaved multi-channel stream, and this splitter (plus
   * per-stem mergers) routes each stereo pair through its stem gain so volume
   * changes stay live while time-stretched.
   */
  private rbSplitter: ChannelSplitterNode | null = null;
  private rbMergers: ChannelMergerNode[] = [];
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
  /** Synth mute/volume are composed onto synthGain; keep both to recombine. */
  private synthMuted = false;
  private synthVolume = 1;

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

  /** The decoded source audio (input for stem separation). */
  get audioBuffer(): AudioBuffer | null {
    return this.buffer;
  }

  /** True when separated stems are loaded and drive playback. */
  get stemsActive(): boolean {
    return this.stemBuffers !== null;
  }

  /** The loaded stem buffers (stem order), or null when none are loaded. */
  getStemBuffers(): AudioBuffer[] | null {
    return this.stemBuffers;
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
    this.clearStems();
    // decodeAudioData detaches the buffer; callers must not reuse `bytes`.
    const buffer = await this.ctx.decodeAudioData(bytes);
    // Resume the context (load is a user gesture) and fully build the Rubber
    // Band node for this channel count BEFORE exposing the buffer, so play()
    // can stay synchronous: whenever `buffer` is set, the node is ready too.
    void this.ctx.resume();
    await this.ensureRbNode(buffer.numberOfChannels, false);
    this.buffer = buffer;
    this.rbLoadedKey = null; // node holds no/old audio until first play loads it
    this.emit();
    return buffer;
  }

  /**
   * Load separated stems (one stereo buffer per stem, in stem order) and
   * switch playback over to them, or clear them with null to fall back to the
   * plain source audio. Like loadAudio, the Rubber Band node is rebuilt before
   * the switch is visible so play() stays synchronous. Restarts in place when
   * called mid-playback.
   */
  async setStems(buffers: AudioBuffer[] | null): Promise<void> {
    const pos = this.position;
    const wasPlaying = this.state === "playing";
    if (buffers === null) {
      if (!this.stemBuffers) return;
      this.stopInternal();
      this.clearStems();
      if (this.buffer) {
        await this.ensureRbNode(this.buffer.numberOfChannels, false);
      }
    } else {
      this.stopInternal();
      this.clearStems();
      // All stems flow through one Rubber Band node as interleaved stereo
      // pairs; per-stem gains hang off the fan-out built in ensureRbNode.
      await this.ensureRbNode(buffers.length * 2, true);
      this.stemBuffers = buffers;
      this.stemGains = buffers.map((_, i) => {
        const gain = this.ctx.createGain();
        gain.gain.value = this.stemGainValue(i);
        gain.connect(this.audioGain);
        return gain;
      });
      this.connectRbFanOut();
    }
    this.rbLoadedKey = null;
    if (wasPlaying) {
      this.play(pos);
    } else {
      this.emit();
    }
  }

  private clearStems(): void {
    for (const gain of this.stemGains) gain.disconnect();
    this.stemGains = [];
    this.stemBuffers = null;
  }

  /**
   * Create (or recreate, on a channel-count or wiring change) the Rubber Band
   * source node. Plain playback wires it straight to audioGain; stem playback
   * splits its interleaved output into stereo pairs, one merger per stem
   * (connected to the stem gains in connectRbFanOut once those exist).
   * Awaited from loadAudio/setStems; callers are serialised, so no in-flight
   * de-duplication is needed.
   */
  private async ensureRbNode(
    channels: number,
    forStems: boolean,
  ): Promise<void> {
    if (
      this.rbNode &&
      this.rbNodeChannels === channels &&
      this.rbForStems === forStems
    ) {
      return;
    }
    if (this.rbNode) {
      this.rbNode.close();
      this.rbNode = null;
    }
    this.teardownRbFanOut();
    this.rbLoadedKey = null;
    this.rbNodeChannels = channels;
    this.rbForStems = forStems;
    const node = await RubberBandNode.create(this.ctx, {
      processorUrl: rubberbandProcessorUrl,
      wasmUrl: rubberbandWasmUrl,
      channelCount: channels,
    });
    if (forStems) {
      const splitter = this.ctx.createChannelSplitter(channels);
      node.connect(splitter);
      this.rbSplitter = splitter;
      for (let i = 0; i < channels / 2; i++) {
        const merger = this.ctx.createChannelMerger(2);
        splitter.connect(merger, 2 * i, 0);
        splitter.connect(merger, 2 * i + 1, 1);
        this.rbMergers.push(merger);
      }
    } else {
      node.connect(this.audioGain);
    }
    this.rbNode = node;
  }

  /** Connect the per-stem mergers to the (freshly created) stem gains. */
  private connectRbFanOut(): void {
    this.rbMergers.forEach((merger, i) => {
      const gain = this.stemGains[i];
      if (gain) merger.connect(gain);
    });
  }

  private teardownRbFanOut(): void {
    this.rbSplitter?.disconnect();
    this.rbSplitter = null;
    for (const merger of this.rbMergers) merger.disconnect();
    this.rbMergers = [];
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
    if (this.stemBuffers) {
      this.startNativeStems(pos);
      return;
    }
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

  /**
   * Native path with stems: one source per stem, each through its own gain.
   * All sources share the same explicit future start time and offset, so they
   * stay sample-locked; the first one reports the natural end (stems are the
   * same length to within a few samples).
   */
  private startNativeStems(pos: number): void {
    const buffers = this.stemBuffers!;
    this.startCtx = this.ctx.currentTime + START_DELAY_SEC;
    this.songOffset = pos;
    const srcs = buffers.map((buffer, i) => {
      const src = new AudioBufferSourceNode(this.ctx, { buffer });
      if (this.loop) {
        src.loop = true;
        src.loopStart = this.loop.start;
        src.loopEnd = Math.min(this.loop.end, buffer.duration);
      }
      src.connect(this.stemGains[i]);
      src.start(this.startCtx, Math.min(pos, buffer.duration));
      return src;
    });
    srcs[0].onended = () => {
      if (this.stemSrcs[0] === srcs[0] && this.state === "playing") {
        this.stopStemSrcs();
        this.finishAtEnd();
      }
    };
    this.stemSrcs = srcs;
    this.activeIsRb = false;
  }

  private stopStemSrcs(): void {
    for (const src of this.stemSrcs) {
      src.onended = null;
      try {
        src.stop();
      } catch {
        // already stopped
      }
      src.disconnect();
    }
    this.stemSrcs = [];
  }

  /** Pitch-preserving time-stretch path (rate ≠ 1); node is already created. */
  private startRubberBand(pos: number, rate: number): void {
    const node = this.rbNode!;

    // Loop a region by loading only that slice and looping the whole node
    // buffer (the node has no sub-region loop); otherwise load the whole file.
    const loop = this.loop;
    const stems = this.stemBuffers !== null;
    const key =
      (stems ? "stems:" : "") + (loop ? `${loop.start}:${loop.end}` : "whole");
    if (key !== this.rbLoadedKey) {
      if (stems) {
        node.setBuffer(this.stemChannels(loop));
      } else {
        node.setBuffer(loop ? this.sliceChannels(loop) : this.buffer!);
      }
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

  /**
   * All stem channels as one flat array (stem-major: L, R per stem) for the
   * Rubber Band node — the whole stems, or a loop's slice cut with the same
   * rounding as sliceChannels.
   */
  private stemChannels(loop: LoopSpan | null): Float32Array[] {
    const out: Float32Array[] = [];
    for (const buffer of this.stemBuffers!) {
      for (let ch = 0; ch < 2; ch++) {
        // Stems are stereo by construction; fall back to channel 0 if not.
        const data = buffer.getChannelData(
          Math.min(ch, buffer.numberOfChannels - 1),
        );
        if (loop) {
          const sr = buffer.sampleRate;
          const from = clamp(Math.round(loop.start * sr), 0, buffer.length);
          const len = Math.round((loop.end - loop.start) * sr);
          const to = Math.min(buffer.length, from + len);
          out.push(data.slice(from, to));
        } else {
          out.push(data);
        }
      }
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

  /** Per-stem volume (0..1), independent of mute. Composed onto audioGain. */
  setStemVolume(index: number, volume: number): void {
    this.stemVolumes[index] = volume;
    this.applyStemGain(index);
  }

  setStemMuted(index: number, muted: boolean): void {
    this.stemMutes[index] = muted;
    this.applyStemGain(index);
  }

  private stemGainValue(index: number): number {
    return this.stemMutes[index] ? 0 : (this.stemVolumes[index] ?? 1);
  }

  private applyStemGain(index: number): void {
    const gain = this.stemGains[index];
    if (gain) gain.gain.value = this.stemGainValue(index);
  }

  /** Synth (sampler) playback volume (0..1), independent of mute. */
  setSynthVolume(volume: number): void {
    this.synthVolume = volume;
    this.applySynthGain();
  }

  setSynthMuted(muted: boolean): void {
    this.synthMuted = muted;
    this.applySynthGain();
  }

  private applySynthGain(): void {
    this.synthGain.gain.value = this.synthMuted ? 0 : this.synthVolume;
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
    this.stopStemSrcs();
    if (this.rbNode && this.activeIsRb) {
      this.rbNode.onposition = null;
      this.rbNode.onended = null;
      this.rbNode.pause();
    }
    this.activeIsRb = false;
    this.state = "stopped";
  }
}
