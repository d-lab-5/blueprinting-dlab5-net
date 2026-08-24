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
  render: (diagram: unknown, options: unknown) => Promise<string>;
};

let compiler: Compiler | null = null;

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
        const d2 = await getCompiler();
        const result = await d2.compile(script);
        const rendered = await d2.render(result.diagram, result.renderOptions);
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
