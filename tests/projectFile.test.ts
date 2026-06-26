import { describe, it, expect } from "vitest";
import {
  serializeProject,
  deserializeProject,
  ProjectParseError,
} from "@renderer/persistence/projectFile";

const sample = {
  audio: {
    fileName: "song.mp3",
    absolutePath: "/music/song.mp3",
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
});
