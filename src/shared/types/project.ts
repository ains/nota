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
