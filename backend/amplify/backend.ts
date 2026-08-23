import { defineBackend } from "@aws-amplify/backend";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { auth } from "./auth/resource";
import { data } from "./data/resource";
import { storage } from "./storage/resource";
import { modelStorageProxy } from "./functions/modelStorageProxy/resource";

const backend = defineBackend({
  auth,
  data,
  storage,
  modelStorageProxy,
});

/* ------------------------------------------------------------------------ *
 * Auth hardening — neither switch is exposed by defineAuth.
 * ------------------------------------------------------------------------ */

const { cfnUserPool, cfnIdentityPool } = backend.auth.resources.cfnResources;

// Accounts are created by an administrator, who must also place the user in
// the right per-project group. Closing self-signup at the user-pool level
// rather than hiding it in the UI keeps that invariant true even if someone
// calls the Cognito API directly.
cfnUserPool.adminCreateUserConfig = {
  allowAdminCreateUserOnly: true,
};

// Nothing here is world-readable. Refusing unauthenticated identities removes
// the guest IAM role entirely rather than leaving it present but unused.
cfnIdentityPool.allowUnauthenticatedIdentities = false;

/* ------------------------------------------------------------------------ *
 * Point-in-time recovery. Project rows carry the ttlKey and version that make
 * the S3 graph findable and its concurrency checkable; losing one orphans a
 * model.
 * ------------------------------------------------------------------------ */

for (const table of ["Project", "View"] as const) {
  backend.data.resources.cfnResources.amplifyDynamoDbTables[
    table
  ].pointInTimeRecoveryEnabled = true;
}

/* ------------------------------------------------------------------------ *
 * modelStorageProxy.
 *
 * Gen 2 does not auto-grant cross-resource IAM to a function wired as a
 * custom-mutation handler, so every permission below is explicit.
 * ------------------------------------------------------------------------ */

const projectTable = backend.data.resources.tables["Project"];
const bucket = backend.storage.resources.bucket;
const proxyLambda = backend.modelStorageProxy.resources.lambda;

// Read-only on Project: the function decides whether a caller may touch a
// model, and never edits the project row itself.
proxyLambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["dynamodb:GetItem"],
    resources: [projectTable.tableArn],
  })
);

// Scoped to the projects/ prefix rather than the whole bucket. The function
// has no business reading exports or branding assets.
proxyLambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["s3:GetObject", "s3:PutObject"],
    resources: [`${bucket.bucketArn}/projects/*`],
  })
);

// ListBucket is required to tell "no model yet" from "not allowed".
//
// Without it S3 answers HeadObject on a missing key with 403 AccessDenied
// rather than 404 NotFound, because it will not reveal whether an object
// exists to a caller who cannot list. A project that simply has no model yet
// then looks identical to a permissions failure. Granted on the bucket itself
// — ListBucket is a bucket-level action — and conditioned to the same prefix
// as the object grant above.
proxyLambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["s3:ListBucket"],
    resources: [bucket.bucketArn],
    conditions: { StringLike: { "s3:prefix": ["projects/*"] } },
  })
);

backend.modelStorageProxy.addEnvironment(
  "PROJECT_TABLE_NAME",
  projectTable.tableName
);
backend.modelStorageProxy.addEnvironment("MODEL_BUCKET_NAME", bucket.bucketName);

export default backend;
