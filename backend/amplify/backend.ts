import { defineBackend } from "@aws-amplify/backend";
import { RemovalPolicy, Stack } from "aws-cdk-lib";
import { CfnUserPoolClient } from "aws-cdk-lib/aws-cognito";
import {
  AttributeType,
  BillingMode,
  Table,
} from "aws-cdk-lib/aws-dynamodb";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { auth } from "./auth/resource";
import { data } from "./data/resource";
import { storage } from "./storage/resource";
import { modelStorageProxy } from "./functions/modelStorageProxy/resource";
import { projectAdmin } from "./functions/projectAdmin/resource";
import { projectRename } from "./functions/projectRename/resource";
import { documentStore } from "./functions/documentStore/resource";
import { documentDelete } from "./functions/documentDelete/resource";
import { apiKeyAdmin } from "./functions/apiKeyAdmin/resource";
import { createAuthChallenge } from "./auth/triggers/createAuthChallenge.resource";
import { defineAuthChallenge } from "./auth/triggers/defineAuthChallenge.resource";
import { preTokenGeneration } from "./auth/triggers/preTokenGeneration.resource";
import { verifyAuthChallengeResponse } from "./auth/triggers/verifyAuthChallengeResponse.resource";

const backend = defineBackend({
  auth,
  data,
  storage,
  modelStorageProxy,
  projectAdmin,
  projectRename,
  documentStore,
  documentDelete,
  apiKeyAdmin,
  // Registered here as well as in defineAuth's `triggers`. It is the same
  // factory instance, so no second function is created — this is only how a
  // trigger's lambda becomes reachable for an IAM grant and an env var.
  defineAuthChallenge,
  createAuthChallenge,
  verifyAuthChallengeResponse,
  preTokenGeneration,
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

/* ------------------------------------------------------------------------ *
 * projectAdmin.
 * ------------------------------------------------------------------------ */

const projectAdminLambda = backend.projectAdmin.resources.lambda;

projectAdminLambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["dynamodb:PutItem"],
    resources: [projectTable.tableArn],
  })
);

// Wildcarded to this account and region rather than naming the user pool.
//
// The auth stack already references function code, so pointing an IAM grant
// back at backend.auth.resources.userPool.userPoolArn closes a CloudFormation
// cycle — the same trap the dhc-amplify-gen2 skill documents for Cognito
// triggers. The function recovers the real pool id from the caller's token
// issuer at runtime, which is authoritative anyway: it is the pool that signed
// the request.
const stack = Stack.of(projectAdminLambda);
projectAdminLambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: [
      "cognito-idp:CreateGroup",
      "cognito-idp:GetGroup",
      "cognito-idp:AdminAddUserToGroup",
    ],
    resources: [
      `arn:aws:cognito-idp:${stack.region}:${stack.account}:userpool/*`,
    ],
  })
);

backend.projectAdmin.addEnvironment("PROJECT_TABLE_NAME", projectTable.tableName);

/* ------------------------------------------------------------------------ *
 * projectRename.
 *
 * Its own function because AppSync does not populate event.info.fieldName for
 * these handlers, so one function cannot serve two mutations whose arguments
 * are identical. See functions/projectRename/resource.ts.
 * ------------------------------------------------------------------------ */

const projectRenameLambda = backend.projectRename.resources.lambda;

projectRenameLambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    // Update only. This function must never be able to create a product row,
    // because a row without its Cognito group is one nobody can open.
    actions: ["dynamodb:UpdateItem"],
    resources: [projectTable.tableArn],
  })
);

// Wildcarded for the same CloudFormation-cycle reason as projectAdmin above.
projectRenameLambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["cognito-idp:UpdateGroup", "cognito-idp:GetGroup"],
    resources: [
      `arn:aws:cognito-idp:${stack.region}:${stack.account}:userpool/*`,
    ],
  })
);

backend.projectRename.addEnvironment("PROJECT_TABLE_NAME", projectTable.tableName);

/* ------------------------------------------------------------------------ *
 * documentStore.
 *
 * Source documents held beside a product's model. Two mutations share the
 * function, which is safe only because their arguments differ — see its
 * handler.
 * ------------------------------------------------------------------------ */

const documentTable = backend.data.resources.tables["Document"];
const documentLambda = backend.documentStore.resources.lambda;

// Read-only on Project, exactly like modelStorageProxy: it decides whether a
// caller may touch a product's documents and never edits the product itself.
documentLambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["dynamodb:GetItem"],
    resources: [projectTable.tableArn],
  })
);

documentLambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["dynamodb:GetItem", "dynamodb:PutItem"],
    resources: [documentTable.tableArn],
  })
);

// Scoped to the documents/ sub-prefix, so this function cannot read or write a
// product's model even though both live under projects/.
documentLambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["s3:GetObject", "s3:PutObject"],
    resources: [`${bucket.bucketArn}/projects/*/documents/*`],
  })
);

backend.documentStore.addEnvironment("PROJECT_TABLE_NAME", projectTable.tableName);
backend.documentStore.addEnvironment("DOCUMENT_TABLE_NAME", documentTable.tableName);
backend.documentStore.addEnvironment("MODEL_BUCKET_NAME", bucket.bucketName);

/* ------------------------------------------------------------------------ *
 * documentDelete.
 *
 * Deliberately the mirror image of documentStore's grants: this one may
 * delete and not write, that one may write and not delete. Neither can do the
 * other's job, whatever happens inside it.
 * ------------------------------------------------------------------------ */

const documentDeleteLambda = backend.documentDelete.resources.lambda;

documentDeleteLambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["dynamodb:GetItem"],
    resources: [projectTable.tableArn],
  })
);

documentDeleteLambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["dynamodb:GetItem", "dynamodb:DeleteItem"],
    resources: [documentTable.tableArn],
  })
);

documentDeleteLambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["s3:DeleteObject"],
    resources: [`${bucket.bucketArn}/projects/*/documents/*`],
  })
);

backend.documentDelete.addEnvironment("PROJECT_TABLE_NAME", projectTable.tableName);
backend.documentDelete.addEnvironment("DOCUMENT_TABLE_NAME", documentTable.tableName);
backend.documentDelete.addEnvironment("MODEL_BUCKET_NAME", bucket.bucketName);

/* ------------------------------------------------------------------------ *
 * API keys (ADR-0012).
 *
 * The key table is a plain CDK table, not an `a.model`. A model would expose
 * generated CRUD over a row holding a key hash, and it would put an edge from
 * the auth stack to the data stack — the CloudFormation cycle of ADR-0006,
 * since the challenge triggers need the same table.
 * ------------------------------------------------------------------------ */

const apiKeyTable = new Table(backend.createStack("apiKeys"), "ApiKeyTable", {
  partitionKey: { name: "keyId", type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  // An expired key stops working the moment it expires, checked in the
  // verifier. The TTL is a month later and exists so it also stops EXISTING,
  // rather than accumulating hashes nobody will ever look at again.
  timeToLiveAttribute: "ttl",
  removalPolicy: RemovalPolicy.RETAIN,
  pointInTimeRecovery: true,
});

apiKeyTable.addGlobalSecondaryIndex({
  indexName: "byOwner",
  partitionKey: { name: "ownerSub", type: AttributeType.STRING },
  sortKey: { name: "createdAt", type: AttributeType.STRING },
});

// The verifier reads a key and stamps lastUsedAt. It cannot create or delete
// one: minting is a signed-in act and revoking is an explicit one.
const verifier = backend.verifyAuthChallengeResponse.resources.lambda;
verifier.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["dynamodb:GetItem", "dynamodb:UpdateItem"],
    resources: [apiKeyTable.tableArn],
  })
);
backend.verifyAuthChallengeResponse.addEnvironment(
  "API_KEY_TABLE_NAME",
  apiKeyTable.tableName
);

const keyAdminLambda = backend.apiKeyAdmin.resources.lambda;
keyAdminLambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:Query",
    ],
    resources: [apiKeyTable.tableArn, `${apiKeyTable.tableArn}/index/byOwner`],
  })
);
backend.apiKeyAdmin.addEnvironment("API_KEY_TABLE_NAME", apiKeyTable.tableName);

/*
 * Two app clients, one per scope.
 *
 * The scope has to reach the Lambdas in something the caller cannot forge, and
 * the app client id is exactly that: Cognito puts it in the token as
 * `client_id`, and it is the client the caller authenticated against rather
 * than anything they supplied. A key's own scope is checked against the client
 * being used, so a read-only key simply fails on the write client.
 *
 * Both allow CUSTOM_AUTH and nothing else. Neither can be used with a
 * password, so a leaked client id grants nothing on its own.
 */
const userPool = backend.auth.resources.userPool;

const apiKeyClientRead = new CfnUserPoolClient(
  Stack.of(userPool),
  "ApiKeyClientRead",
  {
    userPoolId: userPool.userPoolId,
    clientName: "blueprinting-api-key-read",
    explicitAuthFlows: ["ALLOW_CUSTOM_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"],
    generateSecret: false,
    accessTokenValidity: 60,
    idTokenValidity: 60,
    refreshTokenValidity: 1,
    tokenValidityUnits: {
      accessToken: "minutes",
      idToken: "minutes",
      refreshToken: "days",
    },
    preventUserExistenceErrors: "ENABLED",
  }
);

const apiKeyClientWrite = new CfnUserPoolClient(
  Stack.of(userPool),
  "ApiKeyClientWrite",
  {
    userPoolId: userPool.userPoolId,
    clientName: "blueprinting-api-key-write",
    explicitAuthFlows: ["ALLOW_CUSTOM_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"],
    generateSecret: false,
    accessTokenValidity: 60,
    idTokenValidity: 60,
    refreshTokenValidity: 1,
    tokenValidityUnits: {
      accessToken: "minutes",
      idToken: "minutes",
      refreshToken: "days",
    },
    preventUserExistenceErrors: "ENABLED",
  }
);

/*
 * The client ids are NOT passed to the functions.
 *
 * Doing that closed a CloudFormation cycle: the clients live in the auth
 * stack, auth already references the trigger functions, and an env var
 * pointing back at a client made the two stacks depend on each other. This is
 * ADR-0006 again, and it cost a deploy to rediscover.
 *
 * So preTokenGeneration resolves them at runtime by name — it has the pool id
 * in its event — and writes the decision into the token as `bp:scope`. Every
 * other function then reads one claim and needs no client id, no lookup and no
 * reference to anything in the auth stack.
 */
for (const fn of [backend.preTokenGeneration, backend.verifyAuthChallengeResponse])
  fn.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["cognito-idp:ListUserPoolClients"],
    // Wildcarded for the same reason as projectAdmin's grant: naming the pool
    // would point the function stack back at the auth stack.
    resources: [
      `arn:aws:cognito-idp:${Stack.of(backend.preTokenGeneration.resources.lambda).region}:${Stack.of(backend.preTokenGeneration.resources.lambda).account}:userpool/*`,
    ],
  })
);

/*
 * preTokenGeneration must run as V2.
 *
 * V1 rewrites the ID token only, and AppSync accepts either token — verified —
 * so a V1 group override would be bypassed by any client that sent the access
 * token instead. defineAuth wires V1, so the version is set here.
 */
cfnUserPool.addPropertyOverride("LambdaConfig.PreTokenGenerationConfig", {
  LambdaArn: backend.preTokenGeneration.resources.lambda.functionArn,
  LambdaVersion: "V2_0",
});

backend.addOutput({
  custom: {
    apiKeyClientReadId: apiKeyClientRead.ref,
    apiKeyClientWriteId: apiKeyClientWrite.ref,
  },
});

export default backend;