import * as React from "react";
import { renderMarkdown } from "../lib/markdown";
import { listSharedFiles, readSharedFile } from "../lib/data";
import type { Classification, SharedFileContent, SharedFileList } from "../lib/data";
import { ClassificationSelect } from "./ClassificationSelect";

/** The types the product's document store holds (ADR-0011). */
const PUBLISHABLE = /\.(md|txt)$/i;

/** The first `# ` heading, or else the file name without its extension. */
function suggestTitle(path: string, content: string): string {
  const heading = content.match(/^#\s+(.+?)\s*$/m);
  if (heading) return heading[1];
  return (path.split("/").pop() ?? path).replace(/\.[^.]+$/, "");
}

interface Publishing {
  path: string;
  content: string;
  title: string;
  classification: Classification;
  busy: boolean;
}

/**
 * A product's shared working files, read-only.
 *
 * These live in the project-docs store (ADR-0013), where claude.ai and Claude
 * Code read and write the same copy through an MCP server. They are working
 * material rather than records, so they are shown here but edited there: the
 * page offers Open and Download and nothing that changes a file.
 *
 * Only Markdown is rendered, through the same boundary as the documents above
 * (lib/markdown.ts). Everything else — Turtle, JSON, SPARQL — is shown as
 * text, which React escapes.
 *
 * Publish copies a Markdown file into the product's documents above, as a
 * record with a classification a person chooses. It goes through the same
 * saveDocument path as an upload, so every rule that guards a document
 * applies. The copy is a snapshot: later edits to the shared file do not
 * follow it.
 */
export function SharedFiles({
  slug,
  onPublish,
}: {
  slug: string;
  onPublish: (markdown: string, title: string, classification: Classification) => Promise<void>;
}) {
  const [list, setList] = React.useState<SharedFileList | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState<SharedFileContent | null>(null);
  const [publishing, setPublishing] = React.useState<Publishing | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  React.useEffect(() => {
    setList(null);
    setOpen(null);
    listSharedFiles(slug)
      .then(setList)
      .catch((err) => {
        setList({ available: true, files: [], truncated: false });
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [slug]);

  async function view(path: string) {
    setError(null);
    try {
      setOpen(await readSharedFile(slug, path));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function startPublish(path: string) {
    setError(null);
    setNotice(null);
    try {
      const file = await readSharedFile(slug, path);
      setPublishing({
        path,
        content: file.content,
        title: suggestTitle(path, file.content),
        classification: "confidential",
        busy: false,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function publish() {
    if (!publishing || !publishing.title.trim()) return;
    const { content, title, classification } = publishing;
    setPublishing({ ...publishing, busy: true });
    setError(null);
    try {
      await onPublish(content, title.trim(), classification);
      setPublishing(null);
      setNotice(
        `Published as “${title.trim()}”. It is a snapshot: later edits to the shared file do not follow it.`
      );
    } catch (err) {
      setPublishing({ ...publishing, busy: false });
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function download(path: string) {
    setError(null);
    try {
      const file = await readSharedFile(slug, path);
      const blob = new Blob([file.content], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = path.split("/").pop() ?? path;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="bp-documents__shared">
      <h3>Shared files</h3>
      <p className="bp-muted">
        Working files shared with claude.ai and Claude Code. Edit them there.
      </p>

      {notice && <p className="bp-muted" role="status">{notice}</p>}
      {error && (
        <p className="bp-error" role="alert">
          {error}
        </p>
      )}

      {list === null && <p className="bp-muted">Loading…</p>}
      {list && !list.available && (
        <p className="bp-muted">Shared files are not set up in this environment.</p>
      )}
      {list?.available && list.files.length === 0 && !error && (
        <p className="bp-muted">No shared files yet.</p>
      )}

      {list?.available && list.files.length > 0 && (
        <table className="bp-documents__index">
          <thead>
            <tr>
              <th>File</th>
              <th>Size</th>
              <th>Changed</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.files.map((file) => (
              <React.Fragment key={file.path}>
                <tr>
                  <td>
                    <button
                      type="button"
                      className="bp-linkbutton"
                      onClick={() => void view(file.path)}
                    >
                      <code>{file.path}</code>
                    </button>
                  </td>
                  <td className="bp-muted">{`${Math.ceil(file.size / 1024)} kB`}</td>
                  <td className="bp-muted">{file.lastModified.slice(0, 10)}</td>
                  <td className="bp-documents__actions">
                    <button
                      type="button"
                      className="bp-linkbutton"
                      onClick={() => void download(file.path)}
                    >
                      Download
                    </button>
                    {PUBLISHABLE.test(file.path) && (
                      <button
                        type="button"
                        className="bp-linkbutton"
                        onClick={() => void startPublish(file.path)}
                      >
                        Publish
                      </button>
                    )}
                  </td>
                </tr>
                {publishing?.path === file.path && (
                  <tr>
                    <td colSpan={4}>
                      <div className="bp-documents__upload">
                        <label className="bp-field">
                          <span>Title</span>
                          <input
                            type="text"
                            value={publishing.title}
                            disabled={publishing.busy}
                            onChange={(e) => setPublishing({ ...publishing, title: e.target.value })}
                          />
                        </label>
                        <label className="bp-field">
                          <span>Classification</span>
                          <ClassificationSelect
                            value={publishing.classification}
                            onChange={(classification) =>
                              setPublishing({ ...publishing, classification })
                            }
                          />
                        </label>
                        <div className="bp-documents__actions">
                          <button
                            type="button"
                            disabled={publishing.busy || !publishing.title.trim()}
                            onClick={() => void publish()}
                          >
                            Publish as document
                          </button>
                          <button
                            type="button"
                            className="bp-linkbutton"
                            disabled={publishing.busy}
                            onClick={() => setPublishing(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}
      {list?.truncated && (
        <p className="bp-muted">Showing the first 1000 files.</p>
      )}

      {open && (
        <div className="bp-documents__reader">
          <h4>
            <code>{open.path}</code>
          </h4>
          {open.path.toLowerCase().endsWith(".md") ? (
            // Rendered, not raw. Safe by construction — see lib/markdown.ts.
            <div
              className="bp-prose"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(open.content) }}
            />
          ) : (
            <div className="bp-prose">
              <pre>{open.content}</pre>
            </div>
          )}
          <button
            type="button"
            className="bp-linkbutton"
            onClick={() => setOpen(null)}
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}
