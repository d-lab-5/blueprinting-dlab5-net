"""The five tools, driven through an in-process MCP client against moto."""

import asyncio
import json

import pytest
from mcp import Client

from app import build_server
from conftest import SPACE


def call(server, name, args):
    async def go():
        async with Client(server) as client:
            return await client.call_tool(name, args)

    result = asyncio.run(go())
    text = result.content[0].text if result.content else ""
    if result.is_error:
        return None, text
    return json.loads(text), None


@pytest.fixture
def server(store, products):
    return build_server(store, products)


def test_exactly_five_tools(server):
    async def go():
        async with Client(server) as client:
            return await client.list_tools()

    names = sorted(t.name for t in asyncio.run(go()).tools)
    assert names == ["history", "list_docs", "read_doc", "search_docs", "write_doc"]


def test_create_edit_conflict_history(server):
    path = f"{SPACE}/notes.md"

    created, err = call(server, "write_doc", {"path": path, "content": "first\n"})
    assert err is None
    v1 = created["etag"]

    # Create-only: a second create is refused and names the current etag.
    _, err = call(server, "write_doc", {"path": path, "content": "other\n"})
    assert "already exists" in err and v1 in err

    edited, err = call(server, "write_doc", {"path": path, "content": "second\n", "expected_etag": v1})
    assert err is None
    v2 = edited["etag"]
    assert v2 != v1

    # Stale etag: refused, with the current etag so the caller can re-read and merge.
    _, err = call(server, "write_doc", {"path": path, "content": "lost\n", "expected_etag": v1})
    assert "Conflict" in err and v2 in err

    doc, _ = call(server, "read_doc", {"path": path})
    assert doc["content"] == "second\n" and doc["etag"] == v2

    hist, _ = call(server, "history", {"path": path})
    assert [v["etag"] for v in hist["versions"]] == [v2, v1]

    old, _ = call(server, "read_doc", {"path": path, "version_id": hist["versions"][1]["version_id"]})
    assert old["content"] == "first\n"


def test_update_of_missing_file_says_create(server):
    _, err = call(server, "write_doc", {"path": f"{SPACE}/nope.md", "content": "x", "expected_etag": "abc"})
    assert "does not exist" in err


def test_write_to_unknown_space_is_refused(server):
    _, err = call(server, "write_doc", {"path": "p-zzzzzzzzzz/notes.md", "content": "x"})
    assert "not a blueprinting product" in err


def test_bad_path_is_refused(server):
    _, err = call(server, "write_doc", {"path": f"{SPACE}/../x.md", "content": "x"})
    assert "'..'" in err


def test_list_shows_spaces_by_name(server):
    call(server, "write_doc", {"path": f"{SPACE}/ontology/perma-core.ttl", "content": "@prefix : <x#> .\n"})
    listing, _ = call(server, "list_docs", {})
    assert listing["spaces"] == [{"space": SPACE, "name": "PermTek-5"}]
    assert [d["path"] for d in listing["docs"]] == [f"{SPACE}/ontology/perma-core.ttl"]

    below, _ = call(server, "list_docs", {"prefix": f"{SPACE}/ontology/"})
    assert "spaces" not in below and len(below["docs"]) == 1


def test_search(server):
    call(server, "write_doc", {"path": f"{SPACE}/a.md", "content": "Hello\nthe Food Forest\nend\n"})
    call(server, "write_doc", {"path": f"{SPACE}/b.ttl", "content": ":x :label \"food forest\" .\n"})
    found, _ = call(server, "search_docs", {"query": "FOOD forest"})
    assert {(h["path"], h["line"]) for h in found["hits"]} == {(f"{SPACE}/a.md", 2), (f"{SPACE}/b.ttl", 1)}


def test_read_missing(server):
    _, err = call(server, "read_doc", {"path": f"{SPACE}/missing.md"})
    assert "No document" in err
