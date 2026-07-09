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
import { VolumeRow } from "./VolumeRow";

const STEM_LABELS: Record<StemName, string> = {
  drums: "Drums",
  bass: "Bass",
  other: "Other",
  vocals: "Vocals",
};

function jobLabel(phase: "downloading" | "separating" | "saving"): string {
  switch (phase) {
    case "downloading":
      return `Downloading model (${STEM_MODEL_SIZE_MB} MB)`;
    case "separating":
      return "Separating stems";
    case "saving":
      return "Saving stems";
  }
}

/**
 * The "Stems" section of the audio-controls drawer: a per-stem mixer once
 * separation has run, otherwise the button (and progress) to run it.
 */
export function StemControls(): JSX.Element {
  const stemsReady = useSessionStore((s) => s.stemsReady);
  const stemJob = useSessionStore((s) => s.stemJob);
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

  if (
    stemJob.phase === "downloading" ||
    stemJob.phase === "separating" ||
    stemJob.phase === "saving"
  ) {
    const progress = stemJob.phase === "saving" ? null : stemJob.progress;
    return (
      <div className="vd-stems">
        <div className="vd-section">Stems</div>
        <div className="vd-job-label">
          <span>{jobLabel(stemJob.phase)}…</span>
          {progress !== null && <span>{Math.round(progress * 100)}%</span>}
        </div>
        <progress
          className="vd-job-progress"
          max={1}
          value={progress ?? undefined}
        />
        {stemJob.phase !== "saving" && (
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
      {stemJob.phase === "error" && (
        <div className="vd-error" title={stemJob.message}>
          Separation failed: {stemJob.message}
        </div>
      )}
      <button
        className="vd-stem-btn"
        disabled={!canSeparate}
        onClick={() => void separateStems()}
      >
        {stemJob.phase === "error" ? "Retry separation" : "Separate stems"}
      </button>
      {!supported ? (
        <div className="vd-hint">Stem separation requires WebGPU.</div>
      ) : projectPath === null ? (
        <div className="vd-hint">Save the project to enable separation.</div>
      ) : null}
    </div>
  );
}
