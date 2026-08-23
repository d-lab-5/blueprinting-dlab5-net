import * as React from "react";
import type { HeadFC, PageProps } from "gatsby";
import { Shell } from "../components/Shell";
import { useSession } from "../components/AuthGate";

/**
 * Reached only after AuthGate has a session, so there is no loading or
 * signed-out branch to handle here.
 */
const IndexPage: React.FC<PageProps> = () => {
  const session = useSession();

  return (
    <Shell>
      <h1>Projects</h1>
      <p style={{ color: "var(--bp-text-muted)" }}>
        Each project is a blueprint: an ArchiMate 3.2 model spanning motivation
        through implementation, with the views generated from it.
      </p>

      {session.projectSlugs.length === 0 ? (
        <p>
          You are not a member of any project group yet. Project access is
          granted by adding your account to the project&rsquo;s{" "}
          <code>bp-&lt;slug&gt;</code> group in Cognito.
        </p>
      ) : (
        <ul>
          {session.projectSlugs.map((slug) => (
            <li key={slug}>
              <a href={`/p/${slug}/`}>{slug}</a>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
};

export default IndexPage;

export const Head: HeadFC = () => <title>D-LAB-5 Blueprinting</title>;
