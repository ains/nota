import { useEffect, useRef } from "react";
import type { JSX } from "react";
import { useSessionStore } from "../../state/sessionStore";
import { useProjectStore } from "../../state/projectStore";
import {
  formatTime,
  zoomToSlider,
  sliderToZoom,
} from "../../core/timeline/viewport";
import {
  backToLibrary,
  saveProject,
  togglePlay,
  stopTransport,
  commitTake,
  discardTake,
  setZoom,
  selectMidiDevice,
  retryMidi,
  getEngineRef,
} from "../../state/appActions";

function TimeReadout(): JSX.Element {
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const engine = getEngineRef();
    let raf = 0;
    const tick = (): void => {
      if (ref.current)
        ref.current.textContent = formatTime(engine.transport.position);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <span ref={ref} className="time-readout" />;
}

export function TransportBar(): JSX.Element {
  const isPlaying = useSessionStore((s) => s.isPlaying);
  const isRecording = useSessionStore((s) => s.isRecording);
  const takeNotes = useSessionStore((s) => s.takeNotes);
  const midiDevices = useSessionStore((s) => s.midiDevices);
  const activeMidiId = useSessionStore((s) => s.activeMidiDeviceId);
  const showVolumeDrawer = useSessionStore((s) => s.showVolumeDrawer);
  const setShowVolumeDrawer = useSessionStore((s) => s.setShowVolumeDrawer);
  const pxPerSecond = useSessionStore((s) => s.viewport.pxPerSecond);
  const midiError = useSessionStore((s) => s.midiError);
  const hasAudio = useProjectStore((s) => s.audio !== null);
  const dirty = useProjectStore((s) => s.dirty);
  const projectPath = useProjectStore((s) => s.projectPath);

  const hasTake = takeNotes.length > 0 && !isRecording;

  return (
    <div className="transport-bar">
      <div className="tb-group">
        <button
          className="tb-back"
          onClick={() => void backToLibrary()}
          title="Back to library"
        >
          ← Library
        </button>
        <button
          onClick={() => void saveProject()}
          disabled={!hasAudio}
          title="Save project (⌘S)"
        >
          Save{dirty ? " •" : ""}
        </button>
      </div>

      <div className="tb-group">
        <button
          onClick={togglePlay}
          disabled={!hasAudio}
          className="tb-play"
          title="Space"
        >
          {isPlaying ? "⏸" : "⏵"}
        </button>
        <button
          onClick={stopTransport}
          disabled={!hasAudio}
          title="Stop (return to start)"
        >
          ⏹
        </button>
        {hasTake && (
          <>
            <button
              className="tb-commit"
              onClick={commitTake}
              title="Add take to transcription"
            >
              Keep Take ({takeNotes.length})
            </button>
            <button onClick={discardTake} title="Discard take">
              Discard
            </button>
          </>
        )}
        <TimeReadout />
      </div>

      <div className="tb-group tb-right">
        <label className="tb-slider" title="Zoom">
          Zoom
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={zoomToSlider(pxPerSecond)}
            onChange={(e) => setZoom(sliderToZoom(Number(e.target.value)))}
          />
        </label>
      </div>

      <div className="tb-group tb-right">
        <button
          className={showVolumeDrawer ? "tb-mixer active" : "tb-mixer"}
          onClick={() => setShowVolumeDrawer(!showVolumeDrawer)}
          title={showVolumeDrawer ? "Hide volume panel" : "Show volume panel"}
        >
          🎚 Audio controls
        </button>
        {midiError ? (
          <button
            className="tb-midi-error"
            onClick={() => void retryMidi()}
            title={`${midiError} — click to retry`}
          >
            ⚠ MIDI unavailable — retry
          </button>
        ) : (
          <select
            value={activeMidiId ?? ""}
            onChange={(e) => selectMidiDevice(e.target.value || null)}
            title="MIDI input device"
          >
            {midiDevices.length === 0 && (
              <option value="">No MIDI input</option>
            )}
            {midiDevices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {projectPath && (
        <span className="tb-path">{projectPath.split("/").pop()}</span>
      )}
    </div>
  );
}
