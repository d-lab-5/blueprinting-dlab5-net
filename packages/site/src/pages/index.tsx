import * as React from "react";
import type { HeadFC, PageProps } from "gatsby";
import { Shell } from "../components/Shell";
import { useSession } from "../components/AuthGate";
import { listProjects } from "../lib/data";
import type { Project } from "../lib/data";
import { NewProjectForm } from "../components/NewProjectForm";

/**
 * Reached only after AuthGate has a session, so there is no signed-out branch
 * to handle here.
 */
const IndexPage: React.FC<PageProps> = () => {
  const session = useSession();
  const [projects, setProjects] = React.useState<Project[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    listProjects()
      .then(setProjects)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : String(err))
      );
  }, []);

  return (
    <Shell>
      <h1>Projects</h1>
      <p className="bp-lede">
        Each project is a blueprint: an ArchiMate 3.2 model spanning motivation
        through implementation, with the views generated from it.
      </p>

      {session.isAdmin && (
        <NewProjectForm
          onCreated={(project) =>
            setProjects((current) => [...(current ?? []), project])
          }
        />
      )}

      {error && (
        <p className="bp-error" role="alert">
          {error}
        </p>
      )}

      {!projects && !error && <p className="bp-muted">Loading…</p>}

      {projects?.length === 0 && (
        <div className="bp-empty">
          <p>
            {session.isAdmin
              ? "No projects yet."
              : "You do not have access to any project."}
          </p>
          <p className="bp-muted">
            {session.isAdmin ? (
              <>Use &ldquo;New project&rdquo; above to create the first one.</>
            ) : (
              <>
                Access is granted by adding your account to a project&rsquo;s{" "}
                <code>bp-&lt;slug&gt;</code> group in Cognito. Ask a platform
                administrator.
              </>
            )}
          </p>
        </div>
      )}

      {projects && projects.length > 0 && (
        <ul className="bp-cards">
          {projects.map((project) => (
            <li key={project.slug}>
              <a className="bp-card" href={`/p/${project.slug}/`}>
                <span className="bp-card__title">{project.name}</span>
                {project.description && (
                  <span className="bp-card__body">{project.description}</span>
                )}
                <span className="bp-card__meta">
                  <code>{project.slug}</code>
                  {project.lockedBy && <> · being edited by {project.lockedBy}</>}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
};

export default IndexPage;

export const Head: HeadFC = () => <title>Projects — D-LAB-5 Blueprinting</title>;
