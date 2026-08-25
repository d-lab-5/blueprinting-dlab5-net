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
      key: "releases",
      label: "Releases",
      href: `/p/${slug}/releases/`,
      // A branch rejoining a trunk: the shape the screen actually draws.
      icon: icon(
        <>
          <circle cx="6" cy="5" r="2" />
          <circle cx="6" cy="19" r="2" />
          <circle cx="18" cy="12" r="2" />
          <path d="M6 7v10M8 5h4a4 4 0 0 1 4 4v1M8 19h4a4 4 0 0 0 4-4v-1" />
        </>
      ),
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
      key: "blueprint",
      label: "Blueprint",
      href: `/p/${slug}/blueprint/`,
      // Stacked bands, matching the canvas.
      icon: icon(
        <>
          <rect x="3" y="4" width="18" height="4.5" rx="1.2" />
          <rect x="3" y="9.75" width="18" height="4.5" rx="1.2" />
          <rect x="3" y="15.5" width="18" height="4.5" rx="1.2" />
        </>
      ),
    },
    {
      key: "orgs",
      label: "Teams",
      href: `/p/${slug}/orgs/`,
      icon: icon(
        <>
          <circle cx="9" cy="8" r="3" />
          <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
          <path d="M16 6.5a3 3 0 0 1 0 5.8M17.5 19a5.4 5.4 0 0 0-1.6-3.8" />
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


/**
 * Choosing a project.
 *
 * A select rather than a list of links: the number of projects is unbounded —
 * a rail listing forty of them scrolls the appearance and account sections off
 * the bottom, and the rail stops being navigation. It carries the current
 * project inside one, and starts unselected at the launcher.
 */
function ProjectSwitcher({ slug }: { slug?: string }) {
  const [projects, setProjects] = React.useState<Project[] | null>(null);

  React.useEffect(() => {
    listProjects()
      .then(setProjects)
      .catch(() => setProjects([]));
  }, []);

  const empty = projects !== null && projects.length === 0;

  return (
    <div className="bp-rail__switcher">
      <label className="bp-rail__switcherlabel" htmlFor="bp-project">
        {slug ? "Project" : "Open a project"}
      </label>
      <select
        id="bp-project"
        value={slug ?? ""}
        disabled={empty}
        onChange={(e) => {
          if (!e.target.value) return;
          // A full navigation rather than client routing: every screen reloads
          // its model from the new project anyway, and this keeps the URL and
          // the rail in step without a router dependency.
          window.location.assign(`/p/${e.target.value}/`);
        }}
      >
        {/* At the launcher nothing is open yet, so the control needs a resting
            state that is not a project. */}
        {!slug && (
          <option value="">
            {projects === null
              ? "Loading…"
              : empty
                ? "No projects yet"
                : `Choose one of ${projects.length}…`}
          </option>
        )}
        {/* The current project is always an option, even before the list
            arrives, so the control never renders empty or wrong. */}
        {slug && !projects?.some((p) => p.slug === slug) && (
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

/** A labelled group of rail entries, as the design has them. */
function RailSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bp-rail__section">
      <h2 className="bp-rail__sectionlabel">{label}</h2>
      {children}
    </div>
  );
}

/** Dark/light as a segmented pair rather than one ambiguous icon button. */
function ThemeSegments() {
  const [theme, toggle] = useTheme();
  return (
    <div className="bp-seg" role="group" aria-label="Appearance">
      {(["dark", "light"] as const).map((value) => (
        <button
          key={value}
          type="button"
          className={`bp-seg__option${theme === value ? " bp-seg__option--on" : ""}`}
          aria-pressed={theme === value}
          onClick={() => {
            if (theme !== value) toggle();
          }}
        >
          {value === "dark" ? "☾" : "☀"} {value}
        </button>
      ))}
    </div>
  );
}

interface ShellProps {
  children: React.ReactNode;
  /** Present inside a project; absent at `/`, which is the launcher. */
  project?: { slug: string; active: string };
}

export function Shell({ children, project }: ShellProps) {
  const session = useSession();
  const [railOpen, setRailOpen] = React.useState(true);

  const items = project ? railItems(project.slug) : [];

  return (
    <div className="bp-shell bp-shell--railed">
      <nav
        className={`bp-rail${railOpen ? "" : " bp-rail--closed"}`}
        aria-label={project ? "Project views" : "Workspace"}
      >
        <Link className="bp-rail__brand" to="/">
          <Mark />
          <span>
            blueprinting<span className="bp-rail__brandaccent">.dlab5</span>
          </span>
        </Link>

        {project ? (
          <>
            <ProjectSwitcher slug={project.slug} />
            <RailSection label="Workspace">
              <ul className="bp-rail__items bp-rail__items--workspace">
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
            </RailSection>
          </>
        ) : (
          // At the launcher the rail lists projects rather than views. The
          // views all act on a project, so showing them here would be six
          // controls that cannot do anything until one is chosen.
          // The switcher carries its own label, so wrapping it in a section
          // would stack "Projects" above "Open a project" saying one thing
          // twice.
          <ProjectSwitcher />
        )}

        <RailSection label="Appearance">
          <ThemeSegments />
        </RailSection>

        <RailSection label="Account">
          <ul className="bp-rail__items">
            <li>
              <a
                className="bp-rail__item"
                href="https://github.com/d-lab-5/blueprinting-dlab5-net"
                target="_blank"
                rel="noreferrer noopener"
              >
                {icon(
                  <path d="M9 19c-4 1.5-4-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.3 4.3 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12 12 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.3 4.3 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.4.4-.5.9-.5 1.5V21" />
                )}
                Source
              </a>
            </li>
            <li>
              <button
                type="button"
                className="bp-rail__item bp-rail__item--button"
                onClick={() => void signOutAndReload()}
              >
                {icon(
                  <>
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <path d="M14 17l5-5-5-5M19 12H9" />
                  </>
                )}
                Sign out
              </button>
            </li>
          </ul>
          <p className="bp-rail__who">
            {session.email ?? session.username}
            {session.isAdmin ? " · admin" : ""}
          </p>
        </RailSection>
      </nav>

      <div className="bp-shell__body">
        <header className="bp-shell__header">
          <button
            type="button"
            className="bp-linkbutton bp-shell__railtoggle"
            onClick={() => setRailOpen((open) => !open)}
            aria-label={railOpen ? "Hide menu" : "Show menu"}
            aria-expanded={railOpen}
          >
            ☰
          </button>
          <span className="bp-shell__title">
            {project ? project.slug : "Blueprinting"}
          </span>
          <span className="bp-shell__meta">/ internal · admin-provisioned</span>
          <span className="bp-shell__spacer" />
        </header>

        <main className="bp-shell__main">{children}</main>
      </div>
    </div>
  );
}
