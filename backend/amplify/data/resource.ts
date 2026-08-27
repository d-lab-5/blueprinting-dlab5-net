import { type ClientSchema, a, defineData } from "@aws-amplify/backend";
import { modelStorageProxy } from "../functions/modelStorageProxy/resource";
import { projectAdmin } from "../functions/projectAdmin/resource";

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

  /**
   * A generated view of some slice of a project's model.
   *
   * Views are metadata, not graph: the script itself lives in S3 under
   * `projects/<slug>/views/`, and `selection` records which elements the view
   * covers so it can be regenerated when the model changes.
   */
  View: a
    .model({
      projectSlug: a.string().required(),
      name: a.string().required(),
      /** ArchiMate layer this view renders, e.g. "implementation". */
      layer: a.string().required(),
      engine: a.enum(["mermaid", "d2"]),
      /** S3 key of the generated .mmd / .d2 script. */
      scriptKey: a.string(),
      /** Element ids and layout hints. Shape is engine-specific. */
      selection: a.json(),
      /** Copied from the project so group authorization applies here too. */
      group: a.string().required(),
    })
    .secondaryIndexes((index) => [index("projectSlug")])
    .authorization((allow) => [
      allow.group("bp-admins"),
      allow.groupDefinedIn("group"),
    ]),

  /** What modelStorageProxy hands back for both reads and writes. */
  ModelAccess: a.customType({
    /** Pre-signed GET. Absent on writes and when no model exists yet. */
    url: a.string(),
    /** Current ETag — the token a subsequent write must present. */
    etag: a.string(),
    exists: a.boolean().required(),
    key: a.string().required(),
  }),

  /**
   * Hands back a short-lived pre-signed GET for the project's abox.ttl.
   *
   * `allow.authenticated()` is not the access check. The real check is inside
   * the function, which compares the caller's Cognito groups against the
   * project's own group — see ADR-0003 for why it cannot live in
   * defineStorage.
   */
  requestModelReadUrl: a
    .mutation()
    .arguments({ projectSlug: a.string().required() })
    .returns(a.ref("ModelAccess"))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(modelStorageProxy)),

  /**
   * Writes the project's abox.ttl under an S3 precondition.
   *
   * The write goes through the function rather than a pre-signed PUT so the
   * precondition cannot be dropped or altered by the caller. Pass the `etag`
   * from the read; pass `expectAbsent` for a project's first ever save.
   * Unconditional writes are refused.
   */
  /** What provisionProject returns. Not the Project model — this is a Lambda. */
  CreatedProject: a.customType({
    slug: a.string().required(),
    name: a.string().required(),
    description: a.string(),
    group: a.string().required(),
    ttlKey: a.string().required(),
  }),

  /**
   * Creates a project row AND its Cognito group, together.
   *
   * Named `provisionProject`, not `createProject`: `a.model("Project")` already
   * generates a `createProject` mutation, and redeclaring it fails the CDK
   * assembly with "Object type extension 'Mutation' cannot redeclare field".
   * The generated one still exists and writes a bare row — this is the one to
   * call, because a row without its group is a project nobody can open.
   *
   * `allow.authenticated()` is not the access check — the bp-admins check is
   * inside the function, alongside the Cognito calls that need admin
   * permissions the browser must never hold. A project row without its group
   * is a project nobody but an administrator can open, so the two are created
   * in one place or not at all.
   */
  provisionProject: a
    .mutation()
    .arguments({
      slug: a.string().required(),
      name: a.string().required(),
      description: a.string(),
    })
    .returns(a.ref("CreatedProject"))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(projectAdmin)),

  /**
   * Renames a product, and keeps its Cognito group description in step.
   *
   * The generated `updateProject` can change these same two fields, and is
   * still there. This exists because the group's description is the only thing
   * in the Cognito console that says which product an opaque `bp-p-…` group
   * belongs to (ADR-0009), and updating it needs permissions the browser must
   * never hold.
   *
   * The id is not an argument. It is the partition key; re-identifying a
   * product is an export and a reload (ADR-0010), not an update.
   */
  renameProject: a
    .mutation()
    .arguments({
      slug: a.string().required(),
      name: a.string().required(),
      description: a.string(),
    })
    .returns(a.ref("CreatedProject"))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(projectAdmin)),

  saveModel: a
    .mutation()
    .arguments({
      projectSlug: a.string().required(),
      turtle: a.string().required(),
      etag: a.string(),
      expectAbsent: a.boolean(),
    })
    .returns(a.ref("ModelAccess"))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.function(modelStorageProxy)),
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
