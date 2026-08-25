import * as React from "react";
import { GRID_COLOUR, blocklyTheme } from "../lib/blockly-theme";
import { useTheme } from "./useTheme";
import type { AbModel } from "@dlab5/blueprint-core";

/**
 * The Blockly model editor.
 *
 * Blockly is imported dynamically and injected into a ref-scoped container.
 * Both matter:
 *
 * **Dynamic import**, because Blockly reaches for `document` at module scope,
 * so a static import would run during the Gatsby build and break it — the same
 * reason MermaidView and the Amplify config are browser-only.
 *
 * **Ref-scoped**, not a module-level singleton. DHC Designer's workspace.js
 * keeps its workspace in a module variable, which works until a second canvas
 * is wanted and then does not. The workspace lives and dies with the component
 * here.
 *
 * The workspace is regenerated from the model on every load and is never the
 * record — see packages/blockly/src/transform.ts for why that is not a
 * preference.
 */

interface Props {
  model: AbModel;
  onChange: (next: AbModel) => void;
  /** Reported rather than swallowed: an edit must not vanish silently. */
  onWarnings?: (warnings: string[]) => void;
}

const DEBOUNCE_MS = 400;

export function BlocklyEditor({ model, onChange, onWarnings }: Props) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const workspaceRef = React.useRef<unknown>(null);
  const transformRef = React.useRef<{
    aboxToWorkspace: (m: AbModel) => unknown;
    workspaceToAbox: (s: unknown, slug: string) => { model: AbModel; warnings: string[] };
  } | null>(null);

  /**
   * True while the workspace is being populated programmatically.
   *
   * Blockly fires change events during a load, so without this the first load
   * immediately reports a "change", marks the model dirty and can feed itself
   * back round. The guard is the difference between an editor and a loop.
   */
  const loadingRef = React.useRef(true);

  const [error, setError] = React.useState<string | null>(null);
  const [ready, setReady] = React.useState(false);

  // The latest onChange, so the effect below need not depend on it and tear
  // the whole workspace down whenever the parent re-renders.
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;
  const onWarningsRef = React.useRef(onWarnings);
  onWarningsRef.current = onWarnings;

  const slug = model.projectSlug;
  const [theme] = useTheme();
  const blocklyRef = React.useRef<unknown>(null);

  React.useEffect(() => {
    const Blockly = blocklyRef.current as
      | { Theme: { defineTheme(n: string, t: Record<string, unknown>): unknown };
          Themes: Record<string, unknown> }
      | null;
    const workspace = workspaceRef.current as
      | { setTheme?: (t: unknown) => void }
      | null;
    if (!Blockly || !workspace?.setTheme) return;

    const next = blocklyTheme(Blockly as never, theme);
    // The grid keeps its colour: Blockly fixes it at injection and exposes no
    // way to change it, which is why GRID_COLOUR is chosen to suit both.
    if (next) workspace.setTheme(next);
  }, [theme]);

  React.useEffect(() => {
    let disposed = false;
    let debounce: ReturnType<typeof setTimeout> | undefined;

    (async () => {
      try {
        const [Blockly, generated, transforms] = await Promise.all([
          import("blockly"),
          import("@dlab5/blueprint-blockly"),
          import("@dlab5/blueprint-blockly"),
        ]);
        if (disposed || !containerRef.current) return;

        transformRef.current = {
          aboxToWorkspace: transforms.aboxToWorkspace as never,
          workspaceToAbox: transforms.workspaceToAbox as never,
        };

        // Definitions are global to Blockly, so registering twice on a
        // remount would warn. defineBlocksWithJsonArray overwrites, which is
        // harmless, but only doing it once keeps the console clean.
        const w = window as unknown as { __bpBlocksDefined?: boolean };
        if (!w.__bpBlocksDefined) {
          Blockly.defineBlocksWithJsonArray(generated.generateBlocks() as never);
          w.__bpBlocksDefined = true;
        }

        blocklyRef.current = Blockly;

        const workspace = Blockly.inject(containerRef.current, {
          toolbox: generated.generateToolbox() as never,
          renderer: "zelos",
          theme: (blocklyTheme(Blockly as never, theme) ??
            Blockly.Themes.Zelos) as never,
          grid: { spacing: 24, length: 3, colour: GRID_COLOUR, snap: true },
          zoom: { controls: true, wheel: true, startScale: 0.85 },
          trashcan: true,
          move: { scrollbars: true, drag: true, wheel: false },
        });
        workspaceRef.current = workspace;

        loadingRef.current = true;
        Blockly.serialization.workspaces.load(
          transformRef.current.aboxToWorkspace(model) as never,
          workspace
        );
        loadingRef.current = false;

        workspace.addChangeListener((event: { isUiEvent?: boolean }) => {
          if (loadingRef.current || event.isUiEvent) return;
          if (debounce) clearTimeout(debounce);
          // Converting on every keystroke would re-serialise the whole graph
          // per character. The delay is short enough to feel immediate and
          // long enough to collapse a burst of edits into one.
          debounce = setTimeout(() => {
            if (disposed) return;
            const state = Blockly.serialization.workspaces.save(workspace);
            const result = transformRef.current!.workspaceToAbox(state, slug);
            onWarningsRef.current?.(result.warnings);
            onChangeRef.current(result.model);
          }, DEBOUNCE_MS);
        });

        setReady(true);
      } catch (err) {
        if (!disposed) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      disposed = true;
      if (debounce) clearTimeout(debounce);
      const workspace = workspaceRef.current as { dispose?: () => void } | null;
      workspace?.dispose?.();
      workspaceRef.current = null;
    };
    // Deliberately keyed on the project only. Re-running on every model change
    // would tear down the workspace mid-edit and lose the user's position; the
    // editor owns the workspace once it has been seeded from the model.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  if (error) {
    return (
      <div className="bp-diagram bp-diagram--error" role="alert">
        <p>The editor could not be loaded.</p>
        <pre>{error}</pre>
      </div>
    );
  }

  return (
    <div className="bp-blockly">
      {!ready && <p className="bp-muted bp-blockly__loading">Loading editor…</p>}
      <div ref={containerRef} className="bp-blockly__canvas" />
    </div>
  );
}
