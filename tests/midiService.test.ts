import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MidiService } from "@renderer/core/engine/MidiService";

interface FakeInput {
  id: string;
  name: string;
  onmidimessage: unknown;
}

function fakeAccess(inputs: FakeInput[]): MIDIAccess {
  const map = new Map(inputs.map((i) => [i.id, i]));
  return {
    inputs: map,
    onstatechange: null,
  } as unknown as MIDIAccess;
}

describe("MidiService init resilience", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("resolves normally when access is granted promptly", async () => {
    const access = fakeAccess([
      { id: "in1", name: "Keys", onmidimessage: null },
    ]);
    vi.stubGlobal("navigator", {
      requestMIDIAccess: () => Promise.resolve(access),
    });
    const svc = new MidiService();
    await svc.init(1000);
    expect(svc.isReady).toBe(true);
    expect(svc.devices).toEqual([{ id: "in1", name: "Keys" }]);
    expect(svc.activeDeviceId).toBe("in1");
  });

  it("activates and binds an input connected after starting with none", async () => {
    const access = fakeAccess([]);
    vi.stubGlobal("navigator", {
      requestMIDIAccess: () => Promise.resolve(access),
    });
    const svc = new MidiService();
    const notes = vi.fn();
    svc.onNote(notes);

    await svc.init(1000);
    expect(svc.activeDeviceId).toBeNull();

    const input: FakeInput = {
      id: "in1",
      name: "Keys",
      onmidimessage: null,
    };
    (access.inputs as unknown as Map<string, MIDIInput>).set(
      input.id,
      input as unknown as MIDIInput,
    );
    access.onstatechange?.(new Event("statechange") as MIDIConnectionEvent);

    expect(svc.activeDeviceId).toBe("in1");
    expect(input.onmidimessage).toBeTypeOf("function");

    (input.onmidimessage as (event: MIDIMessageEvent) => void)({
      data: new Uint8Array([0x90, 60, 100]),
      timeStamp: 42,
    } as MIDIMessageEvent);
    expect(notes).toHaveBeenCalledWith({
      kind: "on",
      midi: 60,
      velocity: 100,
      perfMs: 42,
    });
  });

  it("throws a timeout error when the request never settles", async () => {
    vi.stubGlobal("navigator", {
      requestMIDIAccess: () => new Promise(() => {}),
    });
    const svc = new MidiService();
    const p = svc.init(1000);
    const assertion = expect(p).rejects.toThrow(/Timed out/);
    await vi.advanceTimersByTimeAsync(1100);
    await assertion;
    expect(svc.isReady).toBe(false);
  });

  it("adopts a late-resolving request after a timeout and notifies listeners", async () => {
    const access = fakeAccess([
      { id: "in1", name: "Keys", onmidimessage: null },
    ]);
    let resolveLate: (a: MIDIAccess) => void = () => {};
    vi.stubGlobal("navigator", {
      requestMIDIAccess: () =>
        new Promise<MIDIAccess>((r) => (resolveLate = r)),
    });
    const svc = new MidiService();
    const seen: string[][] = [];
    svc.onDevicesChanged((devices) => seen.push(devices.map((d) => d.name)));

    const p = svc.init(1000);
    const assertion = expect(p).rejects.toThrow(/Timed out/);
    await vi.advanceTimersByTimeAsync(1100);
    await assertion;

    // The original request finally settles — service adopts it.
    resolveLate(access);
    await vi.advanceTimersByTimeAsync(0);
    expect(svc.isReady).toBe(true);
    expect(seen.at(-1)).toEqual(["Keys"]);
  });

  it("defers the request until the Electron window-shown gate resolves", async () => {
    const access = fakeAccess([
      { id: "in1", name: "Keys", onmidimessage: null },
    ]);
    let calls = 0;
    vi.stubGlobal("navigator", {
      requestMIDIAccess: () => {
        calls++;
        return Promise.resolve(access);
      },
    });
    let shown: () => void = () => {};
    vi.stubGlobal("window", {
      nota: {
        whenWindowShown: () => new Promise<void>((r) => (shown = r)),
      },
    });

    const svc = new MidiService();
    const p = svc.init(1000);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(0); // gated: window not shown yet

    shown();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    await p;
    expect(svc.isReady).toBe(true);
  });

  it("does not issue a second request while one is pending", async () => {
    let calls = 0;
    vi.stubGlobal("navigator", {
      requestMIDIAccess: () => {
        calls++;
        return new Promise(() => {});
      },
    });
    const svc = new MidiService();
    const p1 = expect(svc.init(500)).rejects.toThrow();
    const p2 = expect(svc.init(500)).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(600);
    await Promise.all([p1, p2]);
    expect(calls).toBe(1);
  });
});
