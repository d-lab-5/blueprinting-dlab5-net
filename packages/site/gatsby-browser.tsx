import type { GatsbyBrowser } from "gatsby";
import { configureAmplify } from "./src/lib/amplify";
import { wrapPageElement as wrap } from "./src/wrap-page-element";
import "./src/styles/tokens.css";
import "./src/styles/global.css";

configureAmplify();

/**
 * One gate over the whole site.
 *
 * The spec is explicit that there is no guest tier and the landing page is the
 * sign-in page, so guarding routes individually — the pattern the DHC Portal
 * grew, a copy-pasted `useEffect(() => navigate("/signin"))` in every page —
 * would mean every new page is unprotected until someone remembers. Wrapping
 * at the root makes "authenticated" the default and forgetting impossible.
 */
export const wrapPageElement: GatsbyBrowser["wrapPageElement"] = wrap;
