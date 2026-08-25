/**
 * One palette for the roadmap chart and its legend.
 *
 * Mermaid ships its own gantt colours per theme, and until now both the chart
 * and GanttLegend depended on them: the chart by asking for `theme: "dark"`,
 * the legend by hard-coding the hex values that theme happens to use. That was
 * already fragile — the legend's own comment said so — and the light theme
 * broke it outright, because a chart pinned to the dark theme renders dark
 * boxes on a light page.
 *
 * So the colours come from tokens.css instead, in both directions. The legend
 * uses the custom properties directly; mermaid cannot, so the values are read
 * off the document and handed to it as theme variables. One source, and the
 * legend matches the chart by construction rather than by a comment asking
 * someone to remember.
 */

export type GanttState = "done" | "active" | "crit" | "planned" | "milestone";

/** The token behind each state. Referenced as `var(...)` wherever CSS works. */
export const GANTT_TOKENS: Record<GanttState, string> = {
  // A mid grey, not --bp-text-muted. That token is a text colour: in the light
  // theme it is near-black, and a done bar painted with it lands on the chart
  // as a black blob demanding the attention that finished work least needs.
  done: "--bp-border-strong",
  active: "--bp-accent",
  crit: "--bp-danger",
  planned: "--bp-surface-raised",
  milestone: "--bp-border-strong",
};

export const token = (name: string) => `var(${name})`;

/**
 * Resolves the tokens to concrete colours.
 *
 * Returns null during SSR and before the first paint, where there is no
 * computed style to read; the caller waits rather than guessing, because a
 * guessed palette is exactly the drift this module removes.
 */
export function readGanttPalette(): Record<string, string> | null {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return null;
  }

  const style = window.getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim();

  const text = read("--bp-text");
  const accent = read("--bp-accent");
  const border = read("--bp-border");
  const borderStrong = read("--bp-border-strong");
  const surface = read("--bp-surface");
  const surfaceRaised = read("--bp-surface-raised");
  const background = read("--bp-bg");
  const danger = read("--bp-danger");
  const warning = read("--bp-warning");

  // If the stylesheet has not applied yet every value is empty, and handing
  // mermaid a set of empty strings paints an invisible chart.
  if (!text || !accent || !surface) return null;

  return {
    // Bars.
    taskBkgColor: surfaceRaised,
    taskBorderColor: borderStrong,
    activeTaskBkgColor: accent,
    activeTaskBorderColor: accent,
    doneTaskBkgColor: borderStrong,
    doneTaskBorderColor: border,
    critBkgColor: danger,
    critBorderColor: danger,

    // Text. Mermaid picks between these depending on whether the label sits
    // inside a bar or beside it, so all four have to be legible.
    taskTextColor: text,
    taskTextDarkColor: text,
    taskTextLightColor: text,
    taskTextOutsideColor: text,
    taskTextClickableColor: accent,
    titleColor: text,
    sectionBkgColor: surface,
    sectionBkgColor2: background,
    altSectionBkgColor: background,

    gridColor: border,
    todayLineColor: warning,
  };
}
