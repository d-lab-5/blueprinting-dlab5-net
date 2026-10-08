import * as React from "react";
import { renderMarkdown } from "../lib/markdown";
import { listSharedFiles, readSharedFile } from "../lib/data";
import type { SharedFileContent, SharedFileList } from "../lib/data";

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
 */
export function SharedFiles({ slug }: { slug: string }) {
  const [list, setList] = React.useState<SharedFileList | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState<SharedFileContent | null>(null);

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
              <tr key={file.path}>
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
                </td>
              </tr>
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
