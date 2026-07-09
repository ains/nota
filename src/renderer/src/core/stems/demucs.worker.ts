/**
 * Web Worker running Demucs WASM inference (WebGPU). One worker per
 * separation job; the client terminates it when the job ends or is cancelled.
 *
 * The demucs-wasm package is the prebuilt wasm-pack bundle of demucs-rs,
 * installed from a GitHub release tarball (see package.json). Like the Rubber
 * Band package, it has no `exports` map, so the .wasm resolves via a deep
 * `?url` import and is fetched and compiled inside initWasm.
 */
import initWasm, { separate } from "demucs-wasm";
import wasmUrl from "demucs-wasm/demucs_wasm_bg.wasm?url";

export interface SeparateRequest {
  modelBytes: Uint8Array;
  modelId: string;
  stems: string[];
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
}

/** Progress events forwarded from the model's chunked forward pass. */
export type WorkerProgress =
  | { type: "chunk_started"; index: number; total: number }
  | { type: "chunk_done"; index: number; total: number };

export type WorkerResponse =
  | { type: "progress"; event: WorkerProgress }
  | {
      type: "done";
      /** Flat buffer: per stem, the full L channel then the full R channel. */
      audio: Float32Array<ArrayBuffer>;
      stemNames: string[];
      nSamples: number;
    }
  | { type: "error"; error: string };

let wasmReady: Promise<unknown> | null = null;

self.onmessage = async (e: MessageEvent<SeparateRequest>) => {
  const post = (msg: WorkerResponse, transfer: Transferable[] = []): void => {
    (self as unknown as Worker).postMessage(msg, transfer);
  };
  try {
    wasmReady ??= initWasm({ module_or_path: wasmUrl });
    await wasmReady;

    const { modelBytes, modelId, stems, left, right, sampleRate } = e.data;
    const result = await separate(
      modelBytes,
      modelId,
      stems,
      left,
      right,
      sampleRate,
      (event: WorkerProgress) => post({ type: "progress", event }),
    );
    // Read getters before take_audio(), which consumes the result.
    const stemNames: string[] = result.stem_names();
    const nSamples = result.n_samples;
    // wasm-bindgen moves the Vec<f32> into a fresh (non-shared) buffer.
    const audio = result.take_audio() as Float32Array<ArrayBuffer>;
    post({ type: "done", audio, stemNames, nSamples }, [audio.buffer]);
  } catch (err) {
    post({
      type: "error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
