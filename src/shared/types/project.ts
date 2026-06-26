/** All times are absolute seconds from audio start (float64). No ticks, no tempo map. */

export interface AudioRef {
  fileName: string;
  absolutePath: string;
  sha256: string;
  durationSec: number;
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

export interface Project {
  version: 1;
  audio: AudioRef;
  notes: Note[];
  loopRegions: LoopRegion[];
}

export const PROJECT_VERSION = 1 as const;
export const PROJECT_FILE_EXT = "nota";
