"""The five MCP tools. Thin: they validate, call the store, and log.

The descriptions are written for the model that calls them, so they say the
path rules and the read-before-write rule outright rather than leaving them to
be discovered from errors.
"""

import json
import logging
import time
from functools import wraps

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

from products import Products
from rules import ALLOWED_EXTENSIONS, RuleError, check_content, check_path, check_prefix, space_of
from store import Conflict, NotFound, Store

log = logging.getLogger("project-docs")

INSTRUCTIONS = f"""\
A shared document store for D-LAB-5 projects. Claude Code and claude.ai read
and write the same files here, so there is one copy and nothing to sync.

Paths are `<space>/<path>`, where the space is a blueprinting product id such
as `p-7f3k2b9c4d`. Call list_docs without a prefix to see the spaces and their
product names. Paths are relative, use only A-Z a-z 0-9 . _ / -, never `..`,
at most 512 characters. Only text files: {" ".join(ALLOWED_EXTENSIONS)}, up to 1 MB.

Always read a document before changing it, and pass the etag you read to
write_doc. Nothing is ever deleted; every write is kept as a version.
"""


def _logged(fn):
    """One log line per call: tool, path, result, duration. Never content."""

    @wraps(fn)
    def wrapper(*args, **kwargs):
        start = time.monotonic()
        result = "ok"
        try:
            return fn(*args, **kwargs)
        except RuleError:
            result = "rejected"
            raise
        except Conflict:
            result = "conflict"
            raise
        except NotFound:
            result = "not_found"
            raise
        except Exception:
            result = "error"
            raise
        finally:
            log.info(
                json.dumps(
                    {
                        "tool": fn.__name__,
                        "path": kwargs.get("path") or kwargs.get("prefix") or "",
                        "result": result,
                        "ms": round((time.monotonic() - start) * 1000),
                    }
                )
            )

    return wrapper


def _as_tool_error(fn):
    """Turns the store's exceptions into messages a model can act on."""

    @wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except RuleError as e:
            raise ToolError(str(e)) from None
        except NotFound as e:
            raise ToolError(f"No document at {e}. Use list_docs to see what exists.") from None
        except Conflict as e:
            if e.current_etag is None:
                raise ToolError(
                    f"Conflict: {e.path} does not exist, so there is nothing to update. "
                    "To create it, call write_doc again without expected_etag."
                ) from None
            if e.expected_etag is None:
                raise ToolError(
                    f"Conflict: {e.path} already exists (current etag {e.current_etag}). "
                    "Read it with read_doc, merge your change into what is there, then "
                    f'write again with expected_etag="{e.current_etag}".'
                ) from None
            raise ToolError(
                f"Conflict: {e.path} changed since you read it (you had {e.expected_etag}, "
                f"current etag is {e.current_etag}). Read it again with read_doc, merge your "
                f'change into the current content, then write with expected_etag="{e.current_etag}". '
                "Do not overwrite without merging."
            ) from None

    return wrapper


def register(mcp: MCPServer, store: Store, products: Products) -> None:
    @mcp.tool()
    @_as_tool_error
    @_logged
    def list_docs(prefix: str | None = None) -> dict:
        """List documents, sorted by path.

        Without a prefix, also returns `spaces`: every blueprinting product as
        {space, name}. The space id is the first segment of every path; use
        the name to find the right one. With a prefix (e.g. `p-7f3k2b9c4d/` or
        `p-7f3k2b9c4d/ontology/`), lists only below it. Returns path, size,
        etag and last_modified per document, at most 1000.
        """
        out = store.listing(check_prefix(prefix))
        if not prefix:
            out["spaces"] = [{"space": s, "name": n} for s, n in sorted(products.all().items(), key=lambda p: p[1])]
        return out

    @mcp.tool()
    @_as_tool_error
    @_logged
    def read_doc(path: str, version_id: str | None = None) -> dict:
        """Read one document. Returns content, etag, version_id and last_modified.

        Reads the latest version unless version_id is given (see history).
        Keep the etag: write_doc needs it to change this document.
        """
        return store.read(check_path(path), version_id)

    @mcp.tool()
    @_as_tool_error
    @_logged
    def write_doc(path: str, content: str, expected_etag: str | None = None) -> dict:
        """Create or change a document. Returns the new etag and version_id.

        To CHANGE a document: read it first with read_doc and pass its etag as
        expected_etag. If someone changed it in between, the write is refused
        with the current etag: read again, merge, and retry. Never retry
        without merging, or their change is lost.

        To CREATE a document: leave expected_etag out. This fails if the path
        already exists, so nothing is overwritten by accident.

        The path's first segment must be an existing product id (see
        list_docs). Text files only, up to 1 MB. Every write keeps the old
        version; nothing is deleted.
        """
        check_path(path)
        body = check_content(content)
        space = space_of(path)
        if products.name(space) is None:
            raise RuleError(
                f"'{space}' is not a blueprinting product. Call list_docs without a prefix to "
                "see the spaces. A product created a moment ago appears within a minute."
            )
        return store.write(path, body, expected_etag)

    @mcp.tool()
    @_as_tool_error
    @_logged
    def search_docs(query: str, prefix: str | None = None) -> dict:
        """Find lines containing `query` (case-insensitive, plain substring).

        Searches every document below prefix, or all of them. Returns path,
        line number and the matching line, at most 50 hits.
        """
        if not query.strip():
            raise RuleError("Query is empty.")
        return store.search(query, check_prefix(prefix))

    @mcp.tool()
    @_as_tool_error
    @_logged
    def history(path: str) -> dict:
        """List every stored version of a document, newest first.

        Returns version_id, last_modified, size and etag per version. Pass a
        version_id to read_doc to read an older version.
        """
        versions = store.history(check_path(path))
        if not versions:
            raise NotFound(path)
        return {"path": path, "versions": versions}
