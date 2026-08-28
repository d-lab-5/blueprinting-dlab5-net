import * as React from "react";
import {
  applyImport,
  everyChange,
  fromAnnotatedMarkdown,
  planImport,
} from "@dlab5/blueprint-core";
import type { AbModel, ImportPlan } from "@dlab5/blueprint-core";
import { ELEMENT_TYPE_IDS } from "@dlab5/archimate-metamodel";
import { saveDocument } from "../lib/data";

/**
 * Reads an annotated markdown document into the model.
 *
 * Information about a product does not arrive in ArchiMate — it arrives as a
 * report. Annotations are HTML comments, so the document still reads and
 * prints as itself:
 *
 *     <!-- am element type=Stakeholder id=cfo -->
 *     ## Chief Financial Officer
 *
 * Unlike the Gantt import, this one can UPDATE. That is the whole point of a
 * second reading of a revised document, and it is also the dangerous part, so
 * nothing is applied without being shown first — and each change is opt-in by
 * id, so "take everything except that paragraph someone fixed in the app" is a
 * thing you can express.
 *
 * Nothing reaches S3 until Save model, exactly as with the Gantt.
 */
const EXAMPLE = `<!-- am element type=Stakeholder id=cfo -->
## Chief Financial Officer

Wants cost per transaction below EUR 0.02 by Q3.

<!-- am element type=Driver id=cost-per-txn -->
## Cost per transaction

<!-- am rel type=influence from=cfo to=cost-per-txn -->`;

export function MarkdownImport({
  model,
  onChange,
  slug,
  documentId,
  initialSource,
}: {
  model: AbModel;
  onChange: (next: AbModel) => void;
  slug: string;
  /** Stamped on every imported element, and what a re-import matches on. */
  documentId?: string;
  initialSource?: string;
}) {
  const [source, setSource] = React.useState(initialSource ?? "");
  const [accepted, setAccepted] = React.useState<Set<string> | null>(null);
  const [applied, setApplied] = React.useState<number | null>(null);
  const [saveNote, setSaveNote] = React.useState<string | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (initialSource !== undefined) setSource(initialSource);
  }, [initialSource]);

  const parsed = React.useMemo(() => {
    if (!source.trim()) return null;
    try {
      return fromAnnotatedMarkdown(source, model.projectSlug, { documentId });
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) } as const;
    }
  }, [source, model.projectSlug, documentId]);

  const ok = parsed && !("error" in parsed) ? parsed : null;

  const plan: ImportPlan | null = React.useMemo(
    () => (ok ? planImport(model, ok.model, documentId) : null),
    [ok, model, documentId]
  );

  // Everything is selected by default; the panel is for deselecting the one
  // change you do not want, which is the common case.
  const selection = React.useMemo(
    () => accepted ?? (plan ? everyChange(plan) : new Set<string>()),
    [accepted, plan]
  );

  const toggle = (id: string) => {
    const next = new Set(selection);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setAccepted(next);
  };

  const creates = plan?.elements.filter((c) => c.kind === "create") ?? [];
  const updates = plan?.elements.filter((c) => c.kind === "update") ?? [];
  const unchanged = plan?.elements.filter((c) => c.kind === "unchanged").length ?? 0;
  const newRelationships = plan?.relationships.filter((c) => c.kind === "create") ?? [];

  const apply = () => {
    if (!plan) return;
    onChange(applyImport(model, plan, selection));
    setApplied(selection.size);
    setAccepted(null);
  };

  return (
    <section className="bp-import bp-import--markdown">
      <h2>Import a document</h2>

      <details className="bp-import__help">
        <summary>How annotation works</summary>
        <p>
          A markdown document is not an architecture — it is prose that mentions
          one. Annotations say which parts are which, and they are HTML
          comments, so the document still reads and prints exactly as it did.
        </p>
        <p>Put a comment on the line <em>above</em> a heading:</p>
        <pre>{EXAMPLE}</pre>
        <ul>
          <li>
            <strong>The heading becomes the name</strong>, and the prose beneath
            it, up to the next heading, becomes the element's documentation.
          </li>
          <li>
            <strong><code>id=</code> is required.</strong> It is what makes a
            second import of a revised document update the same element instead
            of creating a twin. Choose it once and keep it.
          </li>
          <li>
            <code>type=</code> must be a real ArchiMate type — {ELEMENT_TYPE_IDS.length}{" "}
            of them. A wrong one is reported, never guessed at.
          </li>
          <li>
            <code>rel</code> needs no id: it is identified by its two ends. A
            relationship ArchiMate forbids is refused and tells you why.
          </li>
          <li>
            <code>&lt;!-- am ignore --&gt;</code> marks a section as
            deliberately not modelled, which is different from simply not
            annotating it.
          </li>
          <li>
            Anything unannotated is <strong>ignored</strong>. Most of a document
            usually should be.
          </li>
        </ul>
      </details>

      <div className="bp-import__load">
        <label className="bp-field">
          <span>Open a markdown file</span>
          <input
            ref={fileInput}
            type="file"
            accept=".md,.markdown,.txt,text/markdown,text/plain"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setSource(await file.text());
              setAccepted(null);
              setApplied(null);
              if (fileInput.current) fileInput.current.value = "";
            }}
          />
        </label>
        <p className="bp-muted bp-editor__hint">
          Opening a file here does not store it. To keep it as a record, upload
          it on the Documents screen first and annotate it from there — then the
          elements it creates carry the document they came from.
        </p>
      </div>

      <label className="bp-field">
        <span>
          {documentId ? `Annotating "${documentId}"` : "Annotated markdown"}
        </span>
        <textarea
          className="bp-import__source"
          rows={14}
          value={source}
          onChange={(e) => {
            setSource(e.target.value);
            setAccepted(null);
            setApplied(null);
          }}
          placeholder={
            "<!-- am element type=Stakeholder id=cfo -->\n" +
            "## Chief Financial Officer\n" +
            "Wants cost per transaction below EUR 0.02 by Q3.\n"
          }
        />
      </label>

      {parsed && "error" in parsed && (
        <p className="bp-error" role="alert">
          {parsed.error}
        </p>
      )}

      {plan && ok && (
        <div className="bp-import__plan">
          <p className="bp-import__summary">
            {creates.length} to create · {updates.length} to update ·{" "}
            {unchanged} unchanged · {newRelationships.length} new relationship
            {newRelationships.length === 1 ? "" : "s"}
            {ok.ignored > 0 && ` · ${ok.ignored} ignored`}
          </p>

          {plan.refused.length > 0 && (
            <div className="bp-import__refused" role="alert">
              <h3>Refused</h3>
              <ul>
                {plan.refused.map((r) => (
                  <li key={r.incoming.id}>{r.reason}</li>
                ))}
              </ul>
            </div>
          )}

          {(creates.length > 0 || updates.length > 0) && (
            <ul className="bp-import__changes">
              {creates.map((c) => (
                <li key={c.incoming.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selection.has(c.incoming.id)}
                      onChange={() => toggle(c.incoming.id)}
                    />
                    <span className="bp-import__kind bp-import__kind--create">new</span>
                    <strong>{c.incoming.name}</strong>{" "}
                    <span className="bp-muted">{c.incoming.type}</span>
                  </label>
                </li>
              ))}
              {updates.map((c) => (
                <li key={c.incoming.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selection.has(c.incoming.id)}
                      onChange={() => toggle(c.incoming.id)}
                    />
                    <span className="bp-import__kind bp-import__kind--update">
                      changed
                    </span>
                    <strong>{c.incoming.name}</strong>{" "}
                    <span className="bp-muted">
                      {c.differing.join(", ")} differ
                      {c.differing.length === 1 ? "s" : ""}
                    </span>
                  </label>
                  {c.existing && c.differing.includes("name") && (
                    <p className="bp-import__was">
                      was <q>{c.existing.name}</q>
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}

          {newRelationships.length > 0 && (
            <ul className="bp-import__changes">
              {newRelationships.map((c) => (
                <li key={c.incoming.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selection.has(c.incoming.id)}
                      onChange={() => toggle(c.incoming.id)}
                    />
                    <span className="bp-import__kind bp-import__kind--create">new</span>
                    <span className="bp-muted">
                      {c.incoming.source} → {c.incoming.type} → {c.incoming.target}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          {plan.orphaned.length > 0 && (
            <div className="bp-import__orphans">
              <h3>No longer in this document</h3>
              <p className="bp-muted">
                Left in the model. A section cut for length is not a decision to
                delete an element, so this import will not remove them.
              </p>
              <ul>
                {plan.orphaned.map((e) => (
                  <li key={e.id}>
                    {e.name} <span className="bp-muted">{e.type}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {ok.skipped.length > 0 && (
            <div className="bp-import__skipped">
              <h3>Not understood</h3>
              <ul>
                {ok.skipped.map((sk) => (
                  <li key={`${sk.line}-${sk.reason}`}>
                    <span className="bp-muted">line {sk.line}</span> {sk.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="bp-import__actions">
            <button
              className="bp-button"
              type="button"
              onClick={apply}
              disabled={selection.size === 0}
            >
              {selection.size === 0
                ? "Nothing selected"
                : `Add ${selection.size} to the model`}
            </button>
            {documentId && (
              <button
                type="button"
                className="bp-linkbutton"
                onClick={async () => {
                  setSaveNote(null);
                  try {
                    // The working copy, never the source. The source is the
                    // record of what arrived and is not rewritable.
                    await saveDocument({
                      projectSlug: slug,
                      docId: documentId,
                      markdown: source,
                      kind: "annotated",
                    });
                    setSaveNote("Annotations saved to the working copy.");
                  } catch (err) {
                    setSaveNote(
                      err instanceof Error ? err.message : String(err)
                    );
                  }
                }}
              >
                Save annotations
              </button>
            )}
            {applied !== null && (
              <span className="bp-muted" role="status">
                {applied} applied — not saved yet.
              </span>
            )}
            {saveNote && (
              <span className="bp-muted" role="status">
                {saveNote}
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
