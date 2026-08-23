import { defineBackend } from "@aws-amplify/backend";
import { auth } from "./auth/resource";
import { data } from "./data/resource";
import { storage } from "./storage/resource";

const backend = defineBackend({
  auth,
  data,
  storage,
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

backend.data.resources.cfnResources.amplifyDynamoDbTables[
  "Project"
].pointInTimeRecoveryEnabled = true;

export default backend;
