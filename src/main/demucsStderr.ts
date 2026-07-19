/**
 * Interpreting the demucs CLI's stderr. When stderr is a pipe the CLI's
 * interactive progress bars are hidden and it prints one plain line per
 * pipeline step, which is enough to tell apart the two long-running phases
 * the UI reports: the one-time model download and the separation itself.
 */
import type { NativeStemPhase } from "../shared/ipc";

/** Everything from the moment the cached model starts loading counts as
 * "separate": model load, first-run shader warmup and inference all happen
 * with the weights already on disk. */
const SEPARATE_PREFIXES = [
  "Loading cached model",
  "Reading ",
  "Loading model",
  "Pre-compiling",
  "Separating",
];

/** Map one stderr line to the phase it announces, or null for chatter. */
export function demucsPhaseForLine(line: string): NativeStemPhase | null {
  const trimmed = line.trim();
  if (trimmed.startsWith("Downloading ")) return "download";
  if (SEPARATE_PREFIXES.some((p) => trimmed.startsWith(p))) return "separate";
  return null;
}
