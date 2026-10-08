"""The ASGI app: bearer-key check around a stateless MCP streamable-HTTP app.

Run by uvicorn, locally or behind the AWS Lambda Web Adapter (see run.sh).
Stateless with JSON responses: every request stands alone, which is what a
Lambda can serve and all a document store needs.
"""

import logging
import os

import boto3
from mcp.server.mcpserver import MCPServer
from mcp.server.transport_security import TransportSecuritySettings

from auth import BearerAuth, ssm_key
from products import Products
from store import Store
from tools import INSTRUCTIONS, register

logging.basicConfig(level=logging.INFO, format="%(message)s")
# Request-level logs from the HTTP stack could carry headers; keep them quiet.
for noisy in ("httpx", "botocore", "mcp", "uvicorn.access"):
    logging.getLogger(noisy).setLevel(logging.WARNING)


def build_server(store: Store, products: Products) -> MCPServer:
    mcp = MCPServer("project-docs", instructions=INSTRUCTIONS)
    register(mcp, store, products)
    return mcp


def create_app(store: Store, products: Products, key, on_lambda: bool):
    mcp = build_server(store, products)
    if on_lambda:
        # The SDK's DNS-rebinding guard protects servers on localhost from web
        # pages in a browser. Behind a Function URL with a bearer key on every
        # request it protects nothing, and it would reject the URL's Host.
        security = TransportSecuritySettings(enable_dns_rebinding_protection=False)
    else:
        security = TransportSecuritySettings(
            enable_dns_rebinding_protection=True,
            allowed_hosts=["127.0.0.1:*", "localhost:*"],
            allowed_origins=["http://127.0.0.1:*", "http://localhost:*"],
        )
    inner = mcp.streamable_http_app(stateless_http=True, json_response=True, transport_security=security)
    return BearerAuth(inner, key)


def _from_environment():
    on_lambda = "AWS_LAMBDA_FUNCTION_NAME" in os.environ
    store = Store(os.environ["BUCKET"], boto3.client("s3"))
    products = Products(os.environ["PROJECT_TABLE"], boto3.client("dynamodb"))
    if os.environ.get("PROJECT_DOCS_KEY") and not on_lambda:
        local_key = os.environ["PROJECT_DOCS_KEY"]
        key = lambda: local_key  # noqa: E731 — local runs only
    else:
        key = ssm_key(boto3.client("ssm"), os.environ["KEY_PARAM"])
    return create_app(store, products, key, on_lambda)


app = _from_environment() if "BUCKET" in os.environ else None
