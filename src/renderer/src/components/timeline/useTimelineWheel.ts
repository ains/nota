import { useEffect } from "react";
import { useSessionStore } from "../../state/sessionStore";
import { useProjectStore } from "../../state/projectStore";
import { zoomAt, clampScroll } from "../../core/timeline/viewport";

/**
 * Shared wheel behaviour for all timeline lanes:
 *  - cmd/ctrl + wheel: zoom anchored at the cursor
 *  - plain wheel / trackpad: horizontal pan
 * Attached as a non-passive listener so we can preventDefault.
 */
export function useTimelineWheel(
  el: React.RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const node = el.current;
    if (!node) return;

    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const session = useSessionStore.getState();
      const duration = useProjectStore.getState().audio?.durationSec ?? 60;
      const rect = node.getBoundingClientRect();
      const x = e.clientX - rect.left;
      let vp = session.viewport;
      if (e.metaKey || e.ctrlKey) {
        const factor = Math.exp(-e.deltaY * 0.002);
        vp = zoomAt(vp, x, factor);
      } else {
        const deltaPx = e.deltaX !== 0 ? e.deltaX : e.deltaY;
        vp = { ...vp, scrollSec: vp.scrollSec + deltaPx / vp.pxPerSecond };
      }
      session.setViewport(clampScroll(vp, duration, session.laneWidthPx));
    };

    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [el]);
}
