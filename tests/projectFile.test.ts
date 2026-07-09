import { describe, it, expect } from "vitest";
import {
  serializeProject,
  deserializeProject,
  ProjectParseError,
} from "@renderer/persistence/projectFile";

const sample = {
  audio: {
    fileName: "song.mp3",
    sha256: "abc123",
    durationSec: 215.3289473,
  },
  notes: [
    { id: "n1", midi: 60, onsetSec: 1.2345678, durationSec: 0.5, velocity: 90 },
  ],
  loopRegions: [{ id: "r1", name: "Intro", startSec: 0, endSec: 8 }],
};

describe("project file round-trip", () => {
  it("round-trips exactly (float equality)", () => {
    const json = serializeProject(sample);
    const back = deserializeProject(json);
    expect(back).toEqual(sample);
    expect(back.notes[0].onsetSec).toBe(1.2345678);
  });

  it("never persists a runtime audio path", () => {
    // The audio lives inside the bundle, so a stray absolutePath on the
    // runtime ref must not leak into the saved state file.
    const audio = { ...sample.audio, absolutePath: "/private/source.mp3" };
    const json = serializeProject({ ...sample, audio });
    expect(json).not.toContain("absolutePath");
    expect(json).not.toContain("/private/source.mp3");
  });

  it("rejects newer versions", () => {
    const json = serializeProject(sample).replace(
      '"version": 1',
      '"version": 99',
    );
    expect(() => deserializeProject(json)).toThrow(ProjectParseError);
  });

  it("rejects non-JSON", () => {
    expect(() => deserializeProject("not json")).toThrow(ProjectParseError);
  });

  it("rejects JSON that is not a project", () => {
    expect(() => deserializeProject('{"hello": "world"}')).toThrow(
      ProjectParseError,
    );
  });

  it("defaults missing optional arrays", () => {
    const json = JSON.stringify({ version: 1, audio: sample.audio, notes: [] });
    const back = deserializeProject(json);
    expect(back.loopRegions).toEqual([]);
  });

  it("round-trips saved view state (zoom, scroll, playhead)", () => {
    const withView = {
      ...sample,
      view: { pxPerSecond: 137.5, scrollSec: 12.25, playheadSec: 42.5 },
    };
    const back = deserializeProject(serializeProject(withView));
    expect(back.view).toEqual(withView.view);
  });

  it("leaves view undefined for files without it", () => {
    const json = JSON.stringify({
      version: 1,
      audio: sample.audio,
      notes: [],
    });
    expect(deserializeProject(json).view).toBeUndefined();
  });

  it("ignores a malformed view block", () => {
    const json = JSON.stringify({
      version: 1,
      audio: sample.audio,
      notes: [],
      view: { pxPerSecond: "oops" },
    });
    expect(deserializeProject(json).view).toBeUndefined();
  });

  it("round-trips stem metadata", () => {
    const withStems = {
      ...sample,
      stems: {
        modelId: "htdemucs",
        sourceSha256: "abc123",
        fileNames: {
          drums: "drums.wav",
          bass: "bass.wav",
          other: "other.wav",
          vocals: "vocals.wav",
        },
      },
    };
    const back = deserializeProject(serializeProject(withStems));
    expect(back.stems).toEqual(withStems.stems);
  });

  it("leaves stems undefined for files without them", () => {
    expect(deserializeProject(serializeProject(sample)).stems).toBeUndefined();
  });

  it("ignores a stems block with a missing stem file", () => {
    const json = JSON.stringify({
      version: 1,
      audio: sample.audio,
      notes: [],
      stems: {
        modelId: "htdemucs",
        sourceSha256: "abc123",
        fileNames: { drums: "drums.wav" },
      },
    });
    expect(deserializeProject(json).stems).toBeUndefined();
  });
});
