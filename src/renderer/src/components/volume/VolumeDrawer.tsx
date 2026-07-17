import type { JSX } from "react";
import { useSessionStore } from "../../state/sessionStore";
import {
  setMusicVolume,
  setSynthVolume,
  setAudioMuted,
  setSynthMuted,
} from "../../state/appActions";
import { VolumeRow } from "./VolumeRow";
import { StemControls } from "./StemControls";

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
          onClick={(e) => {
            setShowVolumeDrawer(false);
            e.currentTarget.blur();
          }}
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
      <StemControls />
    </aside>
  );
}
