import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { useSessionStore } from "../../state/sessionStore";
import { useProjectStore } from "../../state/projectStore";
import { secToPx, pxToSec } from "../../core/timeline/viewport";
import { useTimelineWheel } from "./useTimelineWheel";
import {
  setActiveLoop,
  refreshActiveLoop,
  commitPendingRegion,
  discardPendingRegion,
} from "../../state/appActions";

const MIN_REGION_SEC = 0.25;

/** Drag to create a loop region; click a region to (de)activate; drag edges to resize. */
export function LoopLane(): JSX.Element {
  const viewport = useSessionStore((s) => s.viewport);
  const activeLoopId = useSessionStore((s) => s.activeLoopId);
  const pendingRegion = useSessionStore((s) => s.pendingRegion);
  const regions = useProjectStore((s) => s.loopRegions);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pendingRef = useRef<HTMLDivElement | null>(null);
  useTimelineWheel(containerRef);
  const [draft, setDraft] = useState<{ a: number; b: number } | null>(null);

  // While a pending region is shown, a click anywhere outside it discards it.
  const hasPending = pendingRegion !== null;
  useEffect(() => {
    if (!hasPending) return;
    const onDown = (e: PointerEvent): void => {
      const el = pendingRef.current;
      if (el && e.target instanceof Node && el.contains(e.target)) return;
      discardPendingRegion();
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [hasPending]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.target !== e.currentTarget) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const start = pxToSec(viewport, e.clientX - rect.left);
    setDraft({ a: start, b: start });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!draft) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setDraft({ a: draft.a, b: pxToSec(viewport, e.clientX - rect.left) });
  };

  const onPointerUp = (): void => {
    if (!draft) return;
    const start = Math.max(0, Math.min(draft.a, draft.b));
    const end = Math.max(draft.a, draft.b);
    setDraft(null);
    if (end - start >= MIN_REGION_SEC) {
      const region = useProjectStore.getState().addLoopRegion(start, end);
      setActiveLoop(region.id);
    }
  };

  return (
    <div
      ref={containerRef}
      className="loop-lane"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {regions.map((r) => {
        const left = secToPx(viewport, r.startSec);
        const width = (r.endSec - r.startSec) * viewport.pxPerSecond;
        if (left + width < 0) return null;
        const active = r.id === activeLoopId;
        return (
          <div
            key={r.id}
            className={`loop-region${active ? " active" : ""}`}
            style={{ left, width }}
            title={`${r.name} — click to ${active ? "deactivate" : "activate"}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setActiveLoop(active ? null : r.id)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              const name = prompt("Region name", r.name);
              if (name)
                useProjectStore.getState().updateLoopRegion(r.id, { name });
            }}
          >
            <ResizeHandle region={r.id} edge="start" />
            <span className="loop-name">{r.name}</span>
            <button
              className="loop-delete"
              title="Delete region"
              onClick={(e) => {
                e.stopPropagation();
                if (active) setActiveLoop(null);
                useProjectStore.getState().deleteLoopRegion(r.id);
              }}
            >
              ×
            </button>
            <ResizeHandle region={r.id} edge="end" />
          </div>
        );
      })}
      {draft && (
        <div
          className="loop-region draft"
          style={{
            left: secToPx(viewport, Math.min(draft.a, draft.b)),
            width: Math.abs(draft.b - draft.a) * viewport.pxPerSecond,
          }}
        />
      )}
      {pendingRegion && (
        <div
          ref={pendingRef}
          className="loop-region pending"
          style={{
            left: secToPx(viewport, pendingRegion.startSec),
            width:
              (pendingRegion.endSec - pendingRegion.startSec) *
              viewport.pxPerSecond,
          }}
          title="Click to save as a section"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={commitPendingRegion}
        >
          <span className="loop-name">Click to save</span>
        </div>
      )}
    </div>
  );
}

function ResizeHandle({
  region,
  edge,
}: {
  region: string;
  edge: "start" | "end";
}): JSX.Element {
  const viewport = useSessionStore((s) => s.viewport);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const r = useProjectStore
      .getState()
      .loopRegions.find((x) => x.id === region);
    if (!r) return;
    const orig = edge === "start" ? r.startSec : r.endSec;

    const onMove = (ev: PointerEvent): void => {
      const dSec = (ev.clientX - startX) / viewport.pxPerSecond;
      const v = orig + dSec;
      const cur = useProjectStore
        .getState()
        .loopRegions.find((x) => x.id === region);
      if (!cur) return;
      if (edge === "start") {
        useProjectStore.getState().updateLoopRegion(region, {
          startSec: Math.min(v, cur.endSec - MIN_REGION_SEC),
        });
      } else {
        useProjectStore.getState().updateLoopRegion(region, {
          endSec: Math.max(v, cur.startSec + MIN_REGION_SEC),
        });
      }
    };
    const onUp = (): void => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      refreshActiveLoop();
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
  };

  return (
    <div className={`loop-handle ${edge}`} onPointerDown={onPointerDown} />
  );
}
