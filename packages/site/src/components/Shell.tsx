import * as React from "react";
import { Link } from "gatsby";
import { signOutAndReload, useSession } from "./AuthGate";
import { useTheme } from "./useTheme";
import { listProjects } from "../lib/data";
import type { Project } from "../lib/data";

/**
 * The one application shell.
 *
 * Two layouts, one component. At `/` there is no project, so there is nothing
 * for a rail to navigate and it renders a plain header over the project list.
 * Inside a project it renders the left rail from the design: a project
 * switcher at the head, then the views.
 *
 * The rail is per-project rather than global, which is where this departs from
 * the prototype. The prototype has no notion of a project at all — its rail is
 * global and assumes a single model — but a project is this platform's
 * authorization boundary, with its own Cognito group, so navigation cannot sit
 * above it.
 */

export interface RailItem {
  key: string;
  label: string;
  href: string;
  icon: React.ReactNode;
}

const icon = (path: React.ReactNode) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {path}
  </svg>
);

export function railItems(slug: string): RailItem[] {
  return [
    {
      key: "roadmap",
      label: "Roadmap",
      href: `/p/${slug}/`,
      icon: icon(<path d="M4 6h16M4 12h11M4 18h7" />),
    },
    {
      key: "views",
      label: "Views",
      href: `/p/${slug}/views/`,
      icon: icon(
        <>
          <rect x="3" y="4" width="7" height="6" rx="1.4" />
          <rect x="14" y="14" width="7" height="6" rx="1.4" />
          <path d="M6.5 10v6h7.5" />
        </>
      ),
    },
    {
      key: "radar",
      label: "Radar",
      href: `/p/${slug}/radar/`,
      icon: icon(
        <>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5" />
          <circle cx="12" cy="12" r="1.4" />
        </>
      ),
    },
    {
      key: "domains",
      label: "Domains",
      href: `/p/${slug}/domains/`,
      // Nested hexagons, matching the navigator the screen actually draws.
      icon: icon(
        <>
          <path d="M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z" />
          <path d="M12 8l4.1 2.375v4.75L12 17.5l-4.1-2.375v-4.75z" />
        </>
      ),
    },
    {
      key: "blocks",
      label: "Blocks",
      href: `/p/${slug}/blocks/`,
      icon: icon(
        <>
          <rect x="3" y="4" width="8" height="6" rx="1.4" />
          <rect x="3" y="14" width="8" height="6" rx="1.4" />
          <path d="M11 7h4a2 2 0 0 1 2 2v8" />
        </>
      ),
    },
  ];
}

function Mark() {
  return (
    <span className="bp-mark" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7h7v7H3z" />
        <path d="M14 10h7v7h-7z" />
        <path d="M10 10h4" />
      </svg>
    </span>
  );
}

function ThemeToggle() {
  const [theme, toggle] = useTheme();
  return (
    <button
      type="button"
      className="bp-linkbutton bp-shell__theme"
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      title={theme === "dark" ? "Light theme" : "Dark theme"}
    >
      {theme === "dark" ? "☀" : "☾"}
    </button>
  );
}

/** The switcher at the head of the rail. Loads lazily; the rail works without it. */
function ProjectSwitcher({ slug }: { slug: string }) {
  const [projects, setProjects] = React.useState<Project[] | null>(null);

  React.useEffect(() => {
    listProjects()
      .then(setProjects)
      .catch(() => setProjects([]));
  }, []);

  return (
    <div className="bp-rail__switcher">
      <label className="bp-rail__switcherlabel" htmlFor="bp-project">
        Project
      </label>
      <select
        id="bp-project"
        value={slug}
        onChange={(e) => {
          // A full navigation rather than client routing: every screen reloads
          // its model from the new project anyway, and this keeps the URL and
          // the rail in step without a router dependency.
          window.location.assign(`/p/${e.target.value}/`);
        }}
      >
        {/* The current project is always an option, even before the list
            arrives, so the control never renders empty or wrong. */}
        {!projects?.some((p) => p.slug === slug) && (
          <option value={slug}>{slug}</option>
        )}
        {projects?.map((p) => (
          <option key={p.slug} value={p.slug}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );
}

interface ShellProps {
  children: React.ReactNode;
  /** Present inside a project; absent at `/`, where there is no rail. */
  project?: { slug: string; active: string };
}

export function Shell({ children, project }: ShellProps) {
  const session = useSession();
  const [railOpen, setRailOpen] = React.useState(true);

  const items = project ? railItems(project.slug) : [];

  return (
    <div className={`bp-shell${project ? " bp-shell--railed" : ""}`}>
      {project && (
        <nav
          className={`bp-rail${railOpen ? "" : " bp-rail--closed"}`}
          aria-label="Project views"
        >
          <Link className="bp-rail__brand" to="/">
            <Mark />
            <span>
              blueprinting<span className="bp-rail__brandaccent">.dlab5</span>
            </span>
          </Link>

          <ProjectSwitcher slug={project.slug} />

          <ul className="bp-rail__items">
            {items.map((item) => (
              <li key={item.key}>
                <a
                  href={item.href}
                  className={`bp-rail__item${
                    item.key === project.active ? " bp-rail__item--on" : ""
                  }`}
                  aria-current={item.key === project.active ? "page" : undefined}
                >
                  {item.icon}
                  {item.label}
                  {item.key === project.active && (
                    <span className="bp-rail__dot" aria-hidden="true" />
                  )}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <div className="bp-shell__body">
        <header className="bp-shell__header">
          {project ? (
            <button
              type="button"
              className="bp-linkbutton bp-shell__railtoggle"
              onClick={() => setRailOpen((open) => !open)}
              aria-label={railOpen ? "Hide menu" : "Show menu"}
              aria-expanded={railOpen}
            >
              ☰
            </button>
          ) : (
            <Link className="bp-shell__brand" to="/">
              <Mark />
              D-LAB-5 Blueprinting
            </Link>
          )}

          <span className="bp-shell__spacer" />
          <ThemeToggle />
          <span className="bp-shell__user">
            {session.email ?? session.username}
            {session.isAdmin ? " · admin" : ""}
          </span>
          <button
            className="bp-linkbutton"
            type="button"
            onClick={() => void signOutAndReload()}
          >
            Sign out
          </button>
        </header>

        <main className="bp-shell__main">{children}</main>
      </div>
    </div>
  );
}
