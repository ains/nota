import { buildPyramid } from "./peaks";

interface BuildRequest {
  channelData: Float32Array[];
  sampleRate: number;
}

self.onmessage = (e: MessageEvent<BuildRequest>) => {
  const { channelData, sampleRate } = e.data;
  const pyramid = buildPyramid(channelData, sampleRate);
  const transfer = pyramid.levels.map((l) => l.buffer);
  (self as unknown as Worker).postMessage(pyramid, transfer);
};
