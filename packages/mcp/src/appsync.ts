import type { BackendClient, BpDocument, Project } from "./data.js";

/**
 * The same calls the Amplify client makes, as plain GraphQL over fetch, with
 * one caller's token on every request.
 *
 * The hosted server serves many keys from one process, and Amplify keeps its
 * session in process-wide state: two keys would share whichever token was
 * stored last. A client that is handed its token and sends nothing else has
 * no state to leak. The operations are the ones data.ts uses, written by hand
 * against data/resource.ts, as everything else in this repository that talks
 * to the API is (ADR-0001, CLAUDE.md constraint 13).
 */

interface Gql<T> {
  data?: T | null;
  errors?: Array<{ message: string }>;
}

const DOCUMENT_ACCESS = "docId key url exists classification";
const MODEL_ACCESS = "url etag exists key";

export function createAppSyncClient(url: string, token: string): BackendClient {
  async function gql<T>(query: string, variables: Record<string, unknown>): Promise<Gql<T>> {
    const response = await fetch(url, {
      method: "POST",
      // A user-pool JWT goes in bare, without "Bearer": that is what AppSync's
      // AMAZON_COGNITO_USER_POOLS mode expects.
      headers: { "content-type": "application/json", authorization: token },
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok && response.status !== 400) {
      return { errors: [{ message: `the API answered ${response.status}` }] };
    }
    return (await response.json()) as Gql<T>;
  }

  /** Follows nextToken, so a long list is never silently cut at one page. */
  async function listAll<T>(
    field: string,
    selection: string,
    filter?: Record<string, unknown>
  ): Promise<{ data?: T[]; errors?: Array<{ message: string }> }> {
    const items: T[] = [];
    let nextToken: string | null = null;
    do {
      const result: Gql<Record<string, { items: T[]; nextToken: string | null }>> = await gql(
        `query ($filter: Model${field === "listProjects" ? "Project" : "Document"}FilterInput, $nextToken: String) {
          ${field}(filter: $filter, nextToken: $nextToken, limit: 1000) { items { ${selection} } nextToken }
        }`,
        { filter, nextToken }
      );
      if (result.errors?.length) return { errors: result.errors };
      const page = result.data?.[field];
      items.push(...(page?.items ?? []));
      nextToken = page?.nextToken ?? null;
    } while (nextToken);
    return { data: items };
  }

  const single = async <T>(field: string, query: string, variables: Record<string, unknown>) => {
    const result = await gql<Record<string, T>>(query, variables);
    return { data: result.data?.[field], errors: result.errors };
  };

  return {
    models: {
      Project: {
        list: () => listAll<Project>("listProjects", "slug name description group"),
      },
      Document: {
        list: (args) =>
          listAll<BpDocument>(
            "listDocuments",
            "docId projectSlug title classification annotatedKey bytes uploadedAt",
            args?.filter
          ),
      },
    },
    mutations: {
      saveDocument: (args) =>
        single(
          "saveDocument",
          `mutation ($projectSlug: String!, $docId: String!, $markdown: String!, $title: String, $classification: String, $kind: String) {
            saveDocument(projectSlug: $projectSlug, docId: $docId, markdown: $markdown, title: $title, classification: $classification, kind: $kind) { ${DOCUMENT_ACCESS} }
          }`,
          args
        ),
      requestDocumentReadUrl: (args) =>
        single(
          "requestDocumentReadUrl",
          `mutation ($projectSlug: String!, $docId: String!, $kind: String) {
            requestDocumentReadUrl(projectSlug: $projectSlug, docId: $docId, kind: $kind) { ${DOCUMENT_ACCESS} }
          }`,
          args
        ),
      requestModelReadUrl: (args) =>
        single(
          "requestModelReadUrl",
          `mutation ($projectSlug: String!) {
            requestModelReadUrl(projectSlug: $projectSlug) { ${MODEL_ACCESS} }
          }`,
          args
        ),
      saveModel: (args) =>
        single(
          "saveModel",
          `mutation ($projectSlug: String!, $turtle: String!, $etag: String, $expectAbsent: Boolean) {
            saveModel(projectSlug: $projectSlug, turtle: $turtle, etag: $etag, expectAbsent: $expectAbsent) { ${MODEL_ACCESS} }
          }`,
          args
        ),
    },
  };
}
