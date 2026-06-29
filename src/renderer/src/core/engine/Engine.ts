/**
 * The TimingEngine singleton: owns the AudioContext (via Transport) and wires
 * ClockSync, MIDI input, the sampler, the lookahead scheduler and recording.
 * Framework-free; React subscribes through the state layer.
 */
import { ClockSync } from "./ClockSync";
import { Transport } from "./Transport";
import { MidiService, type MidiNoteEvent } from "./MidiService";
import { Sampler } from "./Sampler";
import { Scheduler } from "./Scheduler";
import { NoteEventMapper, type CapturedNote } from "./Recorder";
import { Monitor } from "./monitor";
import { RecordingSession } from "./recording";

/**
 * A raw-MIDI handler invoked from handleMidi in registration order. Returning
 * true consumes the event, stopping further routing. Monitoring registers
 * first (and never consumes); recording registers last, so it only sees taps
 * an earlier handler didn't claim.
 */
export type MidiHandler = (e: MidiNoteEvent) => boolean | void;

type Listener = () => void;

export class Engine {
  readonly transport: Transport;
  readonly clockSync: ClockSync;
  readonly midi: MidiService;
  readonly sampler: Sampler;
  readonly scheduler: Scheduler;
  readonly mapper: NoteEventMapper;
  readonly monitor: Monitor;
  readonly recording: RecordingSession;

  private listeners = new Set<Listener>();
  private midiHandlers = new Set<MidiHandler>();

  constructor() {
    this.transport = new Transport();
    this.clockSync = new ClockSync(this.transport.ctx);
    this.midi = new MidiService();
    this.sampler = new Sampler(this.transport.ctx, this.transport.synthGain);
    this.scheduler = new Scheduler(this.transport, this.sampler);
    this.mapper = new NoteEventMapper(this.clockSync, this.transport);
    // Monitor registers its handler first, so live audio runs ahead of any
    // consuming handler and is never swallowed.
    this.monitor = new Monitor(this.sampler, (fn) =>
      this.registerMidiHandler(fn),
    );
    this.recording = new RecordingSession(this.transport, this.mapper, (fn) =>
      this.registerMidiHandler(fn),
    );

    this.midi.onNote((e) => this.handleMidi(e));
    this.transport.onChange(() => {
      void window.nota?.setPowerSaveBlocker(this.transport.isPlaying);
    });
    this.clockSync.start();
  }

  /** Set when requestMIDIAccess failed; null when MIDI is available. */
  midiError: string | null = null;

  async init(): Promise<void> {
    const ATTEMPTS = 3;

    // I really don't understand why this is racy,
    // but we have to wait a little bit before initializing midi

    setTimeout(async () => {
      for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
        try {
          await this.midi.init();
          this.midiError = null;
          break;
        } catch (err) {
          this.midiError = err instanceof Error ? err.message : String(err);
          console.warn(
            `Web MIDI init attempt ${attempt}/${ATTEMPTS} failed:`,
            this.midiError,
          );
        }
      }
      this.emit();
    }, 500);
  }

  /** Retry MIDI access (e.g. from the UI after fixing permissions). */
  async retryMidi(): Promise<void> {
    await this.init();
    this.emit();
  }

  // --- observation ---

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  /**
   * Register a raw-MIDI handler invoked from handleMidi (after live
   * monitoring). Return true from the handler to consume the event and stop
   * it being routed to recording. Returns an unregister fn.
   */
  registerMidiHandler(fn: MidiHandler): () => void {
    this.midiHandlers.add(fn);
    return () => this.midiHandlers.delete(fn);
  }

  // --- monitoring ---

  setMonitoring(on: boolean): void {
    this.monitor.setEnabled(on);
  }

  // --- recording ---

  startRecording(onNote: (note: CapturedNote) => void): void {
    this.recording.start(onNote);
    this.emit();
  }

  stopRecording(): void {
    if (!this.recording.isActive) return;
    this.recording.stop();
    this.emit();
  }

  get isRecording(): boolean {
    return this.recording.isActive;
  }

  // --- MIDI routing ---

  /**
   * Dispatch a raw MIDI event to the registered handlers in order (monitoring,
   * recording). A handler that returns true consumes the event and stops
   * further routing.
   */
  private handleMidi(e: MidiNoteEvent): void {
    for (const handler of this.midiHandlers) {
      if (handler(e) === true) return;
    }
  }
}

let instance: Engine | null = null;

export function getEngine(): Engine {
  if (!instance) instance = new Engine();
  return instance;
}
