import { useEffect, useRef } from "react";
import type { JSX } from "react";
import { useSessionStore } from "../../state/sessionStore";
import { useProjectStore } from "../../state/projectStore";
import { formatTime } from "../../core/timeline/viewport";
import { PLAYBACK_SPEEDS } from "../../constants";
import {
  backToLibrary,
  saveProject,
  togglePlay,
  stopTransport,
  selectMidiDevice,
  retryMidi,
  setPlaybackRate,
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
  const midiDevices = useSessionStore((s) => s.midiDevices);
  const activeMidiId = useSessionStore((s) => s.activeMidiDeviceId);
  const showVolumeDrawer = useSessionStore((s) => s.showVolumeDrawer);
  const setShowVolumeDrawer = useSessionStore((s) => s.setShowVolumeDrawer);
  const playbackRate = useSessionStore((s) => s.playbackRate);
  const midiError = useSessionStore((s) => s.midiError);
  const hasAudio = useProjectStore((s) => s.audio !== null);
  const dirty = useProjectStore((s) => s.dirty);

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
        <select
          className="tb-speed"
          value={playbackRate}
          onChange={(e) => setPlaybackRate(Number(e.target.value))}
          disabled={!hasAudio}
          title="Playback speed (pitch preserved)"
        >
          {PLAYBACK_SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
        <TimeReadout />
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
    </div>
  );
}
