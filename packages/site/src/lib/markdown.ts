import { marked } from "marked";

/**
 * A stored document, rendered for reading and for printing.
 *
 * marked rather than showdown: no dependencies at all (showdown carries
 * commander), current rather than untouched since 2022, and GFM tables by
 * default — which matters here, because the documents this exists for are full
 * of them and showdown renders a table as a wall of pipes unless you remember
 * to pass `tables: true`.
 *
 * **The order of these three steps is the whole safety argument.**
 *
 *   1. strip the annotations, which are HTML comments and so would otherwise
 *      survive escaping as visible text;
 *   2. escape everything that is left, so nothing in the document can produce
 *      markup;
 *   3. convert, so that only markdown syntax does.
 *
 * Done this way there is no injection path and no sanitizer dependency. Done
 * in any other order there is one or the other. These documents are uploaded
 * by people and pasted in from elsewhere, and they render for everyone in a
 * product's group, so `<img src=x onerror=…>` is not a hypothetical.
 *
 * The cost is that angle-bracket autolinks — `<https://example.com>` — render
 * as text rather than links. Bare URLs and `[text](url)` both still work, and
 * a document that writes `https://<store>/api/mcp` in a table gets what it
 * meant, which is the more common case by far.
 */

/** `<!-- am element type=… -->` — metadata, never content. */
const ANNOTATION = /^[ \t]*<!--\s*am\b[^>]*-->[ \t]*\r?\n?/gim;

marked.use({ gfm: true, breaks: false });

export function stripAnnotations(markdown: string): string {
  return markdown.replace(ANNOTATION, "");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Rendered HTML for `dangerouslySetInnerHTML`, safe by construction. */
export function renderMarkdown(markdown: string): string {
  const prose = escapeHtml(stripAnnotations(markdown));
  return marked.parse(prose, { async: false }) as string;
}
