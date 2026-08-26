import * as React from "react";
import type { WrapPageElementBrowserArgs } from "gatsby";
import { AuthGate } from "./components/AuthGate";

/**
 * Shared by gatsby-browser and gatsby-ssr so the element tree is identical on
 * both sides. If only the browser wrapped pages, server rendering would call
 * page components directly and `useSession()` would throw — and the markup the
 * client hydrates would not match what the server produced.
 */
export const wrapPageElement = ({
  element,
}: Pick<WrapPageElementBrowserArgs, "element">) => (
  <AuthGate>{element}</AuthGate>
);
