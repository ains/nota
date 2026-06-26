import { useRef } from "react";
import type { JSX } from "react";
import { useSessionStore } from "../../state/sessionStore";
import { useProjectStore } from "../../state/projectStore";
import {
  levelForZoom,
  secondsPerBin,
  binsForLevel,
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

    ctx.fillStyle = "#4a9eff";
    ctx.globalAlpha = 0.85;
    const firstBin = Math.max(0, Math.floor(viewport.scrollSec / binSec));
    const lastBin = Math.min(
      bins - 1,
      Math.ceil(pxToSec(viewport, w) / binSec),
    );
    ctx.beginPath();
    for (let b = firstBin; b <= lastBin; b++) {
      const x = (b * binSec - viewport.scrollSec) * viewport.pxPerSecond;
      const wPx = Math.max(
        binSec * viewport.pxPerSecond,
        1 / (window.devicePixelRatio || 1),
      );
      const min = data[b * 2];
      const max = data[b * 2 + 1];
      const y = mid - max * amp;
      const hPx = Math.max((max - min) * amp, 1);
      ctx.rect(x, y, wPx, hPx);
    }
    ctx.fill();
    ctx.globalAlpha = 1;

    // center line
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
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
