"""Bearer-key check in front of everything.

The Function URL has AuthType NONE, so this middleware is the only thing
between the internet and the store. Every HTTP request needs
`Authorization: Bearer <key>`, compared in constant time; anything else gets a
bare 401. The one exception is the readiness path the Lambda Web Adapter
probes, which says "ok" and nothing more.
"""

import hmac
from typing import Callable

HEALTH_PATH = "/healthz"


class BearerAuth:
    def __init__(self, app, key: Callable[[], str]):
        self._app = app
        self._key = key

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self._app(scope, receive, send)
        if scope["path"] == HEALTH_PATH:
            return await _plain(send, 200, b"ok")
        given = b""
        for name, value in scope["headers"]:
            if name == b"authorization":
                given = value
                break
        expected = b"Bearer " + self._key().encode()
        if not hmac.compare_digest(given, expected):
            return await _plain(send, 401, b"unauthorized", [(b"www-authenticate", b"Bearer")])
        return await self._app(scope, receive, send)


async def _plain(send, status: int, body: bytes, headers=()):
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [(b"content-type", b"text/plain"), *headers],
        }
    )
    await send({"type": "http.response.body", "body": body})


def ssm_key(ssm, name: str) -> Callable[[], str]:
    """Reads the key from SSM on first use, once per cold start."""
    cache: list[str] = []

    def key() -> str:
        if not cache:
            value = ssm.get_parameter(Name=name, WithDecryption=True)["Parameter"]["Value"]
            if len(value) < 32:
                raise RuntimeError("The API key in SSM is shorter than 32 characters.")
            cache.append(value)
        return cache[0]

    return key
