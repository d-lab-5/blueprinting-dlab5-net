import * as React from "react";
import { mintProductId } from "@dlab5/blueprint-core";
import { createProject } from "../lib/data";
import type { Project } from "../lib/data";

/**
 * Creating a product is an administrative act, because it creates a Cognito
 * group as well as a row. The button is hidden for non-admins for tidiness;
 * the actual check is in the Lambda.
 *
 * There is no slug field any more. The id is minted (ADR-0009) rather than
 * derived from the name, so that renaming later is free — a derived id becomes
 * a lie the moment the product is renamed, and it cannot be corrected because
 * it is the DynamoDB partition key.
 */
export function NewProjectForm({
  onCreated,
}: {
  onCreated: (project: Project) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Minted once per opening of the form, not per keystroke and not inside
  // submit(): the hint below shows the Cognito group this will create, and a
  // group name that changed while you read it would be worse than useless.
  const [id, setId] = React.useState(mintProductId);

  function close() {
    setOpen(false);
    setName("");
    setDescription("");
    setError(null);
    setId(mintProductId());
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const project = await createProject({
        slug: id,
        name: name.trim(),
        description: description.trim() || undefined,
      });
      onCreated(project);
      close();
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
        <span>Description</span>
        <textarea
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>

      <p className="bp-muted bp-editor__hint">
        The name and description can be changed later. The id <code>{id}</code>{" "}
        cannot — it is what the model, the storage and the permissions are keyed
        on, so it is deliberately meaningless.
      </p>

      <p className="bp-muted bp-editor__hint">
        This also creates the Cognito group <code>bp-{id}</code> and adds you to
        it. Everyone else who needs the product has to be added to that group.
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
          onClick={close}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
