import * as React from "react";
import type { Project } from "../lib/data";
import { getProject } from "../lib/data";

export interface UseProject {
  project: Project | null;
  loading: boolean;
  /** Applied after a rename, so the page renames itself without a reload. */
  setProject: (project: Project) => void;
}

/**
 * One product's metadata row, for the lifetime of a page.
 *
 * Separate from `useModel` because the two fail independently and mean
 * different things. A missing row means the product does not exist or is not
 * yours; a missing model means the product exists but has no blueprint yet,
 * which is the normal state of a product on the day it is created.
 *
 * There is deliberately no error field. Nothing a page can do about a failed
 * metadata read is worth an alert, and the caller falls back to the id — which
 * under ADR-0009 is opaque and ugly, but never wrong.
 */
export function useProject(slug: string): UseProject {
  const [project, setProject] = React.useState<Project | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    if (!slug) {
      setProject(null);
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    getProject(slug)
      .then((p) => live && setProject(p))
      .catch(() => live && setProject(null))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [slug]);

  return { project, loading, setProject };
}
