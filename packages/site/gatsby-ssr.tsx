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
}) => {
  setHtmlAttributes({ lang: "en" });
};
