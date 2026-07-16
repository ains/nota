import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  loadAudioSettings,
  saveAudioSettings,
  DEFAULT_AUDIO_SETTINGS,
} from "@renderer/persistence/audioSettings";

/** Minimal in-memory localStorage stub (tests run in node, no DOM). */
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

const KEY = "nota.audioSettings.v1";

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("audio settings persistence", () => {
  it("returns defaults when nothing is stored", () => {
    expect(loadAudioSettings()).toEqual(DEFAULT_AUDIO_SETTINGS);
  });

  it("round-trips a saved mix", () => {
    const mix = {
      musicVolume: 0.6,
      synthVolume: 0.25,
      audioMuted: true,
      synthMuted: false,
      stemVolumes: { drums: 0.5, bass: 1, other: 0.75, vocals: 0 },
      stemMutes: { drums: false, bass: true, other: false, vocals: false },
    };
    saveAudioSettings(mix);
    expect(loadAudioSettings()).toEqual(mix);
  });

  it("defaults stem mix fields missing from an older stored blob", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ musicVolume: 0.4, synthVolume: 0.8 }),
    );
    const loaded = loadAudioSettings();
    expect(loaded.musicVolume).toBe(0.4);
    expect(loaded.stemVolumes).toEqual(DEFAULT_AUDIO_SETTINGS.stemVolumes);
    expect(loaded.stemMutes).toEqual(DEFAULT_AUDIO_SETTINGS.stemMutes);
  });

  it("clamps out-of-range and non-numeric volumes back to defaults", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ musicVolume: 5, synthVolume: "loud" }),
    );
    const loaded = loadAudioSettings();
    expect(loaded.musicVolume).toBe(DEFAULT_AUDIO_SETTINGS.musicVolume);
    expect(loaded.synthVolume).toBe(DEFAULT_AUDIO_SETTINGS.synthVolume);
  });

  it("keeps valid fields and defaults only the bad ones", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ musicVolume: 0.3, synthMuted: "yes" }),
    );
    const loaded = loadAudioSettings();
    expect(loaded.musicVolume).toBe(0.3);
    expect(loaded.synthMuted).toBe(false);
  });

  it("falls back to defaults on malformed JSON", () => {
    localStorage.setItem(KEY, "{not json");
    expect(loadAudioSettings()).toEqual(DEFAULT_AUDIO_SETTINGS);
  });
});
