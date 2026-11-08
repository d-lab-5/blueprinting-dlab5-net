#!/usr/bin/env python3
"""Drives the MCP server as a real client, over the wire.

Everything else that tests this server calls ``tool.run(args)`` directly —
``scripts/verify-mcp.mjs`` and ``packages/mcp/__tests__`` both do. That tests
the tool functions and skips the whole protocol: the stdio framing, the
registration, and whether each zod schema converts into a JSON Schema a client
can actually read. If ``registerTool`` were miswired or a schema failed to
serialise, every one of those tests would still pass and the server would be
broken for every real client.

So this is deliberately a SECOND implementation, in another language, using the
official Python SDK — the same discipline this repository already applies by
checking Turtle with rdflib, Open Exchange XML with Archi, and D2 with the real
compiler. A foreign client cannot share our misunderstandings.

Usage::

    .venv/bin/python scripts/verify-mcp-client.py            # metamodel only
    BP_USER=… BP_PASSWORD=… .venv/bin/python scripts/verify-mcp-client.py
    .venv/bin/python scripts/verify-mcp-client.py --url <hosted /mcp URL>

The ``--url`` form drives the hosted server (ADR-0014) over streamable HTTP. It
needs BP_KEY_WRITE, BP_KEY_READ and BP_SCRATCH_PRODUCT, which
``scripts/verify-mcp-hosted.mjs`` creates and removes around it; run that
rather than this directly.

With no credentials it verifies the degraded path, which is a real feature: an
agent asking what ArchiMate permits needs no account, and the server is built
to serve that.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

# The Python SDK exposes snake_case attributes for the camelCase wire format
# (server_info, is_error, input_schema). That difference is itself worth having
# a foreign client for: it is a place a hand-rolled reader would guess wrong.
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT = Path(__file__).resolve().parent.parent
SERVER = ROOT / "packages/mcp/dist/index.js"

METAMODEL_TOOLS = {
    "archimate_list_element_types",
    "archimate_describe_element_type",
    "archimate_check_relationship",
    "archimate_allowed_targets",
    "archimate_describe_conventions",
}

MODEL_TOOLS = {
    "list_projects",
    "get_model",
    "query_elements",
    "add_element",
    "add_relationship",
    "set_element_properties",
    "remove_element",
    "validate_model",
    "render_roadmap",
    "get_radar",
    "export_open_exchange",
}

failures = 0


def check(ok: bool, label: str, detail: str = "") -> None:
    global failures
    print(f"  {'PASS' if ok else 'FAIL'}  {label}{f' — {detail}' if detail else ''}")
    if not ok:
        failures += 1


def text_of(result) -> str:
    """The text content of a tool result, whatever shape the SDK returns."""
    parts = []
    for item in result.content:
        parts.append(getattr(item, "text", "") or "")
    return "\n".join(parts)


async def main() -> int:
    if not SERVER.exists():
        print(f"No server at {SERVER}. Run: npm run build --workspace @dlab5/archimate-mcp")
        return 1

    credentialed = bool(
        os.environ.get("BP_REFRESH_TOKEN")
        or (os.environ.get("BP_USER") and os.environ.get("BP_PASSWORD"))
    )

    # The server reads its configuration from the environment, so it is passed
    # through as-is. Without credentials it must still start.
    params = StdioServerParameters(
        command="node",
        args=[str(SERVER)],
        env=dict(os.environ),
        cwd=str(ROOT),
    )

    print(f"MCP over stdio, driven from Python {sys.version.split()[0]}")
    print(f"  server {SERVER.relative_to(ROOT)}")
    print(f"  credentials {'present' if credentialed else 'absent — expecting metamodel only'}\n")

    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            init = await session.initialize()
            check(
                init.server_info.name == "archimate",
                "the server identifies itself",
                f"{init.server_info.name} {init.server_info.version}",
            )

            listed = await session.list_tools()
            names = {t.name for t in listed.tools}
            print(f"\ntools/list — {len(names)} tools")

            missing = METAMODEL_TOOLS - names
            check(not missing, "every metamodel tool is offered", ", ".join(sorted(missing)))

            if credentialed:
                missing_model = MODEL_TOOLS - names
                check(
                    not missing_model,
                    "every model tool is offered",
                    ", ".join(sorted(missing_model)),
                )
            else:
                leaked = MODEL_TOOLS & names
                check(
                    not leaked,
                    "no model tool is offered without credentials",
                    ", ".join(sorted(leaked)),
                )

            # The reason this file exists. A zod schema that fails to convert
            # leaves a tool advertised with an input schema no client can use,
            # and nothing on the TypeScript side would notice.
            print("\nschemas")
            bad = []
            for tool in listed.tools:
                schema = tool.input_schema
                if not isinstance(schema, dict) or schema.get("type") != "object":
                    bad.append(f"{tool.name}: not an object schema")
                    continue
                try:
                    json.dumps(schema)
                except (TypeError, ValueError) as err:
                    bad.append(f"{tool.name}: not serialisable ({err})")
            check(not bad, "every tool advertises a usable JSON Schema", "; ".join(bad))
            check(
                all(t.description for t in listed.tools),
                "every tool describes itself",
                ", ".join(t.name for t in listed.tools if not t.description),
            )

            print("\ntools/call — the specification")

            result = await session.call_tool("archimate_list_element_types", {})
            body = text_of(result)
            check(not result.is_error, "list_element_types returns", body[:60])
            check(
                "ApplicationComponent" in body and "WorkPackage" in body,
                "it lists the ArchiMate 3.2 element types",
                f"{len(body)} chars",
            )

            # A relationship the specification permits directly, and one it
            # forbids. Both answers have to survive the round trip.
            allowed = await session.call_tool(
                "archimate_check_relationship",
                {"source": "WorkPackage", "relationship": "realization", "target": "Deliverable"},
            )
            forbidden = await session.call_tool(
                "archimate_check_relationship",
                {"source": "Deliverable", "relationship": "triggering", "target": "Goal"},
            )
            # Asserted on the structured field, not on the wording. The tool
            # answers in JSON; matching prose would have this test break the
            # next time someone improves a sentence, and it was wrong first
            # time round for exactly that reason.
            def verdict(result):
                try:
                    return json.loads(text_of(result))
                except json.JSONDecodeError:
                    return {}

            check(
                verdict(allowed).get("allowed") is True,
                "a permitted relationship is reported as permitted",
                json.dumps(verdict(allowed))[:70],
            )
            check(
                verdict(forbidden).get("allowed") is False,
                "a forbidden relationship is reported as forbidden",
                json.dumps(verdict(forbidden))[:70],
            )
            check(
                verdict(allowed).get("derived") is False,
                "and says whether it is direct or derived",
                f"derived={verdict(allowed).get('derived')}",
            )

            conventions = await session.call_tool("archimate_describe_conventions", {})
            body = text_of(conventions)
            check(
                "owner" in body and "debt" in body and "cost" in body,
                "the overlay conventions reach an agent",
                "owner, debt and cost all present",
            )

            # An error must come back as content the agent can read, not as a
            # transport failure that kills the session.
            print("\nerrors")
            bogus = await session.call_tool(
                "archimate_describe_element_type", {"type": "NotAThing"}
            )
            check(
                bogus.is_error or "NotAThing" in text_of(bogus),
                "an unknown element type is answered, not crashed",
                text_of(bogus)[:70],
            )

            still_alive = await session.call_tool("archimate_list_element_types", {})
            check(
                not still_alive.is_error,
                "the session survives a tool error",
                "a later call still succeeds",
            )

            if credentialed:
                print("\ntools/call — a project")
                projects = await session.call_tool("list_projects", {})
                body = text_of(projects)
                check(not projects.is_error, "list_projects returns", body[:70])
                check(
                    "dlab5-blueprint" in body,
                    "it names a project this account can open",
                    f"{len(body)} chars",
                )

                model = await session.call_tool(
                    "query_elements", {"project": "dlab5-blueprint", "type": "WorkPackage"}
                )
                check(
                    not model.is_error and "WP1" in text_of(model),
                    "query_elements reads the live model",
                    text_of(model)[:70],
                )

                findings = await session.call_tool(
                    "validate_model", {"project": "dlab5-blueprint"}
                )
                check(
                    not findings.is_error,
                    "validate_model runs against the live model",
                    text_of(findings)[:70],
                )

    print()
    print("all checks passed" if failures == 0 else f"{failures} FAILED")
    return 0 if failures == 0 else 1


HOSTED_TOOLS = METAMODEL_TOOLS | MODEL_TOOLS | {"list_documents", "get_document", "put_document"}
SAP_TOOLS = {"sap_diagram_scaffold", "sap_diagram_validate", "sap_diagram_score", "sap_diagram_from_model"}


async def hosted_main(url: str) -> int:
    """The hosted server, over streamable HTTP, as two keys of one owner."""
    import httpx2
    from mcp.client.streamable_http import streamable_http_client

    write_key = os.environ["BP_KEY_WRITE"]
    read_key = os.environ["BP_KEY_READ"]
    product = os.environ["BP_SCRATCH_PRODUCT"]

    print(f"MCP over streamable HTTP, driven from Python {sys.version.split()[0]}")
    print(f"  scratch product {product}\n")

    async with httpx2.AsyncClient(timeout=30) as http:
        anonymous = await http.post(url, json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
        check(anonymous.status_code == 401, "no key is refused", str(anonymous.status_code))
        wrong = await http.post(
            url,
            headers={"Authorization": "Bearer bp_zzzzzzzz_" + "z" * 32},
            json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
        )
        check(wrong.status_code == 401, "an unknown key is refused", str(wrong.status_code))

    async def session_for(key: str):
        http = httpx2.AsyncClient(headers={"Authorization": f"Bearer {key}"}, timeout=60)
        return http, streamable_http_client(url, http_client=http)

    http, transport = await session_for(write_key)
    async with http, transport as (read, write):
        async with ClientSession(read, write) as session:
            init = await session.initialize()
            check(init.server_info.name == "archimate", "the hosted server identifies itself")

            names = {t.name for t in (await session.list_tools()).tools}
            check(not (HOSTED_TOOLS - names), "every API tool is offered", ", ".join(sorted(HOSTED_TOOLS - names)))
            check(not (SAP_TOOLS & names), "the SAP diagram tools are not", ", ".join(sorted(SAP_TOOLS & names)))

            projects = await session.call_tool("list_projects", {})
            check(product in text_of(projects), "the key sees its owner's product", text_of(projects)[:70])

            print("\nwriting, with a write key")
            added = await session.call_tool(
                "add_element",
                {"project": product, "type": "ApplicationComponent", "name": "Hosted check"},
            )
            check(not added.is_error, "add_element writes the model", text_of(added)[:70])
            ringed = await session.call_tool(
                "set_element_properties",
                {"project": product, "id": "hosted-check", "properties": {"radarRing": "trial"}},
            )
            check(not ringed.is_error, "set_element_properties sets a radar ring", text_of(ringed)[:70])
            model = await session.call_tool("query_elements", {"project": product, "nameContains": "Hosted"})
            check('"trial"' in text_of(model), "the change is read back", text_of(model)[:90])
            radar = await session.call_tool("get_radar", {"project": product})
            check(not radar.is_error, "get_radar runs", text_of(radar)[:70])

            elsewhere = await session.call_tool("get_model", {"project": "no-such-product-anywhere"})
            check(elsewhere.is_error, "a product the owner cannot open is refused", text_of(elsewhere)[:70])

    print("\nthe same owner, with a read key")
    http, transport = await session_for(read_key)
    async with http, transport as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            seen = await session.call_tool("query_elements", {"project": product, "nameContains": "Hosted"})
            check("hosted-check" in text_of(seen), "a read key reads", text_of(seen)[:70])
            refused = await session.call_tool(
                "add_element", {"project": product, "type": "ApplicationComponent", "name": "Should not"}
            )
            check(refused.is_error, "a read key cannot write", text_of(refused)[:90])

    http, transport = await session_for(write_key)
    async with http, transport as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            removed = await session.call_tool("remove_element", {"project": product, "id": "hosted-check"})
            check(not removed.is_error, "remove_element tidies up", text_of(removed)[:70])

    print()
    print("all checks passed" if failures == 0 else f"{failures} FAILED")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    if "--url" in sys.argv:
        raise SystemExit(asyncio.run(hosted_main(sys.argv[sys.argv.index("--url") + 1])))
    raise SystemExit(asyncio.run(main()))
