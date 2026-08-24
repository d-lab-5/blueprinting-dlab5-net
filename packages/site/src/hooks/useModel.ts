import * as React from "react";
import type { AbModel, Finding } from "@dlab5/blueprint-core";
import { hasErrors, validateModel } from "@dlab5/blueprint-core";
import { ModelConflictError, loadModel, saveModel } from "../lib/data";

export type SaveState = "idle" | "saving" | "saved" | "conflict" | "error";

export interface UseModel {
  model: AbModel | null;
  findings: Finding[];
  loading: boolean;
  /** Load failure. Save failures live in saveState/saveError. */
  error: string | null;
  dirty: boolean;
  saveState: SaveState;
  saveError: string | null;
  /** Applies an edit locally. Nothing reaches S3 until save(). */
  update: (next: AbModel) => void;
  save: () => Promise<void>;
  /** Discards local edits and re-reads. Used to recover from a conflict. */
  reload: () => Promise<void>;
}

/**
 * Owns one project's ABox for the lifetime of a page.
 *
 * The ETag is held alongside the model and passed back on save. That is the
 * whole concurrency story on this side: the backend refuses an unconditional
 * write, so losing the tag means losing the ability to save, and a stale tag
 * comes back as a conflict rather than quietly overwriting a colleague.
 *
 * Edits are local until save() — there is no autosave. With whole-file writes
 * an autosave would turn every keystroke into a revision and every second
 * editor into a conflict.
 */
export function useModel(projectSlug: string): UseModel {
  const [model, setModel] = React.useState<AbModel | null>(null);
  const [etag, setEtag] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const [saveState, setSaveState] = React.useState<SaveState>("idle");
  const [saveError, setSaveError] = React.useState<string | null>(null);

  const read = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { model: loaded, etag: tag } = await loadModel(projectSlug);
      setModel(loaded);
      setEtag(tag);
      setDirty(false);
      setSaveState("idle");
      setSaveError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectSlug]);

  React.useEffect(() => {
    if (!projectSlug) return;
    void read();
  }, [projectSlug, read]);

  const update = React.useCallback((next: AbModel) => {
    setModel(next);
    setDirty(true);
    setSaveState("idle");
    setSaveError(null);
  }, []);

  const save = React.useCallback(async () => {
    if (!model) return;

    // Refuse to store a model the metamodel rejects. The .ttl is the source of
    // truth and is read by Archi, rdflib and the MCP server; a broken graph
    // there is far more expensive than a blocked save here.
    const findings = validateModel(model);
    if (hasErrors(findings)) {
      setSaveState("error");
      setSaveError(
        `Not saved — ${findings.filter((f) => f.severity === "error").length} ` +
          `validation error(s) must be fixed first.`
      );
      return;
    }

    setSaveState("saving");
    setSaveError(null);
    try {
      const next = await saveModel(model, etag);
      setEtag(next);
      setDirty(false);
      setSaveState("saved");
    } catch (err) {
      if (err instanceof ModelConflictError) {
        setSaveState("conflict");
        setSaveError(err.message);
        return;
      }
      setSaveState("error");
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }, [model, etag]);

  const findings = React.useMemo(
    () => (model ? validateModel(model) : []),
    [model]
  );

  return {
    model,
    findings,
    loading,
    error,
    dirty,
    saveState,
    saveError,
    update,
    save,
    reload: read,
  };
}
