import { ELEMENTS } from "@dlab5/archimate-metamodel";
import type { ElementTypeId, LayerId } from "@dlab5/archimate-metamodel";
import type { AbModel } from "./types.js";

/**
 * The model summarised by the team that owns it.
 *
 * This lives beside toRadar rather than in the site because it is a reading of
 * the model, not a rendering of it: the rules about what counts as owned and
 * how debt averages are semantic decisions, they need testing, and the MCP
 * server has as much reason to answer "who owns what" as the browser does.
 *
 * `owner` and `debt` are overlay properties, not ArchiMate. The language
 * describes what an architecture is; both of these are facts about how an
 * organisation currently runs it.
 */

export interface Organisation {
  /** The owner string exactly as the model records it. */
  name: string;
  /** Up to two letters, for an avatar. */
  initials: string;
  elementCount: number;
  /**
   * Mean debt over the elements that declare it, or null if none do.
   *
   * Averaged over the elements that carry a debt value rather than over all of
   * the team's elements. Treating an unassessed element as zero would let a
   * team improve its score by assessing less, which is exactly backwards.
   */
  meanDebt: number | null;
  /** Elements with no debt value. The average says nothing about these. */
  unassessed: number;
  /** Layers this team has elements in, in specification order. */
  layers: LayerId[];
}

export interface OrganisationSummary {
  organisations: Organisation[];
  /** Elements recording no owner at all. */
  unowned: number;
}

/** At most two letters, from the first two words. */
export function initialsOf(name: string): string {
  const words = name.split(/[\s._-]+/).filter(Boolean).slice(0, 2);
  return words.map((word) => word[0]!.toUpperCase()).join("") || "?";
}

export function toOrganisations(
  model: AbModel,
  layerOrder: readonly LayerId[]
): OrganisationSummary {
  const map = new Map<
    string,
    { count: number; debtTotal: number; debtCount: number; layers: Set<LayerId> }
  >();
  let unowned = 0;

  for (const element of model.elements) {
    const owner = element.properties.owner?.trim();
    if (!owner) {
      unowned++;
      continue;
    }

    let entry = map.get(owner);
    if (!entry) {
      entry = { count: 0, debtTotal: 0, debtCount: 0, layers: new Set() };
      map.set(owner, entry);
    }
    entry.count++;
    entry.layers.add(ELEMENTS[element.type as ElementTypeId].layer);

    const raw = element.properties.debt;
    if (raw !== undefined) {
      const debt = Number(raw);
      // A malformed value counts as unassessed rather than as zero. Zero means
      // clean, and claiming that about an element nobody could parse is worse
      // than admitting the gap.
      if (Number.isFinite(debt)) {
        entry.debtTotal += Math.min(1, Math.max(0, debt));
        entry.debtCount++;
      }
    }
  }

  const organisations = [...map]
    .map(([name, entry]) => ({
      name,
      initials: initialsOf(name),
      elementCount: entry.count,
      meanDebt: entry.debtCount > 0 ? entry.debtTotal / entry.debtCount : null,
      unassessed: entry.count - entry.debtCount,
      layers: layerOrder.filter((layer) => entry.layers.has(layer)),
    }))
    // Biggest first, then alphabetically, so the order is stable and does not
    // depend on the order elements happen to appear in the Turtle.
    .sort((a, b) => b.elementCount - a.elementCount || a.name.localeCompare(b.name));

  return { organisations, unowned };
}
