/**
 * Audio control settings — the music/synth/stem volumes and mutes shown in the
 * "Audio controls" drawer. Persisted in localStorage (app-level, independent of
 * any project file) so the mix carries across app restarts.
 */
import { STEM_NAMES, type StemName } from "@shared/types/project";

export interface AudioSettings {
  /** Music (audio file) playback volume, 0..1 */
  musicVolume: number;
  /** Synth (sampler) playback volume, 0..1 */
  synthVolume: number;
  audioMuted: boolean;
  synthMuted: boolean;
  /** Per-stem playback volumes, 0..1 (used once stems are separated) */
  stemVolumes: Record<StemName, number>;
  stemMutes: Record<StemName, boolean>;
}

function perStem<T>(value: T): Record<StemName, T> {
  return Object.fromEntries(STEM_NAMES.map((s) => [s, value])) as Record<
    StemName,
    T
  >;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  musicVolume: 1,
  synthVolume: 1,
  audioMuted: false,
  synthMuted: false,
  stemVolumes: perStem(1),
  stemMutes: perStem(false),
};

const KEY = "nota.audioSettings.v1";

/** Coerce an unknown value to a 0..1 volume, falling back when out of range. */
function volume(v: unknown, fallback: number): number {
  return typeof v === "number" && v >= 0 && v <= 1 ? v : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

/**
 * Read the persisted mix, falling back to defaults for anything missing,
 * malformed, or out of range. Never throws — a corrupt entry must not break
 * audio playback, so the worst case is a reset to defaults.
 */
export function loadAudioSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_AUDIO_SETTINGS };
    const p = JSON.parse(raw) as Partial<AudioSettings>;
    const stemVolumes = perStem(1);
    const stemMutes = perStem(false);
    for (const stem of STEM_NAMES) {
      stemVolumes[stem] = volume(p.stemVolumes?.[stem], 1);
      stemMutes[stem] = bool(p.stemMutes?.[stem], false);
    }
    return {
      musicVolume: volume(p.musicVolume, DEFAULT_AUDIO_SETTINGS.musicVolume),
      synthVolume: volume(p.synthVolume, DEFAULT_AUDIO_SETTINGS.synthVolume),
      audioMuted: bool(p.audioMuted, DEFAULT_AUDIO_SETTINGS.audioMuted),
      synthMuted: bool(p.synthMuted, DEFAULT_AUDIO_SETTINGS.synthMuted),
      stemVolumes,
      stemMutes,
    };
  } catch {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }
}

export function saveAudioSettings(settings: AudioSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable or full — persisting the mix is a convenience.
  }
}
