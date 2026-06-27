import { useRef } from "react";
import type { JSX } from "react";
import { useSessionStore } from "../../state/sessionStore";
import { useProjectStore } from "../../state/projectStore";
import {
  levelForZoom,
  secondsPerBin,
  binsForLevel,
  VALUES_PER_BIN,
} from "../../core/audio/peaks";
import { pxToSec } from "../../core/timeline/viewport";
import { useCanvas } from "../useCanvas";
import { useTimelineWheel } from "./../timeline/useTimelineWheel";
import { seek } from "../../state/appActions";

export function WaveformLane(): JSX.Element {
  const viewport = useSessionStore((s) => s.viewport);
  const peaks = useSessionStore((s) => s.peaks);
  const loading = useSessionStore((s) => s.audioLoading);
  const hasAudio = useProjectStore((s) => s.audio !== null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  useTimelineWheel(containerRef);

  const canvasRef = useCanvas((ctx, w, h) => {
    if (!peaks) return;
    const level = levelForZoom(peaks, viewport.pxPerSecond);
    const data = peaks.levels[level];
    const binSec = secondsPerBin(peaks, level);
    const bins = binsForLevel(peaks, level);
    const mid = h / 2;
    const amp = (h / 2) * 0.92;

    const firstBin = Math.max(0, Math.floor(viewport.scrollSec / binSec));
    const lastBin = Math.min(
      bins - 1,
      Math.ceil(pxToSec(viewport, w) / binSec),
    );
    const wPx = Math.max(
      binSec * viewport.pxPerSecond,
      1 / (window.devicePixelRatio || 1),
    );

    // RMS values for music are small in absolute terms, so normalize against
    // the loudest bin in the level — that one fills the lane and the rest scale
    // proportionally. Scanning the whole level (not just the visible window)
    // keeps the vertical scale stable while scrolling.
    let maxRms = 0;
    for (let b = 0; b < bins; b++) {
      const rms = data[b * VALUES_PER_BIN + 2];
      if (rms > maxRms) maxRms = rms;
    }
    const rmsScale = maxRms > 0 ? (amp * 2) / maxRms : 0;

    // RMS body: average energy, drawn symmetrically about the center line.
    // Averaging out isolated spikes reveals the actual musical dynamics.
    ctx.fillStyle = "#15140f";
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    for (let b = firstBin; b <= lastBin; b++) {
      const x = (b * binSec - viewport.scrollSec) * viewport.pxPerSecond;
      const rms = data[b * VALUES_PER_BIN + 2];
      const hPx = Math.max(rms * rmsScale, 1);
      ctx.rect(x, mid - hPx / 2, wPx, hPx);
    }
    ctx.fill();
    ctx.globalAlpha = 1;

    // center line
    ctx.strokeStyle = "rgba(21,20,15,0.15)";
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(w, mid);
    ctx.stroke();
  });

  return (
    <div
      ref={containerRef}
      className="waveform-lane"
      onPointerDown={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        seek(Math.max(0, pxToSec(viewport, e.clientX - rect.left)));
      }}
    >
      <canvas ref={canvasRef} className="lane-canvas" />
      {!hasAudio && !loading && (
        <div className="lane-placeholder">Open an audio file to begin (⌘O)</div>
      )}
      {loading && <div className="lane-placeholder">Decoding audio…</div>}
    </div>
  );
}
