import * as React from "react";
import type { HeadFC, PageProps } from "gatsby";
import { Shell } from "../components/Shell";
import { useSession } from "../components/AuthGate";

/**
 * Client-only route for everything under /p/. gatsby-node.ts rewrites this
 * page's path to the matchPath /p/*, so the slug is only knowable at runtime —
 * there is no build-time list of projects, because the list depends on who is
 * asking.
 *
 * WP3 replaces the body with the real project workspace; for now it proves the
 * routing and the group check.
 */
const ProjectPage: React.FC<PageProps> = ({ location }) => {
  const session = useSession();
  const slug = location.pathname.replace(/^\/p\/?/, "").replace(/\/.*$/, "");

  if (!slug) {
    return (
      <Shell>
        <h1>No project selected</h1>
        <p>
          <a href="/">Back to projects</a>
        </p>
      </Shell>
    );
  }

  const permitted = session.isAdmin || session.projectSlugs.includes(slug);

  return (
    <Shell>
      <h1>{slug}</h1>
      {permitted ? (
        <p style={{ color: "var(--bp-text-muted)" }}>
          Model workspace lands in WP3. This route is live and you are in{" "}
          <code>bp-{slug}</code>.
        </p>
      ) : (
        <p>
          You are not a member of <code>bp-{slug}</code>. Nothing on this page
          is the security boundary — the model itself is refused server-side by
          the storage proxy.
        </p>
      )}
    </Shell>
  );
};

export default ProjectPage;

export const Head: HeadFC = () => <title>Project — D-LAB-5 Blueprinting</title>;
