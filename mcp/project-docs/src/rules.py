"""What a document path and a document may look like.

Paths are relative to the store root, `<space>/<path>`, and the space is a
blueprinting product id. Every check here runs before S3 is asked anything, so
a bad path never becomes a request.
"""

import re

ALLOWED_EXTENSIONS = (".md", ".ttl", ".txt", ".json", ".csv", ".yaml", ".sparql", ".py")
MAX_BYTES = 1024 * 1024
MAX_PATH = 512

_CHARS = re.compile(r"[A-Za-z0-9._/-]+")


class RuleError(ValueError):
    """A path or document the store refuses. The message is shown to the caller."""


def _check_segments(value: str, what: str) -> list[str]:
    if not value:
        raise RuleError(f"{what} is empty.")
    if len(value) > MAX_PATH:
        raise RuleError(f"{what} is longer than {MAX_PATH} characters.")
    if not _CHARS.fullmatch(value):
        raise RuleError(f"{what} may only contain A-Z a-z 0-9 . _ / -")
    if value.startswith("/"):
        raise RuleError(f"{what} must be relative: no leading '/'.")
    segments = value.split("/")
    if any(s in (".", "..") for s in segments):
        raise RuleError(f"{what} may not contain '.' or '..' segments.")
    return segments


def check_path(path: str) -> str:
    """A document path: `<space>/<name>.<ext>`, with optional folders between."""
    segments = _check_segments(path, "Path")
    if len(segments) < 2:
        raise RuleError("Path must start with a space (product id), e.g. p-7f3k2b9c4d/notes.md")
    if any(s == "" for s in segments):
        raise RuleError("Path may not contain empty segments ('//') or end with '/'.")
    if not path.lower().endswith(ALLOWED_EXTENSIONS):
        raise RuleError("Only text files are stored: " + " ".join(ALLOWED_EXTENSIONS))
    return path


def check_prefix(prefix: str | None) -> str:
    """A listing or search prefix. Empty means everything."""
    if not prefix:
        return ""
    segments = _check_segments(prefix, "Prefix")
    if any(s == "" for s in segments[:-1]):
        raise RuleError("Prefix may not contain empty segments ('//').")
    return prefix


def check_content(content: str) -> bytes:
    body = content.encode("utf-8")
    if len(body) > MAX_BYTES:
        raise RuleError(f"Document is {len(body)} bytes; the limit is {MAX_BYTES} (1 MB).")
    return body


def space_of(path: str) -> str:
    return path.split("/", 1)[0]
