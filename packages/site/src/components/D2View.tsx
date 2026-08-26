import * as React from "react";

/**
 * Renders a D2 diagram.
 *
 * D2 compiles to SVG through a WASM bundle, imported dynamically for the same
 * reason mermaid and Blockly are: it is browser-only, and a static import
 * would run during the Gatsby build.
 *
 * One instance is kept for the lifetime of the page rather than made per
 * render. Constructing a D2 spins up a worker, and doing that on every model
 * change would leak one per keystroke.
 */

interface Props {
  /** D2 source, from toD2. */
  script: string;
}

type Compiler = {
  compile: (src: string) => Promise<{ diagram: unknown; renderOptions: unknown }>;
  /** Typed as Promise<string> upstream. It is not always one — see svgOf. */
  render: (diagram: unknown, options: unknown) => Promise<unknown>;
};

/**
 * The SVG out of whatever d2.render resolved to.
 *
 * Upstream types render as Promise<string> and the Node build delivers one,
 * which is why scripts/verify-views.mjs has always passed. The browser build
 * talks to its worker through postMessage and has two message handlers: one
 * resolves with the payload, the other with the whole `{ type, data }`
 * envelope. Take the second path and render resolves to an object, React
 * stringifies it, and the diagram area reads "[object Object]" — which is
 * exactly what the Structure screen had been showing.
 *
 * So the shape is normalised here rather than trusted. An unexpected one
 * throws with its keys named, because a silent [object Object] is how this
 * survived unnoticed in a shipped screen.
 */
function svgOf(rendered: unknown): string {
  if (typeof rendered === "string") return rendered;

  if (rendered && typeof rendered === "object") {
    const record = rendered as Record<string, unknown>;
    for (const key of ["data", "svg", "result"]) {
      if (typeof record[key] === "string") return record[key] as string;
    }
    throw new Error(
      `d2.render resolved to an object with keys [${Object.keys(record).join(", ")}], not an SVG string.`
    );
  }

  throw new Error(`d2.render resolved to ${typeof rendered}, not an SVG string.`);
}

let compiler: Compiler | null = null;

/**
 * One D2 call at a time, across the whole page.
 *
 * The D2 instance talks to its WASM worker over postMessage and keeps a
 * SINGLE `currentResolve` slot for the outstanding request. Two overlapping
 * calls therefore cross their resolutions: change the focus while a render is
 * still in flight and `render()` resolves with the *next* compile's result —
 * an object with keys [fs, inputPath, diagram, graph, renderOptions] where an
 * SVG string was promised. React then stringifies it and the diagram area
 * reads "[object Object]".
 *
 * The instance is shared deliberately — constructing a D2 spins up a worker —
 * so the queue is what makes sharing safe. Every call runs to completion
 * before the next begins.
 */
let queue: Promise<unknown> = Promise.resolve();

function serialised<T>(work: () => Promise<T>): Promise<T> {
  // Chained off both settle paths, so one failed render does not wedge the
  // queue for every later one.
  const run = queue.then(work, work);
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function getCompiler(): Promise<Compiler> {
  if (compiler) return compiler;
  const { D2 } = await import("@terrastruct/d2");
  compiler = new D2() as unknown as Compiler;
  return compiler;
}

export function D2View({ script }: Props) {
  const [svg, setSvg] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setError(null);

    (async () => {
      try {
        const rendered = await serialised(async () => {
          const d2 = await getCompiler();
          const result = await d2.compile(script);
          return svgOf(await d2.render(result.diagram, result.renderOptions));
        });
        if (!cancelled) {
          setSvg(rendered);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setSvg(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [script]);

  if (error) {
    return (
      <div className="bp-diagram bp-diagram--error" role="alert">
        <p>The diagram could not be rendered.</p>
        <pre>{error}</pre>
        <details>
          <summary>Diagram source</summary>
          <pre>{script}</pre>
        </details>
      </div>
    );
  }

  if (!svg) return <p className="bp-muted">Rendering…</p>;

  return (
    <div
      className="bp-diagram"
      // The SVG comes from the d2 compiler, from source this application
      // generated from its own model. It is not user-supplied markup.
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
