import { describe, it, expect } from "vitest";
import { demucsPhaseForLine } from "../src/main/demucsStderr";

// The expected lines mirror what demucs-cli eprintln!s when stderr is a pipe
// (its indicatif progress bars are hidden off-TTY).
describe("demucsPhaseForLine", () => {
  it("maps the model download announcement to the download phase", () => {
    expect(demucsPhaseForLine("Downloading htdemucs (84 MB) ...")).toBe(
      "download",
    );
  });

  it("maps every post-download pipeline step to the separate phase", () => {
    const lines = [
      "Loading cached model: htdemucs",
      "Reading /Users/me/song.mp3",
      "Loading model...",
      "Pre-compiling GPU shaders (first run only)...",
      "Separating...",
    ];
    for (const line of lines) {
      expect(demucsPhaseForLine(line), line).toBe("separate");
    }
  });

  it("tolerates the indented formatting the CLI uses for detail lines", () => {
    expect(
      demucsPhaseForLine("  Wrote /tmp/nota-stems-x/drums.wav"),
    ).toBeNull();
    expect(
      demucsPhaseForLine("  882000 samples, 20.0s, 44100 Hz, stereo"),
    ).toBe(null);
  });

  it("ignores chatter and blank lines", () => {
    expect(demucsPhaseForLine("Done!")).toBeNull();
    expect(demucsPhaseForLine("")).toBeNull();
  });
});
