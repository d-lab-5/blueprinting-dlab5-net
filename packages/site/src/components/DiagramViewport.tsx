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
 * Panning is the frame's own scroll position, not a CSS transform.
 *
 * A transform inside a clipped frame can only move a diagram that is already
 * larger than its frame, which is why panning used to require zooming past
 * 100% first — below that there was nothing to translate and the gesture did
 * nothing. Scrolling a real overflow container works at any zoom, gives
 * scrollbars for free, and means keyboard and trackpad scrolling behave the
 * way they do everywhere else.
 */

/**
 * Low enough that Fit can actually fit.
 *
 * A real infrastructure diagram is several thousand pixels wide; fitting one
 * into a page column needs about 25%, and the old floor of 0.4 meant the Fit
 * button silently under-delivered and left the diagram still overflowing.
 * A quarter-size view is a thumbnail rather than something you read, which is
 * exactly what "show me the whole thing" is asking for.
 */
const MIN = 0.1;
const MAX = 4;
const STEP = 0.25;

const clamp = (v: number) => Math.min(MAX, Math.max(MIN, v));

export function DiagramViewport({ children }: { children: React.ReactNode }) {
  const [scale, setScale] = React.useState(1);
  const [isFullscreen, setFullscreen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const frameRef = React.useRef<HTMLDivElement>(null);
  const stageRef = React.useRef<HTMLDivElement>(null);
  /** Where the pointer went down, and where the frame was scrolled to then. */
  const dragRef = React.useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  /** Natural size from the SVG's viewBox, measured once per diagram. */
  const naturalRef = React.useRef<{ w: number; h: number } | null>(null);

  const reset = () => {
    setScale(1);
    scrollTo(0, 0);
  };

  const scrollTo = (x: number, y: number) => {
    const frame = frameRef.current;
    if (!frame) return;
    frame.scrollLeft = x;
    frame.scrollTop = y;
  };

  /**
   * Scale so the whole diagram is visible.
   *
   * Measured from what is actually on screen — the SVG's rendered box at the
   * current zoom — rather than from its viewBox. A D2 or mermaid SVG does not
   * always render at its viewBox size, so computing from the viewBox fitted
   * one axis and left the other overflowing. Scaling the current size by the
   * ratio that would make it fit is self-correcting whatever the SVG claims.
   *
   * Fits the tighter axis so nothing is left off the edge, and never enlarges
   * past 100%: a small diagram blown up to fill the frame is not what "fit"
   * means to anyone.
   */
  const fit = () => {
    const frame = frameRef.current;
    const svg = stageRef.current?.querySelector("svg");
    if (!frame || !svg) return;

    const box = svg.getBoundingClientRect();
    if (!box.width || !box.height) return;

    // Whatever the stage adds around the diagram, measured rather than
    // assumed. It was assumed once — as the 24px of padding — and the real
    // figure was 62, because an inline-block stage also reserves a text
    // baseline under its content. Fit then overflowed vertically every time.
    const stageBox = stageRef.current!.getBoundingClientRect();
    const overheadX = Math.max(0, stageBox.width - box.width);
    const overheadY = Math.max(0, stageBox.height - box.height);

    const availableW = frame.clientWidth - overheadX;
    const availableH = frame.clientHeight - overheadY;
    if (availableW <= 0 || availableH <= 0) return;

    const ratio = Math.min(availableW / box.width, availableH / box.height);
    setScale((current) => clamp(Math.min(current * ratio, 1)));
    scrollTo(0, 0);
  };

  /**
   * Full screen, for a diagram that is genuinely too big for a page column.
   *
   * The whole viewport goes full screen rather than the SVG alone, so the
   * zoom controls travel with it — a full-screen diagram you cannot zoom is
   * worse than a small one you can.
   */
  const toggleFullscreen = () => {
    const root = rootRef.current;
    if (!root) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void root.requestFullscreen?.();
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

  React.useEffect(() => {
    // Escape leaves full screen without going through the button, so the
    // label has to follow the browser rather than our own last click.
    const sync = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const onPointerDown = (event: React.PointerEvent) => {
    const frame = frameRef.current;
    if (!frame) return;
    // Only when there is somewhere to scroll. Unlike the old transform this
    // is true whenever the diagram overflows, at any zoom level.
    if (
      frame.scrollWidth <= frame.clientWidth &&
      frame.scrollHeight <= frame.clientHeight
    ) {
      return;
    }
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      left: frame.scrollLeft,
      top: frame.scrollTop,
    };
    (event.target as Element).setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const start = dragRef.current;
    const frame = frameRef.current;
    if (!start || !frame) return;
    // Dragging right moves the content right, which means scrolling left.
    frame.scrollLeft = start.left - (event.clientX - start.x);
    frame.scrollTop = start.top - (event.clientY - start.y);
  };

  const endDrag = (event: React.PointerEvent) => {
    dragRef.current = null;
    (event.target as Element).releasePointerCapture?.(event.pointerId);
  };

  return (
    <div
      ref={rootRef}
      className={`bp-viewport${isFullscreen ? " bp-viewport--full" : ""}`}
    >
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
        <button
          type="button"
          className="bp-linkbutton"
          onClick={fit}
          title="Fit the whole diagram"
        >
          Fit
        </button>
        <button
          type="button"
          className="bp-linkbutton"
          onClick={toggleFullscreen}
          aria-pressed={isFullscreen}
          title={isFullscreen ? "Leave full screen" : "Full screen"}
        >
          {isFullscreen ? "Exit full screen" : "Full screen"}
        </button>
        <span className="bp-viewport__hint">
          drag or scroll to pan · ctrl+scroll to zoom
        </span>
      </div>

      <div
        ref={frameRef}
        className="bp-viewport__frame"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* No transform at all now. The scale is applied to the SVG's own
            width and height above, so the vectors are re-rendered rather than
            a bitmap stretched, and position is the frame's scroll offset. */}
        <div ref={stageRef} className="bp-viewport__stage">
          {children}
        </div>
      </div>
    </div>
  );
}
