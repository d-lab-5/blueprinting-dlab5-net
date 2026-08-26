import * as React from "react";
import type { GatsbySSR } from "gatsby";
import { wrapPageElement as wrap } from "./src/wrap-page-element";

/**
 * The gate is mounted here too, but Amplify is deliberately NOT configured.
 *
 * AuthGate short-circuits to its neutral frame whenever there is no `window`,
 * so page components never run during the build. That is what keeps two
 * properties true at once: the static artefact contains no authenticated
 * content and cannot break on a missing amplify_outputs.json, and the markup
 * React hydrates matches what the server emitted.
 */
export const wrapPageElement: GatsbySSR["wrapPageElement"] = wrap;

export const onRenderBody: GatsbySSR["onRenderBody"] = ({
  setHtmlAttributes,
  setPreBodyComponents,
  setHeadComponents,
}) => {
  // Cast: Gatsby types setHtmlAttributes against React's HTML props, which do
  // not include data-* even though the DOM and React both accept them.
  setHtmlAttributes({ lang: "en", "data-bp-theme": "dark" } as Record<
    string,
    string
  >);

  // Without an explicit icon link a browser requests /favicon.ico on every
  // page, which this site does not serve — a 404 on every view. One SVG covers
  // every size; the theme-colour tints mobile browser chrome to match the
  // palette the page is about to paint.
  setHeadComponents([
    <link key="bp-icon" rel="icon" href="/favicon.svg" type="image/svg+xml" />,
    <meta
      key="bp-theme-light"
      name="theme-color"
      content="#f1f5f9"
      media="(prefers-color-scheme: light)"
    />,
    <meta
      key="bp-theme-dark"
      name="theme-color"
      content="#0f172a"
      media="(prefers-color-scheme: dark)"
    />,
  ]);

  // Applies the stored theme before the body paints.
  //
  // Without this the page renders dark, React hydrates, and only then does the
  // stored preference apply — a visible flash on every load for anyone who
  // chose light. It has to be inline and synchronous in <head>; a React effect
  // is by definition too late.
  //
  // Emitting data-bp-theme="dark" above means the server output and the
  // client's first render agree, so this script is the only thing that ever
  // changes it and hydration never sees a mismatch.
  setPreBodyComponents([
    <script
      key="bp-theme"
      dangerouslySetInnerHTML={{
        __html:
          "try{var t=localStorage.getItem('bp-theme');" +
          "if(t==='light')document.documentElement.setAttribute('data-bp-theme','light');}" +
          "catch(e){}",
      }}
    />,
  ]);
};
