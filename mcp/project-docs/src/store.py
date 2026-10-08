"""The documents in S3, under `docs/<space>/<path>`.

Writes are conditional and never blind: with an etag they carry `If-Match`,
without one `If-None-Match: *`, so a write either applies to the version the
caller read or creates a file that did not exist. History is S3 versioning;
nothing here deletes anything.
"""

from botocore.exceptions import ClientError

from rules import MAX_BYTES

ROOT = "docs/"
MAX_LIST = 1000
MAX_HITS = 50


class Conflict(Exception):
    """The document is not in the state the caller expected."""

    def __init__(self, path: str, current_etag: str | None, expected_etag: str | None):
        self.path = path
        self.current_etag = current_etag
        self.expected_etag = expected_etag
        super().__init__(path)


class NotFound(Exception):
    pass


def _etag(value: str) -> str:
    return value.strip('"')


def _iso(dt) -> str:
    return dt.isoformat()


class Store:
    def __init__(self, bucket: str, s3):
        self._bucket = bucket
        self._s3 = s3

    def _objects(self, prefix: str, limit: int = MAX_LIST):
        """Yields S3 listing entries under docs/<prefix>, at most `limit`."""
        kwargs = {"Bucket": self._bucket, "Prefix": ROOT + prefix}
        count = 0
        while True:
            page = self._s3.list_objects_v2(**kwargs)
            for obj in page.get("Contents", []):
                if count == limit:
                    return
                count += 1
                yield obj
            if not page.get("IsTruncated"):
                return
            kwargs["ContinuationToken"] = page["NextContinuationToken"]

    def listing(self, prefix: str) -> dict:
        docs = [
            {
                "path": obj["Key"][len(ROOT):],
                "size": obj["Size"],
                "etag": _etag(obj["ETag"]),
                "last_modified": _iso(obj["LastModified"]),
            }
            for obj in self._objects(prefix, MAX_LIST + 1)
        ]
        return {"docs": docs[:MAX_LIST], "truncated": len(docs) > MAX_LIST}

    def read(self, path: str, version_id: str | None = None) -> dict:
        kwargs = {"Bucket": self._bucket, "Key": ROOT + path}
        if version_id:
            kwargs["VersionId"] = version_id
        try:
            obj = self._s3.get_object(**kwargs)
        except ClientError as e:
            if e.response["Error"]["Code"] in ("NoSuchKey", "NoSuchVersion", "404", "InvalidArgument"):
                raise NotFound(path) from None
            raise
        return {
            "path": path,
            "content": obj["Body"].read().decode("utf-8"),
            "etag": _etag(obj["ETag"]),
            "version_id": obj.get("VersionId"),
            "last_modified": _iso(obj["LastModified"]),
        }

    def current_etag(self, path: str) -> str | None:
        try:
            return _etag(self._s3.head_object(Bucket=self._bucket, Key=ROOT + path)["ETag"])
        except ClientError as e:
            if e.response["Error"]["Code"] in ("404", "NoSuchKey", "NotFound"):
                return None
            raise

    def write(self, path: str, body: bytes, expected_etag: str | None) -> dict:
        kwargs = {
            "Bucket": self._bucket,
            "Key": ROOT + path,
            "Body": body,
            "ContentType": "text/plain; charset=utf-8",
        }
        if expected_etag:
            kwargs["IfMatch"] = f'"{_etag(expected_etag)}"'
        else:
            kwargs["IfNoneMatch"] = "*"
        try:
            out = self._s3.put_object(**kwargs)
        except ClientError as e:
            code = e.response["Error"]["Code"]
            # 412 PreconditionFailed: changed, or exists on a create.
            # 409 ConditionalRequestConflict: a concurrent conditional write won.
            # 404 NoSuchKey: If-Match against a file that is not there.
            if code in ("PreconditionFailed", "ConditionalRequestConflict", "NoSuchKey", "404"):
                raise Conflict(path, self.current_etag(path), expected_etag) from None
            raise
        return {"path": path, "etag": _etag(out["ETag"]), "version_id": out.get("VersionId")}

    def search(self, query: str, prefix: str) -> dict:
        needle = query.lower()
        hits = []
        for obj in self._objects(prefix):
            if obj["Size"] > MAX_BYTES:
                continue
            body = self._s3.get_object(Bucket=self._bucket, Key=obj["Key"])["Body"].read()
            text = body.decode("utf-8", errors="replace")
            for number, line in enumerate(text.splitlines(), start=1):
                if needle in line.lower():
                    hits.append({"path": obj["Key"][len(ROOT):], "line": number, "text": line[:500]})
                    if len(hits) == MAX_HITS:
                        return {"hits": hits, "truncated": True}
        return {"hits": hits, "truncated": False}

    def history(self, path: str) -> list[dict]:
        key = ROOT + path
        kwargs = {"Bucket": self._bucket, "Prefix": key}
        versions = []
        while True:
            page = self._s3.list_object_versions(**kwargs)
            for v in page.get("Versions", []):
                if v["Key"] == key:
                    versions.append(
                        {
                            "version_id": v["VersionId"],
                            "last_modified": _iso(v["LastModified"]),
                            "size": v["Size"],
                            "etag": _etag(v["ETag"]),
                            "is_latest": v["IsLatest"],
                        }
                    )
            if not page.get("IsTruncated"):
                break
            kwargs["KeyMarker"] = page["NextKeyMarker"]
            kwargs["VersionIdMarker"] = page["NextVersionIdMarker"]
        versions.sort(key=lambda v: v["last_modified"], reverse=True)
        return versions
