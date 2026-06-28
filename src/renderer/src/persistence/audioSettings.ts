/**
 * Audio control settings — the music/synth volumes and mutes shown in the
 * "Audio controls" drawer. Persisted in localStorage (app-level, independent of
 * any project file) so the mix carries across app restarts.
 */
export interface AudioSettings {
  /** Music (audio file) playback volume, 0..1 */
  musicVolume: number;
  /** Synth (sampler) playback volume, 0..1 */
  synthVolume: number;
  audioMuted: boolean;
  synthMuted: boolean;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  musicVolume: 1,
  synthVolume: 1,
  audioMuted: false,
  synthMuted: false,
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
    return {
      musicVolume: volume(p.musicVolume, DEFAULT_AUDIO_SETTINGS.musicVolume),
      synthVolume: volume(p.synthVolume, DEFAULT_AUDIO_SETTINGS.synthVolume),
      audioMuted: bool(p.audioMuted, DEFAULT_AUDIO_SETTINGS.audioMuted),
      synthMuted: bool(p.synthMuted, DEFAULT_AUDIO_SETTINGS.synthMuted),
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
