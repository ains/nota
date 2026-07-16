/** All times are absolute seconds from audio start (float64). No ticks, no tempo map. */

/**
 * Audio metadata persisted inside the project bundle. The audio bytes live
 * beside it in the bundle as `<fileName>`, so the location is implicit and no
 * path is stored.
 */
export interface StoredAudio {
  fileName: string;
  sha256: string;
  durationSec: number;
}

/**
 * Runtime audio reference: the persisted metadata plus the resolved on-disk
 * path of the audio — the bundled copy for a saved project, or the original
 * source file for one that has not been saved yet.
 */
export interface AudioRef extends StoredAudio {
  absolutePath: string;
}

/** The four Demucs stems, in the model's output order. */
export const STEM_NAMES = ["drums", "bass", "other", "vocals"] as const;
export type StemName = (typeof STEM_NAMES)[number];

/**
 * Stem-separation output persisted inside the project bundle. The stem audio
 * files live in the bundle's `stems/` folder; like the source audio, no paths
 * are stored — the location is implicit.
 */
export interface StoredStems {
  /** Demucs model that produced the stems (e.g. "htdemucs"). */
  modelId: string;
  /** sha256 of the source audio the stems were separated from. */
  sourceSha256: string;
  /** File names inside the bundle's `stems/` folder, one per stem. */
  fileNames: Record<StemName, string>;
}

export interface Note {
  id: string;
  /** MIDI note number 0–127 */
  midi: number;
  onsetSec: number;
  durationSec: number;
  /** MIDI velocity 1–127 */
  velocity: number;
}

export interface LoopRegion {
  id: string;
  name: string;
  startSec: number;
  endSec: number;
}

/** Saved UI state so reopening restores the timeline to the same view. */
export interface ProjectView {
  /** Timeline zoom in pixels per second */
  pxPerSecond: number;
  /** Timeline seconds at the left edge of the lanes (visible region) */
  scrollSec: number;
  /** Playhead / playback position in seconds */
  playheadSec: number;
}

export interface Project {
  version: 1;
  audio: StoredAudio;
  notes: Note[];
  loopRegions: LoopRegion[];
  /** Optional — older files predate saved view state. */
  view?: ProjectView;
  /** Optional — present once stem separation has been run. */
  stems?: StoredStems;
}

export const PROJECT_VERSION = 1 as const;
/**
 * Extension of the project bundle directory (e.g. `Yesterday.nota`). On macOS
 * this is registered as a document package so Finder shows it as a single
 * file; on Windows/Linux it is an ordinary folder.
 */
export const PROJECT_FILE_EXT = "nota";
/** Name of the state file stored inside the project bundle. */
export const PROJECT_STATE_FILE = "project.json";
/** Name of the folder inside the project bundle that holds stem audio. */
export const PROJECT_STEMS_DIR = "stems";
