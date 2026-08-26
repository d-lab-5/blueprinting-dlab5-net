import type { GatsbyNode } from "gatsby";

/**
 * Two adjustments, both only for the SSR bundle.
 *
 * `node:` builtins are left as runtime requires. The HTML renderer runs in
 * Node, so bundling them is neither necessary nor possible — webpack fails
 * outright with "Reading from node:sqlite is not handled by plugins". They
 * reach the graph through a transitive dependency that guards its use at
 * runtime, which webpack cannot see.
 *
 * Blockly is nulled out entirely. It touches `document` at module scope and
 * the editor never renders during a build — AuthGate short-circuits to its
 * neutral frame with no window — so there is nothing for SSR to gain by
 * carrying it.
 */
export const onCreateWebpackConfig: GatsbyNode["onCreateWebpackConfig"] = ({
  stage,
  actions,
  loaders,
}) => {
  if (stage !== "build-html" && stage !== "develop-html") return;

  actions.setWebpackConfig({
    module: {
      rules: [
        { test: /node_modules[\\/]blockly/, use: loaders.null() },
      ],
    },
    externals: [
      ({ request }: { request?: string }, callback: (err?: unknown, result?: string) => void) =>
        request?.startsWith("node:")
          ? callback(undefined, `commonjs ${request}`)
          : callback(),
    ],
  });
};

/**
 * Project routes are client-only.
 *
 * A project's model is authenticated per-Cognito-group data living in S3, so
 * there is nothing to statically render and no build-time list of slugs to
 * render it from. `matchPath` lets Gatsby serve /p/<slug>/... from a single
 * page component that reads the slug at runtime.
 */
export const onCreatePage: GatsbyNode["onCreatePage"] = async ({
  page,
  actions,
}) => {
  if (page.path === "/p/") {
    actions.deletePage(page);
    actions.createPage({ ...page, matchPath: "/p/*" });
  }
};
