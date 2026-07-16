import { describe, it, expect } from "vitest";
import { encodeWavPcm16 } from "@renderer/core/stems/wav";

function view(buf: ArrayBuffer): DataView {
  return new DataView(buf);
}

function ascii(v: DataView, offset: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++)
    s += String.fromCharCode(v.getUint8(offset + i));
  return s;
}

describe("encodeWavPcm16", () => {
  it("writes a valid stereo 16-bit RIFF header", () => {
    const left = new Float32Array([0, 0.5, -0.5, 1]);
    const right = new Float32Array([1, -1, 0.25, 0]);
    const buf = encodeWavPcm16([left, right], 44100);
    const v = view(buf);

    expect(ascii(v, 0, 4)).toBe("RIFF");
    expect(ascii(v, 8, 4)).toBe("WAVE");
    expect(ascii(v, 12, 4)).toBe("fmt ");
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(2); // channels
    expect(v.getUint32(24, true)).toBe(44100);
    expect(v.getUint16(34, true)).toBe(16); // bit depth
    expect(ascii(v, 36, 4)).toBe("data");
    expect(v.getUint32(40, true)).toBe(4 * 2 * 2); // frames × channels × 2B
    expect(buf.byteLength).toBe(44 + 16);
    expect(v.getUint32(4, true)).toBe(buf.byteLength - 8);
  });

  it("interleaves channels and round-trips sample values", () => {
    const left = new Float32Array([0.5, -0.25]);
    const right = new Float32Array([-0.5, 1]);
    const v = view(encodeWavPcm16([left, right], 48000));

    const sample = (i: number): number => v.getInt16(44 + i * 2, true);
    // Frame 0: L then R
    expect(sample(0) / 0x7fff).toBeCloseTo(0.5, 3);
    expect(sample(1) / 0x8000).toBeCloseTo(-0.5, 3);
    // Frame 1
    expect(sample(2) / 0x8000).toBeCloseTo(-0.25, 3);
    expect(sample(3)).toBe(0x7fff);
  });

  it("clamps out-of-range samples instead of wrapping", () => {
    const v = view(encodeWavPcm16([new Float32Array([2, -2])], 44100));
    expect(v.getInt16(44, true)).toBe(0x7fff);
    expect(v.getInt16(46, true)).toBe(-0x8000);
  });
});
