import * as React from "react";

/**
 * Light/dark, persisted.
 *
 * The value is written to `<html data-bp-theme>` rather than kept only in
 * React state, so the tokens in tokens.css apply to everything including
 * portals and anything rendered outside the React tree — Blockly injects its
 * own chrome, for instance.
 *
 * The flash of the wrong theme is prevented in gatsby-ssr.tsx, which runs a
 * tiny script before the body paints. This hook only has to agree with what
 * that script already decided, which is why it reads the attribute first
 * rather than starting from a default and correcting.
 */

export type Theme = "dark" | "light";

export const THEME_KEY = "bp-theme";

function current(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.getAttribute("data-bp-theme") === "light"
    ? "light"
    : "dark";
}

export function useTheme(): [Theme, () => void] {
  // Starts as "dark" on the server and on the client's first render, matching
  // what gatsby-ssr emits, so hydration never sees a mismatch. The effect
  // below then adopts whatever the pre-paint script actually chose.
  const [theme, setTheme] = React.useState<Theme>("dark");

  React.useEffect(() => {
    setTheme(current());
  }, []);

  const toggle = React.useCallback(() => {
    setTheme((previous) => {
      const next: Theme = previous === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-bp-theme", next);
      try {
        window.localStorage.setItem(THEME_KEY, next);
      } catch {
        // Private browsing, or storage disabled. The toggle still works for
        // this page; it just will not be remembered.
      }
      return next;
    });
  }, []);

  return [theme, toggle];
}
