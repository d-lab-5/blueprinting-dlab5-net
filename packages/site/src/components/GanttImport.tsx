import * as React from "react";
import { fromMermaidGantt } from "@dlab5/blueprint-core";
import type { AbModel } from "@dlab5/blueprint-core";

/**
 * Reads a Mermaid Gantt chart into the model.
 *
 * An on-ramp for someone who already has a chart, and deliberately not a
 * round-trip: Mermaid has no Deliverable, no Gap and no realization chain, so
 * importing an exported chart does not return the model it came from. The
 * panel says so rather than leaving it to be discovered.
 *
 * It ADDS rather than replaces, and adds only to the in-memory model — nothing
 * reaches S3 until Save model is pressed. So a bad paste costs a navigation
 * away, not a damaged project. Replacing would be the destructive reading of
 * an ambiguous button, and this one is not worth guessing about.
 */
export function GanttImport({
  model,
  onChange,
}: {
  model: AbModel;
  onChange: (next: AbModel) => void;
}) {
  const [source, setSource] = React.useState("");

  const preview = React.useMemo(() => {
    if (!source.trim()) return null;
    try {
      return fromMermaidGantt(source, model.projectSlug);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) } as const;
    }
  }, [source, model.projectSlug]);

  const ok = preview && !("error" in preview) ? preview : null;

  const apply = () => {
    if (!ok) return;
    // Ids come from the imported names and could collide with what is already
    // there, so they are made unique against the existing model rather than
    // only against each other.
    const taken = new Set(model.elements.map((e) => e.id));
    const remap = new Map<string, string>();
    for (const el of ok.model.elements) {
      let id = el.id;
      let n = 2;
      while (taken.has(id)) id = `${el.id}-${n++}`;
      taken.add(id);
      remap.set(el.id, id);
    }

    const relIds = new Set(model.relationships.map((r) => r.id));
    const relationships = ok.model.relationships.map((r) => {
      let id = r.id;
      let n = 2;
      while (relIds.has(id)) id = `${r.id}-${n++}`;
      relIds.add(id);
      return {
        ...r,
        id,
        source: remap.get(r.source) ?? r.source,
        target: remap.get(r.target) ?? r.target,
      };
    });

    onChange({
      ...model,
      elements: [
        ...model.elements,
        ...ok.model.elements.map((el) => ({ ...el, id: remap.get(el.id)! })),
      ],
      relationships: [...model.relationships, ...relationships],
    });
    setSource("");
  };

  return (
    <details className="bp-import">
      <summary>Import a Mermaid Gantt</summary>

      <p className="bp-muted bp-import__note">
        One way, and lossy. A Gantt is a schedule; this model is a schedule plus
        the structure that gives it meaning. Sections arrive as Plateaus, tasks
        as Work Packages and milestones as Implementation Events —{" "}
        <strong>Deliverables and Gaps cannot be expressed in Mermaid and will
        not appear.</strong> Imported work attaches to its plateau directly,
        which validation flags as a derived relationship; adding the
        Deliverables it stands in for is what clears that.
      </p>

      <label className="bp-field">
        <span>Chart source</span>
        <textarea
          rows={8}
          value={source}
          spellCheck={false}
          placeholder={"gantt\n    section Foundations\n    Lay the slab :done, t1, 2026-01-01, 2026-01-10"}
          onChange={(e) => setSource(e.target.value)}
        />
      </label>

      {preview && "error" in preview && (
        <p className="bp-gate__error">{preview.error}</p>
      )}

      {ok && (
        <>
          <p className="bp-import__summary">
            {ok.sections} plateau{ok.sections === 1 ? "" : "s"}, {ok.tasks} work
            package{ok.tasks === 1 ? "" : "s"}, {ok.milestones} milestone
            {ok.milestones === 1 ? "" : "s"}.
          </p>

          {ok.skipped.length > 0 && (
            <details className="bp-import__skipped">
              <summary>
                {ok.skipped.length} line{ok.skipped.length === 1 ? "" : "s"} not
                understood
              </summary>
              <ul>
                {ok.skipped.map((s) => (
                  <li key={s.line}>
                    <code>
                      {s.line}: {s.text.trim()}
                    </code>
                  </li>
                ))}
              </ul>
            </details>
          )}

          <button
            type="button"
            className="bp-button"
            onClick={apply}
            disabled={ok.model.elements.length === 0}
          >
            Add {ok.model.elements.length} element
            {ok.model.elements.length === 1 ? "" : "s"} to this model
          </button>
          <p className="bp-muted bp-editor__hint">
            Adds to what is here rather than replacing it, and nothing is stored
            until you press Save model.
          </p>
        </>
      )}
    </details>
  );
}
