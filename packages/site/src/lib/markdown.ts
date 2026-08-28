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
 * `>` is deliberately NOT escaped. It cannot open a tag once every `<` is
 * gone, and escaping it breaks every blockquote in the document — which is how
 * this was found: the assertion for blockquotes failed.
 *
 * Escaping is not sufficient by itself. marked does not sanitize URLs, so
 * `[click](javascript:alert(1))` produces a real anchor with a real
 * javascript: href. Tested, not assumed. Link and image hrefs therefore go
 * through a protocol allow-list.
 *
 * The cost is that angle-bracket autolinks — `<https://example.com>` — render
 * as text rather than links. Bare URLs and `[text](url)` both still work, and
 * a document that writes `https://<store>/api/mcp` in a table gets what it
 * meant, which is the more common case by far.
 */

/** `<!-- am element type=… -->` — metadata, never content. */
const ANNOTATION = /^[ \t]*<!--\s*am\b[^>]*-->[ \t]*\r?\n?/gim;

/**
 * Protocols a link may use. Anything else becomes plain text.
 *
 * A relative or fragment href is fine — it cannot execute.
 */
const SAFE_PROTOCOL = /^(https?:|mailto:|tel:|#|\/|\.)/i;

function safeHref(href: string | null | undefined): string | null {
  if (!href) return null;
  // Entities and control characters are how a blocked protocol gets past a
  // naive check: browsers resolve both `java\tscript:` and `&#106;avascript:`.
  // Normalise before deciding, and return the ORIGINAL if it passes.
  const normalised = href
    .replace(/&#(\d+);?/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/[\s\u0000-\u001f]/g, "")
    .trim();
  return SAFE_PROTOCOL.test(normalised) ? href : null;
}

interface LinkToken {
  href?: string;
  title?: string | null;
  text?: string;
}

marked.use({
  gfm: true,
  breaks: false,
  renderer: {
    link(token: LinkToken) {
      const href = safeHref(token.href);
      const text = token.text ?? "";
      if (!href) return text;
      return `<a href="${href}" rel="noopener noreferrer">${text}</a>`;
    },
    image(token: LinkToken) {
      const href = safeHref(token.href);
      const text = token.text ?? "";
      if (!href) return text;
      return `<img src="${href}" alt="${text}">`;
    },
  },
});

export function stripAnnotations(markdown: string): string {
  return markdown.replace(ANNOTATION, "");
}

function escapeHtml(text: string): string {
  // `>` is left alone on purpose: without a `<` it cannot open anything, and
  // escaping it would break every blockquote.
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

/** Rendered HTML for `dangerouslySetInnerHTML`, safe by construction. */
export function renderMarkdown(markdown: string): string {
  const prose = escapeHtml(stripAnnotations(markdown));
  return marked.parse(prose, { async: false }) as string;
}
