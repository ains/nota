import type { JSX } from "react";
import { useSessionStore } from "../../state/sessionStore";
import { useProjectStore } from "../../state/projectStore";
import {
  importMidi,
  exportMidi,
  startRecording,
  stopRecording,
} from "../../state/appActions";

/** Options row shown directly above the piano roll (toggled with it). */
export function RollOptionsBar(): JSX.Element {
  const isRecording = useSessionStore((s) => s.isRecording);
  const hasAudio = useProjectStore((s) => s.audio !== null);
  const hasNotes = useProjectStore((s) => s.notes.length > 0);

  return (
    <div className="roll-options-bar">
      <button
        onClick={() => void importMidi()}
        disabled={!hasAudio}
        title="Add notes from a .mid file"
      >
        Import MIDI
      </button>
      <button
        onClick={() => void exportMidi()}
        disabled={!hasNotes}
        title="Export transcription as .mid"
      >
        Export MIDI
      </button>
      {isRecording ? (
        <button
          className="tb-rec active"
          onClick={stopRecording}
          title="Stop recording"
        >
          ● REC
        </button>
      ) : (
        <button
          className="tb-rec"
          onClick={startRecording}
          disabled={!hasAudio}
          title="Record (R)"
        >
          ● Rec
        </button>
      )}
    </div>
  );
}
