import type { GatsbyNode } from "gatsby";

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
