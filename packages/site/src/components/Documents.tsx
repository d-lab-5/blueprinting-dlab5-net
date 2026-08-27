import * as React from "react";
import { slugifyId } from "@dlab5/blueprint-core";
import { listDocuments, loadDocument, saveDocument } from "../lib/data";
import type { BpDocument, Classification } from "../lib/data";

/**
 * A product's private document space.
 *
 * Reports, plans and decision records are evidence about an architecture
 * rather than part of one, so they are held beside the model instead of in it.
 * The reason they are held here at all is that some of them cannot live in a
 * repository: commercial terms, supplier relationships, pricing. Those need
 * somewhere that is neither a public repo nor somebody's laptop.
 *
 * Which makes `classification` the field that matters:
 *
 *                    in a bundle   safe in a public repo
 *   Confidential         no              no
 *   Collaboration       yes              no
 *   Shared              yes             yes
 *
 * The middle tier is the one that is easy to omit and expensive to lack.
 * Sprint notes and working documents have to travel with the product between
 * environments and must not reach a public GitHub page — two properties no
 * two-valued field can express at once.
 *
 * **Confidential is the default**, and the direction is the whole point.
 * Sharing is a decision someone makes; not-sharing is what happens when
 * nobody does.
 */
const LABELS: Record<string, string> = {
  confidential: "Confidential",
  collaboration: "Collaboration",
  shared: "Shared",
};

export function Documents({ slug }: { slug: string }) {
  const [documents, setDocuments] = React.useState<BpDocument[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [open, setOpen] = React.useState<{ doc: BpDocument; markdown: string } | null>(
    null
  );

  const refresh = React.useCallback(() => {
    listDocuments(slug)
      .then(setDocuments)
      .catch((err) => {
        setDocuments([]);
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [slug]);

  React.useEffect(refresh, [refresh]);

  async function upload(file: File, classification: Classification) {
    setBusy(true);
    setError(null);
    try {
      const markdown = await file.text();
      const title = file.name.replace(/\.(md|markdown|txt)$/i, "");
      await saveDocument({
        projectSlug: slug,
        docId: slugifyId(title),
        markdown,
        title,
        classification,
        kind: "source",
      });
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function view(doc: BpDocument) {
    setError(null);
    try {
      const { markdown } = await loadDocument(slug, doc.docId, "source");
      if (markdown === null) throw new Error("That document could not be read.");
      setOpen({ doc, markdown });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * A local download, which is the only way confidential material leaves.
   *
   * Deliberately a browser download rather than anything that puts the file
   * somewhere: the point of the classification is that this content does not
   * get copied to another system by accident.
   */
  function download(doc: BpDocument, markdown: string) {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${doc.docId}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="bp-documents">
      <h2>Documents</h2>
      <p className="bp-muted">
        Held for the record, beside the model. Classification decides where a
        document may go: confidential stays here, collaboration travels with
        the product, shared is safe in a public repository.
      </p>

      <UploadForm busy={busy} onUpload={upload} />

      {error && (
        <p className="bp-error" role="alert">
          {error}
        </p>
      )}

      {documents === null && <p className="bp-muted">Loading…</p>}
      {documents?.length === 0 && (
        <p className="bp-muted">No documents yet.</p>
      )}

      {documents && documents.length > 0 && (
        <table className="bp-documents__index">
          <thead>
            <tr>
              <th>Title</th>
              <th>Classification</th>
              <th>Size</th>
              <th>Added</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => (
              <tr key={doc.docId}>
                <td>
                  <button
                    type="button"
                    className="bp-linkbutton"
                    onClick={() => void view(doc)}
                  >
                    {doc.title}
                  </button>
                  <div className="bp-muted bp-documents__id">
                    <code>{doc.docId}</code>
                  </div>
                </td>
                <td>
                  <span className={`bp-tag bp-tag--${doc.classification}`}>
                    {LABELS[doc.classification] ?? "Confidential"}
                  </span>
                </td>
                <td className="bp-muted">
                  {doc.bytes ? `${Math.ceil(doc.bytes / 1024)} kB` : "—"}
                </td>
                <td className="bp-muted">
                  {doc.uploadedAt ? doc.uploadedAt.slice(0, 10) : "—"}
                </td>
                <td>
                  <button
                    type="button"
                    className="bp-linkbutton"
                    onClick={() =>
                      void loadDocument(slug, doc.docId, "source").then(({ markdown }) => {
                        if (markdown !== null) download(doc, markdown);
                      })
                    }
                  >
                    Download
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {open && (
        <div className="bp-documents__reader">
          <h3>{open.doc.title}</h3>
          <pre className="bp-documents__text">{open.markdown}</pre>
          <button
            type="button"
            className="bp-linkbutton"
            onClick={() => setOpen(null)}
          >
            Close
          </button>
        </div>
      )}
    </section>
  );
}

function UploadForm({
  busy,
  onUpload,
}: {
  busy: boolean;
  onUpload: (file: File, classification: Classification) => void;
}) {
  const [classification, setClassification] =
    React.useState<Classification>("confidential");
  const input = React.useRef<HTMLInputElement>(null);

  return (
    <div className="bp-documents__upload">
      <label className="bp-field">
        <span>Classification</span>
        <select
          value={classification}
          onChange={(e) => setClassification(e.target.value as Classification)}
        >
          <option value="confidential">
            Confidential — never leaves this system
          </option>
          <option value="collaboration">
            Collaboration — travels with the product, never to a public repo
          </option>
          <option value="shared">
            Shared — safe anywhere, including a public repo
          </option>
        </select>
      </label>

      <label className="bp-field">
        <span>Markdown file</span>
        <input
          ref={input}
          type="file"
          accept=".md,.markdown,.txt,text/markdown,text/plain"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUpload(file, classification);
            if (input.current) input.current.value = "";
          }}
        />
      </label>

      <p className="bp-muted bp-editor__hint">
        The file is stored exactly as it arrives and is never rewritten — that
        is what makes it a record. Annotation happens on a working copy.
        Documents that look like they carry an access token are refused rather
        than warned about.
      </p>
    </div>
  );
}
