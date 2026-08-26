import * as React from "react";
import { toOrganisations } from "@dlab5/blueprint-core";
import type { AbModel } from "@dlab5/blueprint-core";
import { LAYER_LABELS, LAYER_ORDER } from "@dlab5/archimate-metamodel";

/**
 * The model by the team that owns it.
 *
 * Every other screen groups by something the ArchiMate specification defines —
 * layer, adoption ring, schedule. This one groups by `owner`, which is an
 * overlay property, and it is the view that answers a question the others
 * cannot: who is carrying which part of this, and how much debt does each of
 * them hold.
 *
 * Owner is deliberately a team name and not a person. People move, and an
 * element carrying a former colleague's name is worse than one carrying none.
 * A mature model draws its organisation properly, as BusinessRole elements
 * with assignment relationships; this is the pragmatic form for one that has
 * not yet.
 */

const debtToken = (debt: number) =>
  debt < 0.34
    ? "var(--bp-success)"
    : debt < 0.67
      ? "var(--bp-warning)"
      : "var(--bp-danger)";

export function Organisations({ model }: { model: AbModel }) {
  const { organisations, unowned } = React.useMemo(
    () => toOrganisations(model, LAYER_ORDER),
    [model]
  );

  if (organisations.length === 0) {
    return (
      <div className="bp-empty">
        <p>No element records an owner.</p>
        <p className="bp-muted">
          Give an element an <code>owner</code> property — a team name, not a
          person — and it appears here. The property is declared in the overlay
          ontology, so it is offered by the editor, the Blockly palette and the
          MCP server alike.
        </p>
      </div>
    );
  }

  return (
    <div className="bp-orgs">
      <p className="bp-lede">
        {organisations.length} team{organisations.length === 1 ? "" : "s"} across{" "}
        {model.elements.length - unowned} of {model.elements.length} elements.
        {unowned > 0 && (
          <>
            {" "}
            <span className="bp-muted">{unowned} record no owner.</span>
          </>
        )}
      </p>

      <ul className="bp-orgs__list">
        {organisations.map((org) => (
          <li key={org.name} className="bp-orgs__card">
            <span className="bp-orgs__avatar" aria-hidden="true">
              {org.initials}
            </span>

            <div className="bp-orgs__body">
              <h2 className="bp-orgs__name">{org.name}</h2>
              <p className="bp-orgs__count">
                {org.elementCount} element{org.elementCount === 1 ? "" : "s"}
              </p>

              <ul className="bp-orgs__layers">
                {org.layers.map((layer) => (
                  <li key={layer}>
                    <span
                      className="bp-layer__swatch"
                      style={{ background: `var(--bp-layer-${layer})` }}
                      aria-hidden="true"
                    />
                    {LAYER_LABELS[layer]}
                  </li>
                ))}
              </ul>
            </div>

            <div className="bp-orgs__debt">
              {org.meanDebt === null ? (
                <span className="bp-muted">not assessed</span>
              ) : (
                <>
                  <span
                    className="bp-orgs__debtvalue"
                    style={{ color: debtToken(org.meanDebt) }}
                  >
                    {org.meanDebt.toFixed(2)}
                  </span>
                  <span className="bp-orgs__debtlabel">mean debt</span>
                  <span
                    className="bp-orgs__debtbar"
                    role="img"
                    aria-label={`Mean technical debt ${org.meanDebt.toFixed(2)} of 1`}
                  >
                    <span
                      style={{
                        width: `${Math.max(4, org.meanDebt * 100)}%`,
                        background: debtToken(org.meanDebt),
                      }}
                    />
                  </span>
                  {org.unassessed > 0 && (
                    <span className="bp-orgs__caveat">
                      over {org.elementCount - org.unassessed} of {org.elementCount}
                    </span>
                  )}
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
