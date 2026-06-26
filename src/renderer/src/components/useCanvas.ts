import { useEffect, useRef } from "react";

export type CanvasPainter = (
  ctx: CanvasRenderingContext2D,
  widthCss: number,
  heightCss: number,
) => void;

/**
 * Canvas with devicePixelRatio-aware sizing. Repaints on every render
 * (painters close over the state they draw, so a re-render means the state
 * changed) and on element resize.
 */
export function useCanvas(
  painter: CanvasPainter,
): React.RefObject<HTMLCanvasElement | null> {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const painterRef = useRef(painter);

  // Repaint with the latest painter after each render.
  useEffect(() => {
    painterRef.current = painter;
    paintCanvas(ref.current, painter);
  });

  // Repaint on resize (mount-only observer).
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() =>
      paintCanvas(canvas, painterRef.current),
    );
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  return ref;
}

function paintCanvas(
  canvas: HTMLCanvasElement | null,
  painter: CanvasPainter,
): void {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  painter(ctx, w, h);
}
