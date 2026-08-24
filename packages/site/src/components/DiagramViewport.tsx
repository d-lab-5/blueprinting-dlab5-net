import * as React from "react";

/**
 * Zoom and pan for a rendered diagram.
 *
 * Generic over what it wraps rather than built into MermaidView, because a
 * roadmap is only the first diagram — the D2 infrastructure views will want
 * exactly the same controls, and a Gantt of a real programme is far wider than
 * a column of text.
 *
 * Zoom is a CSS transform on a wrapper rather than a change to the SVG's
 * viewBox: the SVG comes from Mermaid as an opaque string and rewriting its
 * attributes would mean parsing and re-serialising it on every zoom step.
 */

const MIN = 0.4;
const MAX = 4;
const STEP = 0.25;

const clamp = (v: number) => Math.min(MAX, Math.max(MIN, v));

export function DiagramViewport({ children }: { children: React.ReactNode }) {
  const [scale, setScale] = React.useState(1);
  const [offset, setOffset] = React.useState({ x: 0, y: 0 });
  const frameRef = React.useRef<HTMLDivElement>(null);
  const dragRef = React.useRef<{ x: number; y: number } | null>(null);

  const reset = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

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
          className="bp-viewport__stage"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            // Anchoring at the top-left keeps the earliest date and the
            // section labels in view as the diagram grows, which is where a
            // reader looks first.
            transformOrigin: "0 0",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
