import * as React from "react";
import { isMintedProductId } from "@dlab5/blueprint-core";
import { renameProject } from "../lib/data";
import type { Project } from "../lib/data";

/**
 * Renaming a product.
 *
 * Products get renamed — it is an ordinary life-cycle event, not an error to
 * be prevented — and until ADR-0009 the tool could not do it, because the name
 * was baked into the id at creation and the id is the DynamoDB partition key.
 *
 * Only the name and description are editable. The id is shown because it is
 * what the URL, the storage and the Cognito group are keyed on, and someone
 * looking at a group called `bp-p-7f3k2b9c4d` needs somewhere to look it up.
 */
export function ProductSettings({
  project,
  onRenamed,
}: {
  project: Project;
  onRenamed: (project: Project) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState(project.name);
  const [description, setDescription] = React.useState(project.description ?? "");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  // The row can arrive after this mounts, and a form showing the old values
  // would silently write them back.
  React.useEffect(() => {
    setName(project.name);
    setDescription(project.description ?? "");
  }, [project.name, project.description]);

  const changed =
    name.trim() !== project.name ||
    description.trim() !== (project.description ?? "");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const next = await renameProject({
        slug: project.slug,
        name: name.trim(),
        description: description.trim() || undefined,
      });
      onRenamed(next);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details
      className="bp-settings"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary>Product settings</summary>

      <form className="bp-settings__form" onSubmit={submit}>
        <label className="bp-field">
          <span>Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>

        <label className="bp-field">
          <span>Description</span>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        <p className="bp-muted bp-editor__hint">
          Renaming changes what people see, everywhere. It does not change the
          id <code>{project.slug}</code> or the group{" "}
          <code>{project.group}</code> — neither can be changed{" "}
          {isMintedProductId(project.slug)
            ? "because the model, the storage and the permissions are keyed on the id"
            : "and this product predates minted ids, so its id still reads like its old name"}
          .
        </p>

        {error && (
          <p className="bp-error" role="alert">
            {error}
          </p>
        )}
        {saved && !changed && (
          <p className="bp-muted" role="status">
            Saved.
          </p>
        )}

        <div className="bp-settings__actions">
          <button
            className="bp-button"
            type="submit"
            disabled={busy || !changed || !name.trim()}
          >
            {busy ? "Saving…" : "Save"}
          </button>
          {changed && (
            <button
              type="button"
              className="bp-linkbutton"
              disabled={busy}
              onClick={() => {
                setName(project.name);
                setDescription(project.description ?? "");
                setError(null);
              }}
            >
              Discard
            </button>
          )}
        </div>
      </form>
    </details>
  );
}
