import { Amplify } from "aws-amplify";

/**
 * Configures Amplify for the browser.
 *
 * Imported from gatsby-browser.ts only — never from gatsby-ssr.tsx. Every
 * route on this site sits behind Cognito and renders its data client-side, so
 * there is nothing to configure during server rendering, and keeping it out of
 * SSR means the static build cannot break on a missing or malformed outputs
 * file.
 *
 * The plain `require` is deliberate: `import … with { type: "json" }` is
 * rejected by Gatsby's Babel/webpack pipeline.
 */
let configured = false;

export function configureAmplify(): boolean {
  if (configured) return true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const outputs = require("../amplify_outputs.json");
    Amplify.configure(outputs);
    configured = true;
    return true;
  } catch {
    // Generated at deploy time by `ampx pipeline-deploy` / `ampx sandbox`, so
    // it is absent on a fresh checkout and on a frontend-only rebuild.
    // AuthGate renders an explicit notice instead of crashing the build.
    return false;
  }
}

export function isConfigured(): boolean {
  return configured;
}
