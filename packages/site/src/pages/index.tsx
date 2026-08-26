import * as React from "react";
import type { HeadFC, PageProps } from "gatsby";
import { Shell } from "../components/Shell";
import { useSession } from "../components/AuthGate";
import { listProjects } from "../lib/data";
import type { Project } from "../lib/data";
import { NewProjectForm } from "../components/NewProjectForm";
import { toHexNavigator } from "@dlab5/blueprint-core";

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

  const [creating, setCreating] = React.useState(false);

  return (
    <Shell>
      <div className="bp-hero">
        <div className="bp-hero__copy">
          {/* No standing copy here. The blueprint tiles below say what this
              page is for, and a paragraph explaining the product to someone
              who has already signed in is a paragraph nobody reads twice. */}
          {session.isAdmin && (
            <div className="bp-hero__actions">
              <button
                type="button"
                className="bp-button"
                onClick={() => setCreating(true)}
              >
                Start the design process
              </button>
            </div>
          )}

          <dl className="bp-stats">
            <div className="bp-stat">
              <dt>{projects?.length ?? "—"}</dt>
              <dd>Blueprints</dd>
            </div>
            <div className="bp-stat">
              <dt>{session.groups.filter((g) => g.startsWith("bp-")).length}</dt>
              <dd>Groups you hold</dd>
            </div>
            <div className="bp-stat">
              <dt>3.2</dt>
              <dd>ArchiMate version</dd>
            </div>
          </dl>
        </div>

        {/* The hexagon from the Domains navigator, as the hero's art. It is
            the same figure the model screen draws, which is the point: the
            landing shows the thing rather than an illustration of it. */}
        <HeroHexagon />
      </div>

      {session.isAdmin && creating && (
        <NewProjectForm
          onCreated={(project) => {
            setProjects((current) => [...(current ?? []), project]);
            setCreating(false);
          }}
        />
      )}

      {/* The page heading, now that the hero carries none. A page whose only
          headings are h2s has no subject. */}
      <h1 className="bp-cards__heading">
        Blueprints
      </h1>

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

/**
 * The nested hexagon, drawn small and unlabelled.
 *
 * Deliberately the same geometry the Domains screen uses rather than a picture
 * of it — one source for the shape, and a reader recognises the screen when
 * they reach it.
 */
function HeroHexagon() {
  const nav = React.useMemo(
    () =>
      toHexNavigator(
        (
          [
            ["motivation", 0, 0],
            ["strategy", 1, 0],
            ["business", 2, 0],
            ["application", 2, 1],
            ["technology", 2, 2],
            ["physical", 3, 0],
            ["implementation", 3, 1],
            ["composite", 3, 2],
          ] as const
        ).map(([id, band, wedge]) => ({ id, label: id, band, wedge })),
        { bandStartAngle: { 3: 60 } }
      ),
    []
  );

  return (
    <svg
      className="bp-hero__art"
      viewBox={`0 0 ${nav.size} ${nav.size}`}
      aria-hidden="true"
    >
      {nav.cells.map((cell) => (
        <path
          key={cell.id}
          d={cell.path}
          fillRule={cell.ring ? "evenodd" : undefined}
          fill={`var(--bp-layer-${cell.id})`}
          fillOpacity={0.14}
          stroke={`var(--bp-layer-${cell.id}-line)`}
          strokeOpacity={0.55}
        />
      ))}
    </svg>
  );
}

export default IndexPage;

export const Head: HeadFC = () => <title>Projects — D-LAB-5 Blueprinting</title>;
