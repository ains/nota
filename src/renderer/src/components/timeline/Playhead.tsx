import { useEffect, useRef } from "react";
import type { JSX } from "react";
import { getEngineRef } from "../../state/appActions";
import { useSessionStore } from "../../state/sessionStore";
import { secToPx } from "../../core/timeline/viewport";

/**
 * Playhead overlay across all lanes, advanced by rAF reading the engine's
 * clocks directly — never through React state. Position is derived via
 * ClockSync (what the user is HEARING), which is what they visually align
 * their playing against.
 */
export function Playhead(): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const engine = getEngineRef();
    let raf = 0;
    const tick = (): void => {
      const el = ref.current;
      if (el) {
        const { viewport } = useSessionStore.getState();
        const pos = engine.transport.isPlaying
          ? engine.transport.posAtCtxTime(
              engine.clockSync.ctxTimeAtSpeaker(performance.now()),
            )
          : engine.transport.position;
        const x = secToPx(viewport, pos);
        el.style.transform = `translateX(${x}px)`;
        el.style.display = x < -2 ? "none" : "block";
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <div ref={ref} className="playhead" />;
}
