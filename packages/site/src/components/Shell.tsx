import * as React from "react";
import { Link } from "gatsby";
import { signOutAndReload, useSession } from "./AuthGate";

/**
 * The one application shell. There is deliberately not a second one — the DHC
 * Portal ended up with two competing shells and two font systems, and the
 * seam between them is still visible.
 */
export function Shell({ children }: { children: React.ReactNode }) {
  const session = useSession();

  return (
    <div className="bp-shell">
      <header className="bp-shell__header">
        <Link className="bp-shell__brand" to="/">
          D-LAB-5 Blueprinting
        </Link>
        <span className="bp-shell__spacer" />
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
  );
}
