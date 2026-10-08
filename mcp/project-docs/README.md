# project-docs — one document store for Claude Code and claude.ai

claude.ai Projects and Claude Code don't share files, so design documents,
`.ttl` ontologies and handoffs get copied by hand between the two, and the
copies drift apart. This is a small remote MCP server over one S3 bucket. Both
clients read and write the same files, so there is a single copy and nothing to
sync.

**A space is a blueprinting product.** Every path starts with a product id:

```
docs/p-7f3k2b9c4d/le-bosc-jardin-conception.md
docs/p-7f3k2b9c4d/ontology/perma-core.ttl
```

One claude.ai Project, one blueprinting product and one folder are the same
thing. `list_docs` without a prefix shows the products by name, so nobody has to
remember ids. The server only *reads* blueprinting's Project table. Products
are created in the blueprinting app, and a write to a space that isn't a
product is refused. Why it is a separate store and not the platform's own
product documents: ADR-0013.

## The five tools

| Tool | What it does |
|---|---|
| `list_docs(prefix?)` | Paths, sizes, etags and dates, at most 1000. Without a prefix, also lists the spaces (products). |
| `read_doc(path, version_id?)` | Content and etag. The latest version unless a version is given. |
| `write_doc(path, content, expected_etag?)` | With an etag, change exactly that version (`If-Match`). Without one, create only (`If-None-Match: *`). A conflict returns the current etag: re-read, merge, retry. |
| `search_docs(query, prefix?)` | Case-insensitive substring search, at most 50 matching lines. |
| `history(path)` | Every version, newest first. |

Text files only (`.md .ttl .txt .json .csv .yaml .sparql .py`), up to 1 MB.
Paths are relative, `[A-Za-z0-9._/-]`, no `..`, at most 512 characters.
Nothing is ever deleted: the bucket is versioned and the Lambda has no
delete permission.

## How it runs

```
Claude Code / claude.ai ──HTTPS, MCP streamable HTTP (stateless, JSON)──▶
  Lambda Function URL ─▶ Lambda (Python 3.12, arm64)
                          Lambda Web Adapter → uvicorn → MCP app
                          ─▶ S3 bucket, private, versioned, SSE-S3
```

The Function URL has no AWS auth of its own. `src/auth.py` checks
`Authorization: Bearer <key>` on every request, in constant time, and answers
everything else with a bare 401. The key lives in SSM Parameter Store and is
read once per cold start. Logs record tool, path, result and duration, never
content and never the key.

## Deploy

You need the SAM CLI (`python3 -m venv ~/.local/aws-sam && ~/.local/aws-sam/bin/pip install aws-sam-cli`)
and AWS credentials that may create a CloudFormation stack, an IAM role, a
Lambda, an S3 bucket and a log group in eu-central-1. `deploy-policy.json`
is exactly that, scoped to `project-docs-mcp-*` names and SAM's artifacts
bucket. Create it once as a customer-managed policy and attach it to the
deploying user. It names no account, so it is safe in this repository.

1. **Create the key, the one manual step.** It is never printed:

   ```bash
   aws ssm put-parameter --name /project-docs-mcp/api-key --type SecureString \
     --value "$(openssl rand -base64 36)"
   ```

2. **Fill in `samconfig.toml`.** `cp samconfig.example.toml samconfig.toml`, then set:
   - `AdapterLayerArn`: the `LambdaAdapterLayerArm64` ARN from the
     [Lambda Web Adapter README](https://github.com/awslabs/aws-lambda-web-adapter#lambda-functions-packaged-as-zip-package-for-aws-managed-runtimes),
     with `eu-central-1` filled in.
   - `ProjectTableName`: the blueprinting environment's Project table:
     `aws dynamodb list-tables --query "TableNames[?starts_with(@,'Project-')]"`.
     If there is more than one, the `<api id>` in the name is the AppSync API
     id in that environment's `amplify_outputs.json`.

3. **Build and deploy:**

   ```bash
   sam build && sam deploy
   ```

   `sam build` fetches arm64 wheels on an x86 machine; no container is
   needed. The stack prints `McpUrl`. It is the address of a write path, so
   don't commit it anywhere.

Deleting the stack keeps the bucket and its documents (`DeletionPolicy: Retain`).

## Connect Claude Code

```bash
claude mcp add --transport http project-docs <McpUrl> \
  --header "Authorization: Bearer $(aws ssm get-parameter --name /project-docs-mcp/api-key --with-decryption --query Parameter.Value --output text)"
```

That stores the key in `~/.claude.json`, which is local and never in a repo.
claude.ai needs OAuth, which is phase 2 and not built yet.

## Rotate the key

```bash
aws ssm put-parameter --name /project-docs-mcp/api-key --type SecureString --overwrite \
  --value "$(openssl rand -base64 36)"
# Running instances keep the old key until their next cold start. Force one:
aws lambda update-function-configuration --function-name project-docs-mcp \
  --description "key rotated $(date -I)"
```

Then remove and re-add the server in Claude Code with the new key
(`claude mcp remove project-docs`, then the `add` command above).

## Develop and test

```bash
python3.12 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q tests
```

The tests use moto, which implements S3's `If-Match` and `If-None-Match`, so
the conflict path is covered without AWS. `tests/test_http.py` runs the real
ASGI app under uvicorn and talks MCP to it over HTTP, the same stack the
Function URL serves.

To run it locally against a real bucket (the local run allows only
127.0.0.1/localhost as Host):

```bash
cd src && BUCKET=<bucket> PROJECT_TABLE=<table> PROJECT_DOCS_KEY=<any 32+ chars> \
  ../.venv/bin/python -m uvicorn app:app --port 8000
claude mcp add --transport http project-docs-local http://127.0.0.1:8000/mcp \
  --header "Authorization: Bearer <same key>"
```
