/**
 * A Blockly workspace theme built from tokens.css.
 *
 * Blockly paints its own chrome — workspace, toolbox, flyout, scrollbars — and
 * ships themes with fixed colours. The editor used Zelos with a hard-coded
 * dark grid, which was already a slight mismatch against the app and became a
 * real one when the light theme arrived: a dark grid on a white workspace, and
 * a toolbox that belonged to neither theme.
 *
 * Blockly cannot read CSS custom properties, so the values are resolved off
 * the document and handed over, the same approach as the Mermaid palette.
 *
 * Block colours are NOT set here. Those come from the ArchiMate layer pastels
 * via the generated block definitions, and CLAUDE.md is explicit that they are
 * not free choices: a block, a D2 node and a legend swatch have to agree with
 * what a reader sees in Archi. They are the same in both themes on purpose.
 */

/* Blockly is loaded dynamically, so it is typed structurally here rather than
   imported — importing it would pull `document` into the module graph, which
   is the whole reason the editor imports it inside an effect. */
interface BlocklyTheme {
  name: string;
}

interface BlocklyLike {
  Theme: {
    defineTheme(name: string, theme: Record<string, unknown>): BlocklyTheme;
  };
  Themes: Record<string, unknown>;
}

/**
 * A grid colour that works against both themes.
 *
 * Deliberately not a token. Blockly fixes the grid colour when the workspace
 * is injected and offers no public way to change it afterwards, so a token
 * would be correct at load and wrong after the first toggle. Slate 400 at low
 * alpha is legible on the dark ground and on the light one, and being
 * translucent it stays subordinate to whatever is behind it.
 */
export const GRID_COLOUR = "rgba(148, 163, 184, 0.28)";

const cache = new Map<string, BlocklyTheme>();

export function blocklyTheme(
  Blockly: BlocklyLike,
  theme: "dark" | "light"
): BlocklyTheme | undefined {
  const cached = cache.get(theme);
  if (cached) return cached;

  if (typeof document === "undefined") return undefined;
  const style = window.getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim();

  const surface = read("--bp-surface");
  const bg = read("--bp-bg");
  const text = read("--bp-text");
  const accent = read("--bp-accent");
  const border = read("--bp-border-strong");

  // Before the stylesheet applies every value is empty, and a theme of empty
  // strings paints an unreadable workspace. Falling back to Blockly's own
  // theme is better than painting nothing.
  if (!surface || !text || !accent) return undefined;

  const defined = Blockly.Theme.defineTheme(`bp-${theme}`, {
    base: Blockly.Themes.Zelos,
    componentStyles: {
      workspaceBackgroundColour: bg,
      toolboxBackgroundColour: surface,
      toolboxForegroundColour: text,
      flyoutBackgroundColour: surface,
      flyoutForegroundColour: text,
      flyoutOpacity: 1,
      scrollbarColour: border,
      scrollbarOpacity: 0.6,
      insertionMarkerColour: accent,
      insertionMarkerOpacity: 0.5,
      markerColour: accent,
      cursorColour: accent,
    },
  });

  cache.set(theme, defined);
  return defined;
}
