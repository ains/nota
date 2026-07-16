import type { JSX } from "react";
import { STEM_NAMES, type StemName } from "@shared/types/project";
import { useSessionStore } from "../../state/sessionStore";
import { useProjectStore } from "../../state/projectStore";
import {
  separateStems,
  cancelStemSeparation,
  setStemVolume,
  setStemMuted,
} from "../../state/appActions";
import {
  stemSeparationSupported,
  STEM_MODEL_SIZE_MB,
} from "../../core/stems/stemSeparator";
import { StemJobState } from "../../state/stemJobState";
import { VolumeRow } from "./VolumeRow";

const STEM_LABELS: Record<StemName, string> = {
  drums: "Drums",
  bass: "Bass",
  other: "Other",
  vocals: "Vocals",
};

function jobLabel(job: StemJobState): string {
  switch (job.phase) {
    case "downloading":
      return `Downloading model (${STEM_MODEL_SIZE_MB} MB)`;
    case "separating":
      return "Separating stems";
    case "saving":
      return "Saving stems";
    default:
      return "";
  }
}

/**
 * The "Stems" section of the audio-controls drawer: a per-stem mixer once
 * separation has run, otherwise the button (and progress) to run it.
 */
export function StemControls(): JSX.Element {
  const stemsReady = useSessionStore((s) => s.stemsReady);
  const stemJobState = useSessionStore((s) => s.stemJobState);
  const stemVolumes = useSessionStore((s) => s.stemVolumes);
  const stemMutes = useSessionStore((s) => s.stemMutes);
  const audioLoading = useSessionStore((s) => s.audioLoading);
  const projectPath = useProjectStore((s) => s.projectPath);

  if (stemsReady) {
    return (
      <>
        <div className="vd-section">Stems</div>
        {STEM_NAMES.map((stem) => (
          <VolumeRow
            key={stem}
            label={STEM_LABELS[stem]}
            value={stemVolumes[stem]}
            onChange={(v) => setStemVolume(stem, v)}
            enabled={!stemMutes[stem]}
            onToggle={(on) => setStemMuted(stem, !on)}
          />
        ))}
      </>
    );
  }

  if (stemJobState.inProgress()) {
    const progress = stemJobState.progress;
    return (
      <div className="vd-stems">
        <div className="vd-section">Stems</div>
        <div className="vd-job-label">
          <span>{jobLabel(stemJobState)}…</span>
          {progress !== null && <span>{Math.round(progress * 100)}%</span>}
        </div>
        <progress
          className="vd-job-progress"
          max={1}
          value={progress ?? undefined}
        />
        {stemJobState.cancellable() && (
          <button className="vd-stem-btn" onClick={cancelStemSeparation}>
            Cancel
          </button>
        )}
      </div>
    );
  }

  const supported = stemSeparationSupported();
  const canSeparate = supported && projectPath !== null && !audioLoading;
  return (
    <div className="vd-stems">
      <div className="vd-section">Stems</div>
      {stemJobState.hasError() && (
        <div className="vd-error" title={stemJobState.message}>
          Separation failed: {stemJobState.message}
        </div>
      )}
      <button
        className="vd-stem-btn"
        disabled={!canSeparate}
        onClick={() => void separateStems()}
      >
        {stemJobState.hasError() ? "Retry separation" : "Separate stems"}
      </button>
      {!supported ? (
        <div className="vd-hint">Stem separation requires WebGPU.</div>
      ) : projectPath === null ? (
        <div className="vd-hint">Save the project to enable separation.</div>
      ) : null}
    </div>
  );
}
