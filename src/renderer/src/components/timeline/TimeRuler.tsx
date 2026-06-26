import { useRef } from "react";
import type { JSX } from "react";
import { useSessionStore } from "../../state/sessionStore";
import {
  rulerTickSec,
  secToPx,
  pxToSec,
  formatTime,
} from "../../core/timeline/viewport";
import { useCanvas } from "../useCanvas";
import { useTimelineWheel } from "./useTimelineWheel";
import { seek } from "../../state/appActions";

export function TimeRuler(): JSX.Element {
  const viewport = useSessionStore((s) => s.viewport);
  const containerRef = useRef<HTMLDivElement | null>(null);
  useTimelineWheel(containerRef);

  const canvasRef = useCanvas((ctx, w, h) => {
    const tick = rulerTickSec(viewport.pxPerSecond);
    const first = Math.floor(viewport.scrollSec / tick) * tick;
    const last = pxToSec(viewport, w);
    ctx.font = "10px system-ui, sans-serif";
    ctx.fillStyle = "var(--text-dim)";
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.fillStyle = "#8b8fa3";
    ctx.textBaseline = "top";
    for (let t = first; t <= last; t += tick) {
      const x = secToPx(viewport, t);
      ctx.beginPath();
      ctx.moveTo(x, h - 8);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.fillText(formatTime(t, tick < 1), x + 3, 2);
      // minor ticks
      for (let i = 1; i < 5; i++) {
        const mx = secToPx(viewport, t + (tick * i) / 5);
        ctx.beginPath();
        ctx.moveTo(mx, h - 4);
        ctx.lineTo(mx, h);
        ctx.stroke();
      }
    }
  });

  return (
    <div
      ref={containerRef}
      className="time-ruler"
      onPointerDown={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        seek(Math.max(0, pxToSec(viewport, e.clientX - rect.left)));
      }}
    >
      <canvas ref={canvasRef} className="lane-canvas" />
    </div>
  );
}
