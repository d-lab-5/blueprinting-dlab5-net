import * as React from "react";

/**
 * Zoom and pan for a rendered diagram.
 *
 * Generic over what it wraps rather than built into MermaidView, because a
 * roadmap is only the first diagram — the D2 infrastructure views will want
 * exactly the same controls, and a Gantt of a real programme is far wider than
 * a column of text.
 *
 * Zoom RESIZES the SVG rather than CSS-scaling a wrapper around it.
 *
 * Scaling a wrapper is the obvious approach and it looks terrible. A
 * transformed element gets promoted to its own compositor layer, rasterised
 * once at its original size and then stretched as a bitmap — so text that is
 * perfectly sharp at 100% is soft at 200%, which defeats the point of zooming
 * into a diagram. Setting width and height on the <svg> makes the browser lay
 * it out again and re-render the vectors, so it stays crisp at any zoom.
 *
 * Panning is still a CSS translate. Translation does not resample anything.
 */

const MIN = 0.4;
const MAX = 4;
const STEP = 0.25;

const clamp = (v: number) => Math.min(MAX, Math.max(MIN, v));

export function DiagramViewport({ children }: { children: React.ReactNode }) {
  const [scale, setScale] = React.useState(1);
  const [offset, setOffset] = React.useState({ x: 0, y: 0 });
  const frameRef = React.useRef<HTMLDivElement>(null);
  const stageRef = React.useRef<HTMLDivElement>(null);
  const dragRef = React.useRef<{ x: number; y: number } | null>(null);
  /** Natural size from the SVG's viewBox, measured once per diagram. */
  const naturalRef = React.useRef<{ w: number; h: number } | null>(null);

  const reset = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  /**
   * Applies the zoom by resizing the SVG.
   *
   * Re-run when the diagram itself changes, not only when the scale does: the
   * SVG arrives asynchronously — MermaidView renders it after an await — and
   * is replaced wholesale whenever the model changes, which resets its size.
   */
  React.useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const apply = () => {
      const svg = stage.querySelector("svg");
      if (!svg) return;

      if (!naturalRef.current) {
        const box = svg.viewBox?.baseVal;
        // A mermaid gantt always carries a viewBox; getBoundingClientRect is
        // the fallback for anything that does not.
        const rect = svg.getBoundingClientRect();
        naturalRef.current = {
          w: box && box.width ? box.width : rect.width,
          h: box && box.height ? box.height : rect.height,
        };
      }

      const natural = naturalRef.current;
      if (!natural?.w || !natural?.h) return;

      svg.style.width = `${natural.w * scale}px`;
      svg.style.height = `${natural.h * scale}px`;
      // Mermaid sets max-width when useMaxWidth is on, which would clamp the
      // width we just set and silently cap the zoom.
      svg.style.maxWidth = "none";
    };

    apply();

    // The SVG is swapped out on every model change; catch the new one.
    const observer = new MutationObserver(() => {
      naturalRef.current = null;
      apply();
    });
    observer.observe(stage, { childList: true, subtree: true });
    return () => observer.disconnect();
    // Deliberately not depending on `children`: it is a new React node on every
    // render, which would tear down and rebuild the observer each time. The
    // observer is what notices a new diagram.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale]);

  /**
   * Ctrl/Cmd + wheel zooms, plain wheel scrolls.
   *
   * This mirrors the browser's own zoom gesture and, more importantly, leaves
   * a plain scroll doing what a plain scroll should — a diagram that hijacks
   * the wheel traps the reader on the page.
   *
   * Registered with a non-passive listener because preventDefault on a wheel
   * event is ignored in a passive one, which React's onWheel now is.
   */
  React.useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setScale((s) => clamp(s - Math.sign(event.deltaY) * STEP));
    };

    frame.addEventListener("wheel", onWheel, { passive: false });
    return () => frame.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (event: React.PointerEvent) => {
    // Only pan when there is something to pan to.
    if (scale <= 1) return;
    dragRef.current = { x: event.clientX - offset.x, y: event.clientY - offset.y };
    (event.target as Element).setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const start = dragRef.current;
    if (!start) return;
    setOffset({ x: event.clientX - start.x, y: event.clientY - start.y });
  };

  const endDrag = (event: React.PointerEvent) => {
    dragRef.current = null;
    (event.target as Element).releasePointerCapture?.(event.pointerId);
  };

  return (
    <div className="bp-viewport">
      <div className="bp-viewport__controls" role="group" aria-label="Diagram zoom">
        <button
          type="button"
          className="bp-linkbutton"
          onClick={() => setScale((s) => clamp(s - STEP))}
          disabled={scale <= MIN}
          aria-label="Zoom out"
          title="Zoom out"
        >
          −
        </button>
        <button
          type="button"
          className="bp-linkbutton bp-viewport__level"
          onClick={reset}
          title="Reset zoom"
        >
          {Math.round(scale * 100)}%
        </button>
        <button
          type="button"
          className="bp-linkbutton"
          onClick={() => setScale((s) => clamp(s + STEP))}
          disabled={scale >= MAX}
          aria-label="Zoom in"
          title="Zoom in"
        >
          +
        </button>
        <span className="bp-viewport__hint">
          {scale > 1 ? "drag to pan · " : ""}ctrl+scroll to zoom
        </span>
      </div>

      <div
        ref={frameRef}
        className="bp-viewport__frame"
        style={{ cursor: scale > 1 ? "grab" : "default" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div
          ref={stageRef}
          className="bp-viewport__stage"
          style={{
            // Translate only. The scale is applied to the SVG's own width and
            // height above, so the vectors are re-rendered rather than a
            // bitmap being stretched.
            transform: `translate(${offset.x}px, ${offset.y}px)`,
            transformOrigin: "0 0",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
