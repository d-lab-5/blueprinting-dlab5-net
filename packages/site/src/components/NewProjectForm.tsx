import * as React from "react";
import { slugifyId } from "@dlab5/blueprint-core";
import { createProject } from "../lib/data";
import type { Project } from "../lib/data";

/**
 * Creating a project is an administrative act, because it creates a Cognito
 * group as well as a row. The button is hidden for non-admins for tidiness;
 * the actual check is in the Lambda.
 */
export function NewProjectForm({
  onCreated,
}: {
  onCreated: (project: Project) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [description, setDescription] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // The slug follows the name until someone edits it, then stops — surprising
  // a user by rewriting a slug they deliberately chose is worse than making
  // them type it.
  const effectiveSlug = slugTouched ? slug : slugifyId(name);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const project = await createProject({
        slug: effectiveSlug,
        name: name.trim(),
        description: description.trim() || undefined,
      });
      onCreated(project);
      setOpen(false);
      setName("");
      setSlug("");
      setSlugTouched(false);
      setDescription("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className="bp-button bp-newproject__open"
        onClick={() => setOpen(true)}
      >
        New product
      </button>
    );
  }

  return (
    <form className="bp-newproject" onSubmit={submit}>
      <h2>New product</h2>

      <label className="bp-field">
        <span>Name</span>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="SAP ECC Upgrade"
          required
        />
      </label>

      <label className="bp-field">
        <span>Slug</span>
        <input
          value={effectiveSlug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(slugifyId(e.target.value));
          }}
          pattern="[a-z0-9][a-z0-9-]{1,48}[a-z0-9]"
          required
        />
      </label>

      <label className="bp-field">
        <span>Description</span>
        <textarea
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>

      <p className="bp-muted bp-editor__hint">
        This also creates the Cognito group <code>bp-{effectiveSlug || "…"}</code>{" "}
        and adds you to it. Everyone else who needs the product has to be added
        to that group.
      </p>

      {error && (
        <p className="bp-error" role="alert">
          {error}
        </p>
      )}

      <div className="bp-newproject__actions">
        <button className="bp-button" type="submit" disabled={busy || !name}>
          {busy ? "Creating…" : "Create product"}
        </button>
        <button
          type="button"
          className="bp-linkbutton"
          onClick={() => setOpen(false)}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
