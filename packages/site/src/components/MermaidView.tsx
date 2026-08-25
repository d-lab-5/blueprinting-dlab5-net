import * as React from "react";
import { readGanttPalette } from "../lib/gantt-palette";
import { useTheme } from "./useTheme";

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

/**
 * Which theme mermaid was last configured for.
 *
 * mermaid.initialize is global and cumulative, so it is called once per theme
 * rather than once per mount — but it MUST be called again when the theme
 * changes, or a light page keeps rendering the dark chart.
 */
let initialisedFor: string | null = null;

export function MermaidView({ script, id }: MermaidViewProps) {
  const [svg, setSvg] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [theme] = useTheme();

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        if (initialisedFor !== theme) {
          const palette = readGanttPalette();
          mermaid.initialize({
            startOnLoad: false,
            // "base" is the only built-in theme that honours themeVariables
            // wholesale; "dark" and "default" override much of what is set
            // here, which is how the chart used to end up dark on a light page.
            theme: "base",
            themeVariables: {
              darkMode: theme === "dark",
              ...(palette ?? {}),
            },
            securityLevel: "strict",
            gantt: {
              useMaxWidth: true,
              barHeight: 22,
              barGap: 6,
              topPadding: 48,
              leftPadding: 160,
            },
          });
          // Only remember the theme once a real palette was applied, so a
          // render that happened before the stylesheet landed is redone.
          initialisedFor = palette ? theme : null;
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
  }, [script, id, theme]);

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
