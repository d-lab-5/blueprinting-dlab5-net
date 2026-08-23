import { type ClientSchema, a, defineData } from "@aws-amplify/backend";

/**
 * DynamoDB holds *metadata and structural references only*. The ArchiMate ABox
 * itself is a Turtle graph in S3 at `projects/<slug>/abox.ttl`, which is the
 * source of truth — see docs/adr/0003-turtle-in-s3-as-source-of-truth.md.
 *
 * That split is why `ttlKey`, `version` and the lock fields live on Project:
 * they are the coordination record for a file this API does not itself store.
 */
const schema = a.schema({
  /**
   * A blueprint project (a "product", in the spec's terms).
   *
   * `group` names the Cognito group that may read the project and its model,
   * conventionally `bp-<slug>`. The group is created by hand in the Cognito
   * console; nothing here creates it, so a Project row pointing at a
   * non-existent group is simply a project nobody but bp-admins can open.
   *
   * Members get read on the metadata row only. They edit the *model*, which
   * lives in S3 behind modelStorageProxy — not these fields. Creating and
   * renaming projects is an administrative act because it has to be paired
   * with a Cognito group anyway.
   */
  Project: a
    .model({
      slug: a.id().required(),
      name: a.string().required(),
      description: a.string(),
      group: a.string().required(),

      /** S3 key of the ABox, normally `projects/<slug>/abox.ttl`. */
      ttlKey: a.string().required(),

      /**
       * Monotonic counter bumped on every successful model write. Advisory
       * only — correctness comes from the S3 ETag precondition in
       * modelStorageProxy. This exists so the UI can say "you are 3 revisions
       * behind" without fetching the graph.
       */
      version: a.integer().default(0),

      /**
       * Advisory edit lock, ported from the DHC Designer pattern. Considered
       * stale after 30 minutes so a crashed browser cannot park a project
       * forever. It improves the UX of concurrent editing; it does not enforce
       * it.
       */
      lockedBy: a.string(),
      lockedAt: a.datetime(),
    })
    .identifier(["slug"])
    .authorization((allow) => [
      allow.group("bp-admins"),
      allow.groupDefinedIn("group").to(["read"]),
    ]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    // No guest, no API key: the spec puts the whole platform behind Cognito
    // and the landing page is the sign-in page.
    defaultAuthorizationMode: "userPool",
  },
});
