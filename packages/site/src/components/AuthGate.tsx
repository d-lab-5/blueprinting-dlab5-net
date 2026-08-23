import * as React from "react";
import {
  confirmSignIn,
  fetchAuthSession,
  getCurrentUser,
  signIn,
  signOut,
} from "aws-amplify/auth";
import { isConfigured } from "../lib/amplify";

export interface Session {
  username: string;
  email?: string;
  groups: string[];
  isAdmin: boolean;
  /** Cognito groups named `bp-<slug>` map 1:1 to projects the user can open. */
  projectSlugs: string[];
}

const AuthContext = React.createContext<Session | null>(null);

/** Throws outside AuthGate, which cannot happen: AuthGate wraps every page. */
export function useSession(): Session {
  const session = React.useContext(AuthContext);
  if (!session) throw new Error("useSession used outside AuthGate");
  return session;
}

export const ADMIN_GROUP = "bp-admins";
const PROJECT_GROUP_PREFIX = "bp-";

async function readSession(): Promise<Session> {
  // getCurrentUser() first: it only needs the user pool. fetchAuthSession()
  // additionally touches the identity pool, and the DHC Portal learned that a
  // misconfigured identity pool there should degrade the session, not drop an
  // otherwise signed-in user back to the sign-in form.
  const user = await getCurrentUser();

  let groups: string[] = [];
  let email: string | undefined;
  try {
    const session = await fetchAuthSession();
    const payload = session.tokens?.idToken?.payload ?? {};
    groups = (payload["cognito:groups"] as string[] | undefined) ?? [];
    email = payload.email as string | undefined;
  } catch (err) {
    console.warn("[blueprinting] could not read auth session claims", err);
  }

  return {
    username: user.username,
    email,
    groups,
    isAdmin: groups.includes(ADMIN_GROUP),
    projectSlugs: groups
      .filter((g) => g.startsWith(PROJECT_GROUP_PREFIX) && g !== ADMIN_GROUP)
      .map((g) => g.slice(PROJECT_GROUP_PREFIX.length)),
  };
}

/* -------------------------------------------------------------------------- */

function SignInForm({ onSignedIn }: { onSignedIn: () => Promise<void> }) {
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [needsNewPassword, setNeedsNewPassword] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (needsNewPassword) {
        await confirmSignIn({ challengeResponse: newPassword });
      } else {
        const res = await signIn({ username: email, password });
        // Accounts are created by an admin with a temporary password, so this
        // challenge is the normal first-login path, not an edge case.
        if (
          res.nextStep?.signInStep ===
          "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED"
        ) {
          setNeedsNewPassword(true);
          setBusy(false);
          return;
        }
      }
      await onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <main className="bp-gate">
      <form className="bp-gate__card" onSubmit={submit}>
        <h1 className="bp-gate__title">D-LAB-5 Blueprinting</h1>
        <p className="bp-gate__subtitle">
          {needsNewPassword
            ? "Choose a new password to finish setting up your account."
            : "Sign in to continue."}
        </p>

        {needsNewPassword ? (
          <label className="bp-field">
            <span>New password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
          </label>
        ) : (
          <>
            <label className="bp-field">
              <span>Email</span>
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label className="bp-field">
              <span>Password</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
          </>
        )}

        {error && (
          <p className="bp-gate__error" role="alert">
            {error}
          </p>
        )}

        <button className="bp-button" type="submit" disabled={busy}>
          {busy ? "Signing in…" : needsNewPassword ? "Set password" : "Sign in"}
        </button>

        <p className="bp-gate__note">
          Accounts are created by a platform administrator. There is no
          self-service sign-up.
        </p>
      </form>
    </main>
  );
}

function Unconfigured() {
  return (
    <main className="bp-gate">
      <div className="bp-gate__card">
        <h1 className="bp-gate__title">Backend not configured</h1>
        <p className="bp-gate__subtitle">
          This build has no <code>amplify_outputs.json</code>. Run{" "}
          <code>npm run backend:sandbox</code> then{" "}
          <code>npm run backend:sync-outputs</code>, or redeploy the branch so
          the backend phase runs.
        </p>
      </div>
    </main>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Gatsby renders every page at build time with no window and no Amplify. The
 * gate is the single place that knows this: during SSR it always renders the
 * neutral frame and never its children, so page components — which may call
 * useSession() freely — only ever run in the browser behind a real session.
 */
const isBrowser = typeof window !== "undefined";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<"loading" | "out" | "in">("loading");
  const [session, setSession] = React.useState<Session | null>(null);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  const refresh = React.useCallback(async () => {
    try {
      const next = await readSession();
      setSession(next);
      setState("in");
    } catch {
      setSession(null);
      setState("out");
    }
  }, []);

  React.useEffect(() => {
    if (!isConfigured()) return;
    void refresh();
  }, [refresh]);

  // The neutral frame is what the build emits for every page AND what the
  // client renders on its very first pass, so hydration always matches before
  // any state moves. Gating on `mounted` as well as `isBrowser` matters for
  // the unconfigured case, which would otherwise render <Unconfigured/> on the
  // client against a blank frame from the server.
  if (!isBrowser || !mounted) {
    return <main className="bp-gate" aria-busy="true" />;
  }

  if (!isConfigured()) return <Unconfigured />;

  // Render nothing rather than the app while we do not yet know: showing the
  // shell first and swapping it for a sign-in form is the flash of
  // authenticated content the gate exists to prevent.
  if (state === "loading") return <main className="bp-gate" aria-busy="true" />;

  if (state === "out" || !session) return <SignInForm onSignedIn={refresh} />;

  return (
    <AuthContext.Provider value={session}>{children}</AuthContext.Provider>
  );
}

export async function signOutAndReload(): Promise<void> {
  await signOut();
  window.location.assign("/");
}
