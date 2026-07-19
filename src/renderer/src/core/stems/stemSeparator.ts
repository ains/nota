/**
 * Stem separation client with two engines behind one job interface:
 *
 * - Native: the Rust-built demucs CLI from demucs-rs, bundled with production
 *   builds (and dev builds after `npm run build:demucs`). Much faster; runs
 *   in the main process on the source audio file (see src/main/demucsCli.ts).
 * - WASM: fetches/caches the model weights and runs WebGPU inference in a
 *   dedicated worker (see demucs.worker.ts). Used when the native binary is
 *   absent (web build, dev without the binary) or fails to run.
 *
 * One job at a time; cancellation aborts the download, tears the worker down
 * mid-inference, or kills the native process.
 */
import { STEM_NAMES, type StemName } from "@shared/types/project";
import { cacheModel, evictModel, loadCachedModel } from "./modelCache";
import type { WorkerResponse } from "./demucs.worker";
import DemucsWorker from "./demucs.worker?worker";

/** The 4-stem HTDemucs model (drums / bass / other / vocals). */
export const STEM_MODEL_ID = "htdemucs";
export const STEM_MODEL_SIZE_MB = 84;
/** Same weights source the demucs-rs registry points at. */
const STEM_MODEL_URL =
  "https://huggingface.co/set-soft/audio_separation/resolve/main/Demucs/htdemucs.safetensors";

export interface StemSeparationProgress {
  phase: "download" | "separate";
  /** Completed fraction 0..1, or null while indeterminate. */
  progress: number | null;
}

export interface SeparatedStem {
  name: StemName;
  /** Stereo PCM at the source buffer's sample rate. */
  left: Float32Array<ArrayBuffer>;
  right: Float32Array<ArrayBuffer>;
}

export interface StemSeparationJob {
  promise: Promise<SeparatedStem[]>;
  cancel(): void;
}

export class StemSeparationCancelled extends Error {
  constructor() {
    super("Stem separation cancelled");
  }
}

/** Whether the bundled native demucs CLI can run separation (Electron only). */
export function nativeStemSeparationAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    window.nota?.nativeStemSeparationAvailable() === true
  );
}

/** Whether the in-renderer WASM fallback can run (needs WebGPU). */
function webgpuSeparationSupported(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

/** Whether this environment can run Demucs at all (native CLI or WebGPU). */
export function stemSeparationSupported(): boolean {
  return nativeStemSeparationAvailable() || webgpuSeparationSupported();
}

async function downloadModel(
  signal: AbortSignal,
  onProgress: (progress: number | null) => void,
): Promise<ArrayBuffer> {
  const res = await fetch(STEM_MODEL_URL, { signal });
  if (!res.ok || !res.body) {
    throw new Error(`Model download failed (HTTP ${res.status})`);
  }
  const contentLength = res.headers.get("content-length");
  const total = contentLength ? parseInt(contentLength, 10) : null;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(total ? received / total : null);
  }
  const buf = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.length;
  }
  return buf.buffer;
}

/**
 * Ensure the model weights are available locally, downloading and caching
 * them on first use.
 */
async function ensureModelWeights(
  signal: AbortSignal,
  onProgress: (progress: number | null) => void,
): Promise<ArrayBuffer> {
  const cached = await loadCachedModel(STEM_MODEL_ID);
  if (cached) return cached;
  const bytes = await downloadModel(signal, onProgress);
  try {
    await cacheModel(STEM_MODEL_ID, bytes);
  } catch {
    // Caching is a convenience; separation can proceed with the bytes in hand.
  }
  return bytes;
}

/**
 * Run the native demucs CLI on the source audio file and decode the stem
 * WAVs it produces back to PCM at `sampleRate` (the CLI writes them at the
 * source file's rate, which can differ from the AudioContext's).
 */
async function separateNative(
  sourcePath: string,
  sampleRate: number,
  signal: AbortSignal,
  onProgress: (p: StemSeparationProgress) => void,
): Promise<SeparatedStem[]> {
  // Phases are driven by the CLI's stderr: it announces either the model
  // download (first run) or, with the weights cached, goes straight to work.
  const unsubscribe = window.nota.onNativeStemProgress((phase) =>
    onProgress({ phase, progress: null }),
  );
  const result = await window.nota
    .separateStemsNative(sourcePath, [...STEM_NAMES], STEM_MODEL_ID)
    .finally(unsubscribe);
  if (signal.aborted || result.status === "cancelled") {
    throw new StemSeparationCancelled();
  }
  if (result.status === "error") throw new Error(result.message);

  const stems = await Promise.all(
    STEM_NAMES.map(async (name): Promise<SeparatedStem> => {
      const file = result.files.find((f) => f.fileName === `${name}.wav`);
      if (!file) throw new Error(`Separation did not produce the ${name} stem`);
      // decodeAudioData resamples to the OfflineAudioContext's rate, so the
      // returned PCM matches what the WASM path would have produced.
      const ctx = new OfflineAudioContext(2, 1, sampleRate);
      const decoded = await ctx.decodeAudioData(file.bytes);
      const left = decoded.getChannelData(0);
      const right =
        decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : left.slice();
      return { name, left, right };
    }),
  );
  if (signal.aborted) throw new StemSeparationCancelled();
  return stems;
}

/** Run the WebGPU WASM path: ensure weights, then infer in a worker. */
async function separateWasm(
  buffer: AudioBuffer,
  signal: AbortSignal,
  onProgress: (p: StemSeparationProgress) => void,
  registerWorker: (worker: Worker | null) => void,
): Promise<SeparatedStem[]> {
  onProgress({ phase: "download", progress: null });
  let modelBytes: ArrayBuffer;
  try {
    modelBytes = await ensureModelWeights(signal, (progress) =>
      onProgress({ phase: "download", progress }),
    );
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new StemSeparationCancelled();
    }
    throw err;
  }
  if (signal.aborted) throw new StemSeparationCancelled();

  // Demucs expects stereo; duplicate the channel for mono sources. Copies
  // are transferred to the worker, so the AudioBuffer stays playable.
  const left = buffer.getChannelData(0).slice();
  const right =
    buffer.numberOfChannels > 1
      ? buffer.getChannelData(1).slice()
      : left.slice();

  onProgress({ phase: "separate", progress: null });
  return await new Promise<SeparatedStem[]>((resolve, reject) => {
    const w = new DemucsWorker();
    registerWorker(w);
    const finish = (fn: () => void): void => {
      registerWorker(null);
      w.terminate();
      fn();
    };
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === "progress") {
        const { index, total } = msg.event;
        const done = msg.event.type === "chunk_done" ? index + 1 : index;
        onProgress({
          phase: "separate",
          progress: total > 0 ? done / total : null,
        });
      } else if (msg.type === "done") {
        const { audio, stemNames, nSamples } = msg;
        const stems: SeparatedStem[] = [];
        stemNames.forEach((name, i) => {
          if (!(STEM_NAMES as readonly string[]).includes(name)) return;
          const base = i * 2 * nSamples;
          stems.push({
            name: name as StemName,
            left: audio.subarray(base, base + nSamples),
            right: audio.subarray(base + nSamples, base + 2 * nSamples),
          });
        });
        if (stems.length !== STEM_NAMES.length) {
          finish(() =>
            reject(
              new Error(
                `Separation returned unexpected stems: ${stemNames.join(", ")}`,
              ),
            ),
          );
          return;
        }
        finish(() => resolve(stems));
      } else {
        // Weights that fail to parse would fail forever; evict so the next
        // attempt re-downloads them.
        if (msg.error.includes("Failed to load model")) {
          void evictModel(STEM_MODEL_ID).catch(() => {});
        }
        finish(() => reject(new Error(msg.error)));
      }
    };
    w.onerror = (err) => {
      finish(() =>
        reject(new Error(err.message || "Separation worker failed")),
      );
    };
    const bytes = new Uint8Array(modelBytes);
    w.postMessage(
      {
        modelBytes: bytes,
        modelId: STEM_MODEL_ID,
        stems: [...STEM_NAMES],
        left,
        right,
        sampleRate: buffer.sampleRate,
      },
      [bytes.buffer, left.buffer, right.buffer],
    );
  });
}

/**
 * Separate `buffer` into the four Demucs stems. Returns a job whose promise
 * resolves with per-stem stereo PCM (at buffer.sampleRate), or rejects with
 * StemSeparationCancelled if cancel() is called first. When the native CLI is
 * bundled and `sourcePath` is given it does the work; otherwise (or if the
 * native run fails) the WebGPU WASM path takes over.
 */
export function startStemSeparation(
  buffer: AudioBuffer,
  onProgress: (p: StemSeparationProgress) => void,
  /** Absolute path of the source audio file; enables the native CLI path. */
  sourcePath?: string,
): StemSeparationJob {
  const abort = new AbortController();
  let worker: Worker | null = null;

  const run = async (): Promise<SeparatedStem[]> => {
    if (nativeStemSeparationAvailable() && sourcePath) {
      try {
        return await separateNative(
          sourcePath,
          buffer.sampleRate,
          abort.signal,
          onProgress,
        );
      } catch (err) {
        if (
          err instanceof StemSeparationCancelled ||
          !webgpuSeparationSupported()
        ) {
          throw err;
        }
        // A bundled binary can still be unusable (no GPU driver, damaged
        // install, source file gone); the WASM path is a working second try.
        console.warn("Native separation failed; falling back to WebGPU:", err);
        if (abort.signal.aborted) throw new StemSeparationCancelled();
      }
    }
    if (!webgpuSeparationSupported()) {
      throw new Error("Stem separation requires WebGPU, which is unavailable");
    }
    return await separateWasm(buffer, abort.signal, onProgress, (w) => {
      worker = w;
    });
  };

  // cancel() must settle the job immediately even while an engine is mid-run;
  // racing against an externally rejected promise keeps both engines honest.
  let rejectCancelled!: (err: Error) => void;
  const cancelled = new Promise<never>((_, reject) => {
    rejectCancelled = reject;
  });

  return {
    promise: Promise.race([run(), cancelled]),
    cancel: () => {
      abort.abort();
      if (worker) {
        worker.terminate();
        worker = null;
      }
      void window.nota?.cancelNativeStemSeparation().catch(() => {});
      rejectCancelled(new StemSeparationCancelled());
    },
  };
}
