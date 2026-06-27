import type { JSX } from "react";
import { useSessionStore } from "../../state/sessionStore";
import { zoomToSlider, sliderToZoom } from "../../core/timeline/viewport";
import { setZoom } from "../../state/appActions";

export function BottomBar(): JSX.Element {
  const pxPerSecond = useSessionStore((s) => s.viewport.pxPerSecond);
  return (
    <div className="bottom-bar">
      <label className="zoom-control" title="Zoom">
        <span aria-hidden="true">⌕</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={zoomToSlider(pxPerSecond)}
          onChange={(e) => setZoom(sliderToZoom(Number(e.target.value)))}
        />
      </label>
    </div>
  );
}
