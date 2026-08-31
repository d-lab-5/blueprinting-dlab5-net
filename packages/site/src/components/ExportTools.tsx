import * as React from "react";
import { listDocuments, loadDocument } from "../lib/data";
import type { BpDocument } from "../lib/data";
import { renderMarkdown } from "../lib/markdown";

/**
 * Getting things out: a document as PDF, and what an export will and will not
 * carry.
 *
 * PDF is the browser's own print-to-PDF rather than a JS library. The
 * typography is better, it costs no dependency, and what you get is exactly
 * what is on screen. The trade is that the viewer drives the save dialog, so
 * this cannot be batched — which for reviewing a report is the right trade.
 *
 * The panel also states the export boundary, because a rule nobody can see is
 * a rule people will breach by accident: confidential documents are excluded
 * from a transfer bundle and come out only as a local download.
 */
export function ExportTools({ slug, name }: { slug: string; name: string }) {
  const [documents, setDocuments] = React.useState<BpDocument[] | null>(null);
  const [chosen, setChosen] = React.useState<string>("");
  const [markdown, setMarkdown] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    listDocuments(slug)
      .then(setDocuments)
      .catch(() => setDocuments([]));
  }, [slug]);

  React.useEffect(() => {
    if (!chosen) {
      setMarkdown(null);
      return;
    }
    let live = true;
    loadDocument(slug, chosen, "source")
      .then(({ markdown }) => live && setMarkdown(markdown))
      .catch((err) => live && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      live = false;
    };
  }, [slug, chosen]);

  const doc = documents?.find((d) => d.docId === chosen);
  const confidential = doc?.classification === "confidential";

  return (
    <section className="bp-export">
      <h2>Export</h2>

      <div className="bp-export__boundary">
        <h3>What leaves, and how</h3>
        <dl>
          <dt>The model</dt>
          <dd>
            Travels in a transfer bundle as Turtle and ArchiMate Open Exchange
            XML, which opens in Archi.
          </dd>
          <dt>Shared documents</dt>
          <dd>Travel with the model, and are safe in a public repository.</dd>
          <dt>Collaboration documents</dt>
          <dd>
            Travel with the product between environments, but never into a
            public repository. A bundle carries them only when it is asked to.
          </dd>
          <dt>Confidential documents</dt>
          <dd>
            <strong>Never travel.</strong> They are excluded from every bundle,
            with no flag to override it, and come out only as a download from
            the Documents screen by someone who asks for that document by name.
          </dd>
        </dl>
      </div>

      <h3>Print a document</h3>
      <p className="bp-muted">
        The document is rendered — headings, tables and lists — not printed as
        raw markdown. Opens your browser's print dialog, where "Save as PDF" is
        one of the destinations. Annotations are stripped, not merely hidden.
      </p>

      <label className="bp-field">
        <span>Document</span>
        <select value={chosen} onChange={(e) => setChosen(e.target.value)}>
          <option value="">Choose a document…</option>
          {documents?.map((d) => (
            <option key={d.docId} value={d.docId}>
              {d.title}
              {d.classification === "shared" ? "" : ` (${d.classification})`}
            </option>
          ))}
        </select>
      </label>

      {error && (
        <p className="bp-error" role="alert">
          {error}
        </p>
      )}

      {markdown !== null && doc && (
        <>
          <div className="bp-export__actions">
            <button
              className="bp-button"
              type="button"
              onClick={() => window.print()}
            >
              Print / Save as PDF
            </button>
            {confidential && (
              <span className="bp-muted">
                This document is confidential. The PDF is yours to keep, not to
                circulate.
              </span>
            )}
          </div>

          {/* The printable region. Annotation comments are stripped rather
              than hidden: a comment in the DOM would still be in the file
              somebody saves, and the point of printing is to produce something
              shareable with a person, not a machine. */}
          <article className="bp-print" aria-label={`${doc.title}, for printing`}>
            <header className="bp-print__header">
              <h1>{doc.title}</h1>
              <p className="bp-muted">
                {name}
                {confidential ? " · Confidential" : ""}
              </p>
            </header>
            {/* Rendered, so the PDF is a document rather than a dump of
                source. Annotations are stripped rather than hidden: a comment
                in the DOM is still in the file somebody saves. */}
            <div
              className="bp-print__body bp-prose"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }}
            />
          </article>
        </>
      )}
    </section>
  );
}
