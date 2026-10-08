"""Which spaces exist: the blueprinting products, read from its Project table.

A space is a product, so one claude.ai Project, one blueprinting product and
one folder `docs/<product-id>/` are the same thing. This module only reads the
table; products are created in the blueprinting app, never here.
"""

import time


class Products:
    # An unknown slug triggers one re-read, but not more often than this, so a
    # caller guessing names cannot turn every request into a table scan.
    REFRESH_SECONDS = 60

    def __init__(self, table_name: str, dynamodb):
        self._table = table_name
        self._db = dynamodb
        self._names: dict[str, str] | None = None
        self._loaded_at = 0.0

    def _load(self) -> None:
        names: dict[str, str] = {}
        kwargs = {
            "TableName": self._table,
            "ProjectionExpression": "slug, #n",
            "ExpressionAttributeNames": {"#n": "name"},
        }
        while True:
            page = self._db.scan(**kwargs)
            for item in page.get("Items", []):
                names[item["slug"]["S"]] = item.get("name", {}).get("S", "")
            if "LastEvaluatedKey" not in page:
                break
            kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]
        self._names = names
        self._loaded_at = time.monotonic()

    def all(self) -> dict[str, str]:
        if self._names is None:
            self._load()
        return dict(self._names)

    def name(self, slug: str) -> str | None:
        """The product's name, or None when no product has this id."""
        if self._names is None:
            self._load()
        if slug not in self._names and time.monotonic() - self._loaded_at > self.REFRESH_SECONDS:
            self._load()
        return self._names.get(slug)
