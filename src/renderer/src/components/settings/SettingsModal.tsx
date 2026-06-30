import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useSessionStore } from "../../state/sessionStore";
import { selectMidiDevice, retryMidi } from "../../state/appActions";

/**
 * Application settings, shown as a modal over the editor. Changes are staged
 * locally and only applied to the engine on Save; Close (or Escape, or a
 * backdrop click) discards them. For now the sole setting is the MIDI input.
 */
export function SettingsModal(): JSX.Element {
  const midiDevices = useSessionStore((s) => s.midiDevices);
  const activeMidiId = useSessionStore((s) => s.activeMidiDeviceId);
  const midiError = useSessionStore((s) => s.midiError);
  const setShowSettings = useSessionStore((s) => s.setShowSettings);

  // Staged MIDI selection, seeded from the live device and applied on Save.
  const [draftMidiId, setDraftMidiId] = useState<string | null>(activeMidiId);

  // Follow the live device when it changes underneath us (e.g. a retry that
  // auto-selects a port, or a hardware (dis)connect) — but not the user's own
  // unsaved pick, which leaves activeMidiId untouched until Save. This
  // render-phase resync is React's recommended alternative to a syncing effect.
  const [syncedMidiId, setSyncedMidiId] = useState<string | null>(activeMidiId);
  if (activeMidiId !== syncedMidiId) {
    setSyncedMidiId(activeMidiId);
    setDraftMidiId(activeMidiId);
  }

  const close = (): void => setShowSettings(false);

  const save = (): void => {
    selectMidiDevice(draftMidiId);
    setShowSettings(false);
  };

  // Escape closes (discards). Capture phase so it pre-empts the editor's global
  // Escape→stop shortcut while the modal is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setShowSettings(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [setShowSettings]);

  return (
    <div className="dialog-backdrop" onMouseDown={close}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2>Settings</h2>

        <div className="settings-row">
          <label htmlFor="midi-input">MIDI input</label>
          {midiError ? (
            <div className="settings-midi-error">
              <span className="dialog-warn">MIDI unavailable</span>
              <button onClick={() => void retryMidi()}>Retry</button>
            </div>
          ) : (
            <select
              id="midi-input"
              value={draftMidiId ?? ""}
              onChange={(e) => setDraftMidiId(e.target.value || null)}
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

        <div className="dialog-actions settings-actions">
          <button onClick={close}>Close</button>
          <button className="primary" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
