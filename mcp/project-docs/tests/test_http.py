"""The HTTP surface: the key check, and MCP over stateless streamable HTTP.

Runs the real ASGI app under uvicorn on a free port, the same way run.sh does
behind the Lambda Web Adapter, so this is the stack the Function URL serves.
"""

import asyncio
import socket
import threading
import time

import httpx2
import pytest
import uvicorn
from mcp.client.streamable_http import streamable_http_client
from mcp.client.session import ClientSession

from app import create_app
from conftest import SPACE

KEY = "k" * 40


@pytest.fixture
def url(store, products):
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    app = create_app(store, products, lambda: KEY, on_lambda=False)
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    while not server.started:
        time.sleep(0.02)
    yield f"http://127.0.0.1:{port}"
    server.should_exit = True
    thread.join()


@pytest.mark.parametrize("header", [None, "Bearer wrong", f"bearer {KEY}", KEY, f"Bearer {KEY}x"])
def test_without_the_right_key_401(url, header):
    headers = {"Authorization": header} if header else {}
    r = httpx2.post(f"{url}/mcp", headers=headers, json={})
    assert r.status_code == 401
    assert r.text == "unauthorized"


def test_health_needs_no_key_and_says_nothing(url):
    r = httpx2.get(f"{url}/healthz")
    assert r.status_code == 200 and r.text == "ok"


def test_mcp_over_http(url):
    async def go():
        headers = {"Authorization": f"Bearer {KEY}"}
        async with httpx2.AsyncClient(headers=headers) as http:
            async with streamable_http_client(f"{url}/mcp", http_client=http) as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    tools = await session.list_tools()
                    written = await session.call_tool("write_doc", {"path": f"{SPACE}/x.md", "content": "hi"})
                    return tools, written

    tools, written = asyncio.run(go())
    assert len(tools.tools) == 5
    assert not written.is_error
