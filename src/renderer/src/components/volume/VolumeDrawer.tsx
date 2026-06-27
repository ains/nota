import type { JSX } from "react";
import { useSessionStore } from "../../state/sessionStore";
import {
  setMusicVolume,
  setSynthVolume,
  setAudioMuted,
  setSynthMuted,
} from "../../state/appActions";

function VolumeRow({
  label,
  value,
  onChange,
  enabled,
  onToggle,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}): JSX.Element {
  return (
    <div className="vd-row">
      <div className="vd-row-label">
        <label className="vd-toggle">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onToggle(e.target.checked)}
          />
          {label}
        </label>
        <span>{Math.round(value * 100)}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        disabled={!enabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function VolumeDrawer(): JSX.Element {
  const musicVolume = useSessionStore((s) => s.musicVolume);
  const synthVolume = useSessionStore((s) => s.synthVolume);
  const audioMuted = useSessionStore((s) => s.audioMuted);
  const synthMuted = useSessionStore((s) => s.synthMuted);
  const setShowVolumeDrawer = useSessionStore((s) => s.setShowVolumeDrawer);

  return (
    <aside className="volume-drawer">
      <div className="vd-header">
        <span>Audio controls</span>
        <button
          className="vd-close"
          onClick={() => setShowVolumeDrawer(false)}
          title="Hide volume panel"
        >
          ×
        </button>
      </div>
      <VolumeRow
        label="Music"
        value={musicVolume}
        onChange={setMusicVolume}
        enabled={!audioMuted}
        onToggle={(on) => setAudioMuted(!on)}
      />
      <VolumeRow
        label="Synth"
        value={synthVolume}
        onChange={setSynthVolume}
        enabled={!synthMuted}
        onToggle={(on) => setSynthMuted(!on)}
      />
    </aside>
  );
}
