#!/usr/bin/env node
/**
 * The document space, against a real backend.
 *
 * Checks the things that would be invisible until they mattered: that
 * classification defaults to confidential, that a credential is refused rather
 * than warned about, and that the source of a stored document cannot be
 * rewritten. Each of those is a promise the UI makes on the function's behalf,
 * and a promise only the function can actually keep.
 *
 * Creates scratch documents and deletes them again, as verify:model-store does.
 *
 * Usage:  BP_USER=... BP_PASSWORD=... node scripts/verify-documents.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Amplify } from "aws-amplify";
import { signIn, fetchAuthSession, signOut } from "aws-amplify/auth";
import { cognitoUserPoolsTokenProvider } from "aws-amplify/auth/cognito";
import { generateClient } from "aws-amplify/data";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
Amplify.configure(
  JSON.parse(readFileSync(resolve(ROOT, "backend/amplify_outputs.json"), "utf8"))
);

const mem = new Map();
cognitoUserPoolsTokenProvider.setKeyValueStorage({
  setItem: async (k, v) => void mem.set(k, v),
  getItem: async (k) => (mem.has(k) ? mem.get(k) : null),
  removeItem: async (k) => void mem.delete(k),
  clear: async () => void mem.clear(),
});

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};

const product = arg("--product") ?? "dlab5-blueprint";
const { BP_USER: username, BP_PASSWORD: password } = process.env;
if (!username || !password) {
  console.error("set BP_USER and BP_PASSWORD");
  process.exit(2);
}

let failures = 0;
const check = (ok, what, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${what}${detail ? ` - ${detail}` : ""}`);
  if (!ok) failures++;
};

const stamp = Date.now().toString(36);
const plainId = `verify-doc-${stamp}`;
const sharedId = `verify-shared-${stamp}`;
const collabId = `verify-collab-${stamp}`;
const secretId = `verify-secret-${stamp}`;
const created = [];
const sharedScratch = [];
let sharedBucket = null;

/** The operator's own AWS CLI, for what the functions deliberately cannot do. */
const aws = (...args) =>
  execFileSync("aws", [...args, "--output", "json"], { encoding: "utf8" });

const SOURCE = `# Quarterly review

<!-- am element type=Stakeholder id=verify-cfo -->
## Chief Financial Officer
Wants cost per transaction below EUR 0.02.
`;

/** Calls the mutation and returns {data, error} rather than throwing. */
async function call(client, name, args) {
  try {
    const r = await client.mutations[name](args);
    if (r.errors?.length) return { error: r.errors.map((e) => e.message).join("; ") };
    return { data: r.data };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

await signIn({ username, password });
await fetchAuthSession();
const client = generateClient({ authMode: "userPool" });

console.log(`document store, product ${product}\n`);

try {
  /* -- a document with no classification is confidential ------------------- */

  const stored = await call(client, "saveDocument", {
    projectSlug: product,
    docId: plainId,
    markdown: SOURCE,
    title: "Verification scratch",
  });
  check(!stored.error, "a document can be stored", stored.error ?? "");
  if (!stored.error) created.push(plainId);
  check(
    stored.data?.classification === "confidential",
    "an unclassified document is confidential",
    `classification "${stored.data?.classification}"`
  );

  /* -- and comes back ------------------------------------------------------ */

  const read = await call(client, "requestDocumentReadUrl", {
    projectSlug: product,
    docId: plainId,
  });
  check(read.data?.exists === true, "it exists once stored");
  const text = read.data?.url ? await (await fetch(read.data.url)).text() : null;
  check(text === SOURCE, "the bytes come back exactly as they went in");

  /* -- the source is a record, so it is written once ----------------------- */

  const rewrite = await call(client, "saveDocument", {
    projectSlug: product,
    docId: plainId,
    markdown: "# Something else entirely\n",
  });
  check(
    Boolean(rewrite.error) && /never rewritten/.test(rewrite.error ?? ""),
    "the source cannot be rewritten",
    rewrite.error ? "refused" : "IT WAS OVERWRITTEN"
  );

  const still = await call(client, "requestDocumentReadUrl", {
    projectSlug: product,
    docId: plainId,
  });
  const after = still.data?.url ? await (await fetch(still.data.url)).text() : null;
  check(after === SOURCE, "and the record is intact after the attempt");

  /* -- the annotated working copy is a different object -------------------- */

  const annotated = await call(client, "saveDocument", {
    projectSlug: product,
    docId: plainId,
    markdown: SOURCE + "\n<!-- am ignore -->\n## Appendix\n",
    kind: "annotated",
  });
  check(!annotated.error, "the working copy can be written", annotated.error ?? "");
  check(
    annotated.data?.key?.endsWith("/annotated.md") === true,
    "and lands beside the source, not on it",
    annotated.data?.key ?? ""
  );

  /* -- credentials are refused, not warned about --------------------------- */

  const withToken = await call(client, "saveDocument", {
    projectSlug: product,
    docId: secretId,
    markdown: `# Store\n\nAdmin token: shpat_${"0123456789abcdef".repeat(2)}\n`,
    title: "Has a token",
  });
  check(
    Boolean(withToken.error) && /refused|access token/i.test(withToken.error ?? ""),
    "a document carrying an access token is refused",
    withToken.error ? "refused" : "IT WAS STORED"
  );
  if (!withToken.error) created.push(secretId);

  /* -- sharing is explicit ------------------------------------------------- */

  const shared = await call(client, "saveDocument", {
    projectSlug: product,
    docId: sharedId,
    markdown: "# Field mapping\n\nTechnical, safe to travel.\n",
    title: "Verification shared",
    classification: "shared",
  });
  check(
    shared.data?.classification === "shared",
    "a document can be marked shared, explicitly",
    shared.data?.classification ?? shared.error ?? ""
  );
  if (!shared.error) created.push(sharedId);

  const collab = await call(client, "saveDocument", {
    projectSlug: product,
    docId: collabId,
    markdown: "# Sprint 17 notes\n\nStandup, blockers, what shipped.\n",
    title: "Verification collaboration",
    classification: "collaboration",
  });
  check(
    collab.data?.classification === "collaboration",
    "a document can be marked collaboration",
    collab.data?.classification ?? collab.error ?? ""
  );
  if (!collab.error) created.push(collabId);

  // A typo must not be the thing that decides a document travels.
  const typo = await call(client, "saveDocument", {
    projectSlug: product,
    docId: `${collabId}-typo`,
    markdown: "# Nonsense classification\n",
    title: "Verification typo",
    classification: "Collaboration",
  });
  check(
    typo.data?.classification === "confidential",
    "an unrecognised classification falls back to confidential",
    typo.data?.classification ?? typo.error ?? ""
  );
  if (!typo.error) created.push(`${collabId}-typo`);

  /* -- the index ----------------------------------------------------------- */

  const list = await client.models.Document.list({
    filter: { projectSlug: { eq: product } },
  });
  const ours = (list.data ?? []).filter((d) => d.docId.startsWith("verify-"));
  check(
    ours.length === created.length,
    "every stored document is in the index",
    `${ours.length} of ${created.length}`
  );
  const tally = {};
  for (const d of ours) tally[d.classification] = (tally[d.classification] ?? 0) + 1;
  check(
    tally.confidential === 2 && tally.collaboration === 1 && tally.shared === 1,
    "the index records how far each may travel",
    Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(", ")
  );

  /* -- a product you are not in ------------------------------------------- */

  const elsewhere = await call(client, "requestDocumentReadUrl", {
    projectSlug: "no-such-product-anywhere",
    docId: plainId,
  });
  check(
    Boolean(elsewhere.error) && /No such product, or you cannot access it/.test(elsewhere.error),
    "an unknown product is refused without saying which it was",
    elsewhere.error ? "refused, indistinguishably" : "IT ANSWERED"
  );

  /* -- shared files: the project-docs store, read-only (ADR-0013) ----------- */

  try {
    sharedBucket = JSON.parse(
      aws("ssm", "get-parameter", "--name", "/project-docs-mcp/bucket-name")
    ).Parameter.Value;
  } catch {
    sharedBucket = null;
  }

  const listed = await call(client, "listSharedFiles", { projectSlug: product });
  if (!sharedBucket) {
    check(
      listed.data?.available === false,
      "without a project-docs store, the list says so rather than failing",
      listed.error ?? ""
    );
  } else {
    // Written with the operator's credentials: nothing in this app writes
    // there, which is the point being checked.
    const md = `_verify-${stamp}/check.md`;
    const ttl = `_verify-${stamp}/check.ttl`;
    const MD = "# Shared\n\nwritten by verify:documents, ümlaut and all\n";
    const TTL = '@prefix : <urn:x#> .\n:a :b "c" .\n';
    for (const [path, body] of [[md, MD], [ttl, TTL]]) {
      execFileSync(
        "aws",
        ["s3", "cp", "-", `s3://${sharedBucket}/docs/${product}/${path}`, "--content-type", "text/plain; charset=utf-8"],
        { input: body }
      );
      sharedScratch.push(`docs/${product}/${path}`);
    }

    const again = await call(client, "listSharedFiles", { projectSlug: product });
    const paths = (again.data?.files ?? []).map((f) => f.path);
    check(
      again.data?.available === true && paths.includes(md) && paths.includes(ttl),
      "shared files are listed, relative to the product",
      again.error ?? `${paths.length} listed`
    );

    const got = await call(client, "readSharedFile", { projectSlug: product, path: md });
    check(got.data?.content === MD, "a shared file reads back byte for byte", got.error ?? "");
    const gotTtl = await call(client, "readSharedFile", { projectSlug: product, path: ttl });
    check(gotTtl.data?.content === TTL, "so does Turtle", gotTtl.error ?? "");

    for (const [bad, why] of [
      [`../${product}/${md}`, "a '..' path"],
      [`_verify-${stamp}/check.exe`, "a file type the store does not hold"],
      [`/${md}`, "an absolute path"],
    ]) {
      const r = await call(client, "readSharedFile", { projectSlug: product, path: bad });
      check(Boolean(r.error) && !r.data?.content, `${why} is refused`, r.error ?? "IT ANSWERED");
    }

    const foreign = await call(client, "listSharedFiles", { projectSlug: "no-such-product-anywhere" });
    check(
      Boolean(foreign.error) && /No such product, or you cannot access it/.test(foreign.error),
      "another product's shared files are refused without saying which",
      foreign.error ? "refused, indistinguishably" : "IT ANSWERED"
    );
  }
} finally {
  for (const docId of created) {
    try {
      await client.models.Document.delete({ projectSlug: product, docId });
      console.log(`\ncleaned up ${docId}`);
    } catch (err) {
      console.error(`could not delete ${docId}: ${err.message}`);
    }
  }
  // The function has no delete — documents are records, and a record store
  // whose contents can be removed by the thing that writes them is a weaker
  // promise than the one this makes. So the scratch objects are cleared with
  // the operator's own credentials, the way verify:bundle clears its Cognito
  // group.
  const outputs = JSON.parse(
    readFileSync(resolve(ROOT, "backend/amplify_outputs.json"), "utf8")
  );
  const bucket = outputs?.storage?.bucket_name;
  if (bucket) {
    for (const docId of [plainId, sharedId, collabId, `${collabId}-typo`, secretId]) {
      try {
        execFileSync(
          "aws",
          ["s3", "rm",
           `s3://${bucket}/projects/${product}/documents/${docId}/`,
           "--recursive"],
          { stdio: "ignore" }
        );
      } catch {
        console.error(
          `LEFT BEHIND: s3://${bucket}/projects/${product}/documents/${docId}/`
        );
      }
    }
    console.log("cleared the scratch objects from S3");
  }
  // Versioned bucket: removing the key is not enough, every version goes.
  for (const key of sharedScratch) {
    try {
      const v = JSON.parse(
        aws("s3api", "list-object-versions", "--bucket", sharedBucket, "--prefix", key)
      );
      for (const x of [...(v.Versions ?? []), ...(v.DeleteMarkers ?? [])]) {
        if (x.Key !== key) continue;
        aws("s3api", "delete-object", "--bucket", sharedBucket, "--key", key, "--version-id", x.VersionId);
      }
    } catch {
      console.error(`LEFT BEHIND: s3://${sharedBucket}/${key}`);
    }
  }
  if (sharedScratch.length) console.log("cleared the shared-file scratch, every version");
  await signOut();
}

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
