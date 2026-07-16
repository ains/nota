/**
 * Stem separation client: fetches/caches the Demucs model weights and runs
 * inference in a dedicated worker (see demucs.worker.ts). One job at a time;
 * cancellation aborts the download or tears the worker down mid-inference.
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

/** Whether this environment can run Demucs at all (WASM needs WebGPU). */
export function stemSeparationSupported(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
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
 * Separate `buffer` into the four Demucs stems. Returns a job whose promise
 * resolves with per-stem stereo PCM (at buffer.sampleRate), or rejects with
 * StemSeparationCancelled if cancel() is called first.
 */
export function startStemSeparation(
  buffer: AudioBuffer,
  onProgress: (p: StemSeparationProgress) => void,
): StemSeparationJob {
  const abort = new AbortController();
  let worker: Worker | null = null;
  let rejectJob: ((err: Error) => void) | null = null;

  const promise = (async (): Promise<SeparatedStem[]> => {
    if (!stemSeparationSupported()) {
      throw new Error("Stem separation requires WebGPU, which is unavailable");
    }

    onProgress({ phase: "download", progress: null });
    let modelBytes: ArrayBuffer;
    try {
      modelBytes = await ensureModelWeights(abort.signal, (progress) =>
        onProgress({ phase: "download", progress }),
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new StemSeparationCancelled();
      }
      throw err;
    }
    if (abort.signal.aborted) throw new StemSeparationCancelled();

    // Demucs expects stereo; duplicate the channel for mono sources. Copies
    // are transferred to the worker, so the AudioBuffer stays playable.
    const left = buffer.getChannelData(0).slice();
    const right =
      buffer.numberOfChannels > 1
        ? buffer.getChannelData(1).slice()
        : left.slice();

    onProgress({ phase: "separate", progress: null });
    return await new Promise<SeparatedStem[]>((resolve, reject) => {
      rejectJob = reject;
      const w = new DemucsWorker();
      worker = w;
      const finish = (fn: () => void): void => {
        worker = null;
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
  })();

  return {
    promise,
    cancel: () => {
      abort.abort();
      if (worker) {
        worker.terminate();
        worker = null;
      }
      rejectJob?.(new StemSeparationCancelled());
    },
  };
}
