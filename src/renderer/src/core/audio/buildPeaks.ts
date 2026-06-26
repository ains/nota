import type { PeakPyramid } from "./peaks";
import PeaksWorker from "./peaks.worker?worker";

/** Build the peak pyramid off the main thread. */
export function buildPeaksAsync(buffer: AudioBuffer): Promise<PeakPyramid> {
  return new Promise((resolve, reject) => {
    const worker = new PeaksWorker();
    // Copy channel data; the AudioBuffer stays usable for playback.
    const channelData: Float32Array[] = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      channelData.push(buffer.getChannelData(c).slice());
    }
    worker.onmessage = (e: MessageEvent<PeakPyramid>) => {
      resolve(e.data);
      worker.terminate();
    };
    worker.onerror = (err) => {
      reject(err);
      worker.terminate();
    };
    worker.postMessage(
      { channelData, sampleRate: buffer.sampleRate },
      channelData.map((c) => c.buffer),
    );
  });
}
