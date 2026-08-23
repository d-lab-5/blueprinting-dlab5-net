import { defineStorage } from "@aws-amplify/backend";

/**
 * Object storage for the ArchiMate models and everything derived from them.
 *
 *   projects/<slug>/abox.ttl        the ABox — SOURCE OF TRUTH
 *   projects/<slug>/views/*         generated .mmd / .d2 scripts
 *   exports/<slug>/*                Open Exchange XML and Turtle exports
 *   assets/*                        branding and icon sets
 *
 * The access rules below are coarse on purpose. `defineStorage` rules are
 * baked in at deploy time, so they cannot express "the caller is in group
 * bp-<slug>" for a project group that will be created by hand next month.
 * Per-project authorization therefore lives in the modelStorageProxy function,
 * which checks the caller's `cognito:groups` against Project.group and hands
 * back a short-lived pre-signed URL. The browser never talks to S3 directly.
 *
 * These rules exist only so that the bucket is not world-open and so that
 * bp-admins retain a console-free escape hatch; they are not the security
 * boundary for project data.
 */
export const storage = defineStorage({
  name: "blueprintingStorage",
  access: (allow) => ({
    "projects/*": [allow.groups(["bp-admins"]).to(["read", "write", "delete"])],
    "exports/*": [allow.groups(["bp-admins"]).to(["read", "write", "delete"])],
    "assets/*": [
      allow.groups(["bp-admins"]).to(["read", "write", "delete"]),
      allow.authenticated.to(["read"]),
    ],
  }),
});
