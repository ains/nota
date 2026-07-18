/**
 * Thin wrapper over raw Web MIDI. We deliberately avoid WEBMIDI.js — the one
 * thing that matters here is the event's high-resolution `timeStamp`
 * (performance.now() domain, stamped by Chromium near OS receipt), which
 * survives JS handler jitter untouched.
 */

export interface MidiNoteEvent {
  kind: "on" | "off";
  midi: number;
  /** 1–127 for note-on; 0 for note-off */
  velocity: number;
  /** performance.now()-domain timestamp from the MIDIMessageEvent */
  perfMs: number;
}

export interface MidiDeviceInfo {
  id: string;
  name: string;
}

type NoteListener = (e: MidiNoteEvent) => void;
type DevicesListener = (devices: MidiDeviceInfo[]) => void;

const INIT_TIMEOUT_MS = 3000;

/**
 * Resolves once it is safe to issue the first requestMIDIAccess().
 *
 * In Electron the renderer boots within the first few hundred ms of the
 * browser process's life, so a request fired on React mount races Chromium's
 * platform MIDI bring-up. The browser process holds ONE MidiManager,
 * initialized on first use with no timeout (media/midi); if that first
 * initialization wedges against process startup, every later request — every
 * JS retry — parks in its pending-client queue forever, and on macOS the
 * manager is deliberately never torn down (crbug.com/718140), so only an app
 * relaunch recovers. Deferring the first request until the window is on
 * screen keeps it clear of the startup window where that wedge occurs.
 *
 * In a plain browser (and in vitest) the bridge is absent and this resolves
 * immediately — there the browser process has been alive long before the
 * page, so the race cannot happen.
 */
async function whenSafeToRequestMidi(): Promise<void> {
  if (typeof window === "undefined") return;
  await window.nota?.whenWindowShown?.();
}

export class MidiService {
  private access: MIDIAccess | null = null;
  private pending: Promise<void> | null = null;
  private activeInputId: string | null = null;
  private noteListeners = new Set<NoteListener>();
  private deviceListeners = new Set<DevicesListener>();
  private disconnectListeners = new Set<() => void>();

  async init(timeoutMs = INIT_TIMEOUT_MS): Promise<void> {
    if (this.access) return;
    if (!this.pending) this.pending = this.requestAccess();
    const result = await Promise.race([
      this.pending,
      new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), timeoutMs),
      ),
    ]);
    if (result === "timeout") {
      throw new Error(
        "Timed out waiting for MIDI access — it may still connect in the background; if MIDI stays unavailable, restart the app",
      );
    }
  }

  /**
   * Single-flight: concurrent init() calls await the same request, and a
   * response that arrives after init() already timed out is still adopted
   * (listeners are notified via adopt → emitDevices).
   */
  private async requestAccess(): Promise<void> {
    try {
      await whenSafeToRequestMidi();
      const access = await navigator.requestMIDIAccess({ sysex: true });
      if (!this.access) this.adopt(access);
    } catch (err) {
      console.warn("requestMIDIAccess failed:", err);
      throw err;
    } finally {
      this.pending = null;
    }
  }

  private adopt(access: MIDIAccess): void {
    this.access = access;
    access.onstatechange = () => {
      let activeDeviceDisconnected = false;
      if (this.activeInputId && !access.inputs.has(this.activeInputId)) {
        // Active device unplugged mid-session.
        this.activeInputId = null;
        activeDeviceDisconnected = true;
      }

      this.selectFirstAvailableInput();

      this.rebind();
      this.emitDevices();
      if (activeDeviceDisconnected) {
        for (const fn of this.disconnectListeners) fn();
      }
    };
    // Default to the first available input.
    this.selectFirstAvailableInput();
    this.rebind();
    this.emitDevices();
    console.log(
      "Web MIDI ready — inputs:",
      this.devices.map((d) => d.name),
    );
  }

  get isReady(): boolean {
    return this.access !== null;
  }

  get devices(): MidiDeviceInfo[] {
    if (!this.access) return [];
    return [...this.access.inputs.values()].map((i) => ({
      id: i.id,
      name: i.name ?? `Input ${i.id}`,
    }));
  }

  get activeDeviceId(): string | null {
    return this.activeInputId;
  }

  selectDevice(id: string | null): void {
    this.activeInputId = id;
    this.rebind();
    this.emitDevices();
  }

  onNote(fn: NoteListener): () => void {
    this.noteListeners.add(fn);
    return () => this.noteListeners.delete(fn);
  }

  onDevicesChanged(fn: DevicesListener): () => void {
    this.deviceListeners.add(fn);
    return () => this.deviceListeners.delete(fn);
  }

  onActiveDeviceDisconnected(fn: () => void): () => void {
    this.disconnectListeners.add(fn);
    return () => this.disconnectListeners.delete(fn);
  }

  private rebind(): void {
    if (!this.access) return;
    for (const input of this.access.inputs.values()) {
      input.onmidimessage =
        input.id === this.activeInputId ? (e) => this.handle(e) : null;
    }
  }

  private selectFirstAvailableInput(): void {
    if (this.activeInputId || !this.access) return;
    const first = this.access.inputs.values().next();
    if (!first.done) this.activeInputId = first.value.id;
  }

  private handle(e: MIDIMessageEvent): void {
    const data = e.data;
    if (!data || data.length < 3) return;
    const status = data[0] & 0xf0;
    const midi = data[1];
    const velocity = data[2];
    let event: MidiNoteEvent | null = null;
    if (status === 0x90 && velocity > 0) {
      event = { kind: "on", midi, velocity, perfMs: e.timeStamp };
    } else if (status === 0x80 || (status === 0x90 && velocity === 0)) {
      event = { kind: "off", midi, velocity: 0, perfMs: e.timeStamp };
    }
    if (event) {
      for (const fn of this.noteListeners) fn(event);
    }
  }

  private emitDevices(): void {
    const devices = this.devices;
    for (const fn of this.deviceListeners) fn(devices);
  }
}
