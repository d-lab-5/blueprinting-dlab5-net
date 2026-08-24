import * as React from "react";

/**
 * Renders a Mermaid diagram.
 *
 * Mermaid is imported dynamically rather than at module scope. It reaches for
 * `document` while initialising, so a static import would run during the
 * Gatsby build and break it — the same reason Amplify is configured only in
 * gatsby-browser.
 *
 * The rendered SVG comes from Mermaid, from a source string this application
 * generated from its own model. It is not user-supplied markup, and Mermaid
 * sanitises with DOMPurify at its default security level, so
 * dangerouslySetInnerHTML is the intended way to mount it. If diagram sources
 * ever become something a user can paste, revisit this.
 */

interface MermaidViewProps {
  /** Mermaid source, e.g. from toMermaidGantt. */
  script: string;
  /** Stable id; Mermaid requires one per render. */
  id: string;
}

let initialised = false;

export function MermaidView({ script, id }: MermaidViewProps) {
  const [svg, setSvg] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        if (!initialised) {
          mermaid.initialize({
            startOnLoad: false,
            theme: "dark",
            securityLevel: "strict",
            gantt: {
              useMaxWidth: true,
              barHeight: 22,
              barGap: 6,
              topPadding: 48,
              leftPadding: 160,
            },
          });
          initialised = true;
        }
        // parse() first: render() on invalid source leaves an orphaned error
        // node in the document body that no amount of React re-rendering
        // clears.
        await mermaid.parse(script);
        const { svg: rendered } = await mermaid.render(id, script);
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
  }, [script, id]);

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
      // eslint-disable-next-line react/no-danger -- see the note above
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
