import * as React from "react";
import { createApiKey, listApiKeys, revokeApiKey } from "../lib/data";
import type { ApiKeyView } from "../lib/data";

/**
 * API keys, for a client that cannot be asked for a password.
 *
 * A key authenticates to Cognito and yields an ordinary session carrying the
 * owner's real groups (ADR-0012), so a key sees exactly what its owner sees —
 * no more, and never anything belonging to somebody else.
 *
 * **Read-only is the default**, and a read key genuinely cannot write: the
 * refusal is in the five functions that change things, keyed on the app client
 * the key authenticated against, which Cognito sets and the caller cannot
 * forge. A scope that only the client honoured would not be a scope.
 *
 * The key is shown once. Only its hash is stored, so there is no second
 * chance and the panel says so before minting rather than after.
 */
export function ApiKeys() {
  const [keys, setKeys] = React.useState<ApiKeyView[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [minted, setMinted] = React.useState<ApiKeyView | null>(null);
  const [copied, setCopied] = React.useState(false);
  // Revoked and expired keys are kept — the record of what existed is worth
  // having — but they are not what anyone comes to this screen to read, and
  // after a few rounds of verification they outnumber the live ones.
  const [showDead, setShowDead] = React.useState(false);

  const [name, setName] = React.useState("");
  const [scope, setScope] = React.useState<"read" | "write">("read");
  const [days, setDays] = React.useState(90);

  const refresh = React.useCallback(() => {
    listApiKeys()
      .then(setKeys)
      .catch((err) => {
        setKeys([]);
        setError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  React.useEffect(refresh, [refresh]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const key = await createApiKey({ name: name.trim(), scope, days });
      setMinted(key);
      setCopied(false);
      setName("");
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(key: ApiKeyView) {
    const sure = window.confirm(
      `Revoke "${key.name}"?\n\nAnything using it stops working immediately. ` +
        `This cannot be undone.`
    );
    if (!sure) return;
    setError(null);
    try {
      await revokeApiKey(key.keyId);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const live = (key: ApiKeyView) =>
    !key.revokedAt && Date.parse(key.expiresAt) > Date.now();

  const dead = (keys ?? []).filter((k) => !live(k));
  const shown = showDead ? (keys ?? []) : (keys ?? []).filter(live);

  return (
    <section className="bp-apikeys">
      <p className="bp-muted">
        For a client that cannot be asked for a password — an MCP server on
        another machine, a scheduled export. A key acts as you, and sees exactly
        what you see.
      </p>

      {minted && (
        <div className="bp-apikeys__minted" role="status">
          <h3>Copy this now</h3>
          <p className="bp-muted">
            It will not be shown again. Only a hash is stored, so there is no
            way to recover it — if you lose it, revoke it and make another.
          </p>
          <code className="bp-apikeys__secret">{minted.secret}</code>
          <div className="bp-apikeys__actions">
            <button
              type="button"
              className="bp-button"
              onClick={() => {
                void navigator.clipboard?.writeText(minted.secret ?? "");
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              className="bp-linkbutton"
              onClick={() => setMinted(null)}
            >
              I have it
            </button>
          </div>
          <p className="bp-muted bp-editor__hint">
            For the MCP server:{" "}
            <code>
              BP_USER=you@example.com BP_API_KEY={minted.keyId}…
              {minted.scope === "write" ? " BP_API_KEY_WRITE=1" : ""}
            </code>
          </p>
        </div>
      )}

      <form className="bp-apikeys__form" onSubmit={create}>
        <label className="bp-field">
          <span>Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="hosted-mcp"
            required
          />
        </label>

        <fieldset className="bp-apikeys__scope">
          <legend>Scope</legend>
          <label>
            <input
              type="radio"
              name="scope"
              checked={scope === "read"}
              onChange={() => setScope("read")}
            />
            Read only — query the model and read documents
          </label>
          <label>
            <input
              type="radio"
              name="scope"
              checked={scope === "write"}
              onChange={() => setScope("write")}
            />
            Read and write — can change the model
          </label>
        </fieldset>

        <label className="bp-field">
          <span>Expires after</span>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={180}>180 days</option>
            <option value={365}>365 days</option>
          </select>
        </label>

        <p className="bp-muted bp-editor__hint">
          A key never gets administrator rights, whatever its owner has, and no
          key can create or revoke another. Expiry is not optional.
        </p>

        <button className="bp-button" type="submit" disabled={busy || !name.trim()}>
          {busy ? "Creating…" : "Create key"}
        </button>
      </form>

      {error && (
        <p className="bp-error" role="alert">
          {error}
        </p>
      )}

      {keys === null && <p className="bp-muted">Loading…</p>}
      {keys?.length === 0 && <p className="bp-muted">No keys yet.</p>}

      {dead.length > 0 && (
        <p className="bp-muted">
          <button
            type="button"
            className="bp-linkbutton"
            onClick={() => setShowDead((on) => !on)}
          >
            {showDead ? "Hide" : "Show"} {dead.length} revoked or expired
          </button>
        </p>
      )}

      {shown.length === 0 && keys && keys.length > 0 && !showDead && (
        <p className="bp-muted">No live keys.</p>
      )}

      {shown.length > 0 && (
        <table className="bp-documents__index">
          <thead>
            <tr>
              <th>Name</th>
              <th>Scope</th>
              <th>Last used</th>
              <th>Expires</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((key) => (
              <tr key={key.keyId} className={live(key) ? "" : "bp-apikeys__dead"}>
                <td>
                  {key.name}
                  <div className="bp-muted bp-documents__id">
                    <code>bp_{key.keyId}…</code>
                  </div>
                </td>
                <td>
                  <span
                    className={`bp-tag bp-tag--${
                      key.scope === "write" ? "confidential" : "shared"
                    }`}
                  >
                    {key.scope === "write" ? "Read + write" : "Read only"}
                  </span>
                </td>
                <td className="bp-muted">
                  {key.lastUsedAt ? key.lastUsedAt.slice(0, 10) : "never"}
                </td>
                <td className="bp-muted">
                  {key.revokedAt
                    ? "revoked"
                    : Date.parse(key.expiresAt) < Date.now()
                      ? "expired"
                      : key.expiresAt.slice(0, 10)}
                </td>
                <td>
                  {live(key) && (
                    <button
                      type="button"
                      className="bp-linkbutton bp-linkbutton--danger"
                      onClick={() => void revoke(key)}
                    >
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
