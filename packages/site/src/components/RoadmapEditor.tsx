import * as React from "react";
import {
  CONVENTIONS,
  ELEMENTS,
  allowedRelationships,
  conventionsFor,
  elementsByLayer,
  isDerived,
} from "@dlab5/archimate-metamodel";
import type { ElementTypeId, RelationshipTypeId } from "@dlab5/archimate-metamodel";
import type { AbElement, AbModel } from "@dlab5/blueprint-core";
import { derivePlateauDates, uniqueId } from "@dlab5/blueprint-core";

/**
 * Editing for the Implementation & Migration layer.
 *
 * Every choice offered here is derived from the generated metamodel rather
 * than hard-coded: the element types come from elementsByLayer, and the
 * relationship types come from allowedRelationships for the exact pair of
 * endpoints chosen. An illegal relationship is therefore not something the UI
 * rejects after the fact — it is not in the list. Validation still runs on
 * save, because a model can also be edited by the MCP server, by Archi, or by
 * hand.
 */

const LAYER = "implementation" as const;

/** The statuses the Gantt understands. Anything else renders as an untagged bar. */
/**
 * Status values come from the overlay's sh:in list, not from a copy here.
 * The ontology is where the permitted set is declared; a second list in a form
 * component is a second answer waiting to disagree with the first.
 */
const STATUSES: readonly string[] = ["", ...(CONVENTIONS.status.values ?? [])];

interface Props {
  model: AbModel;
  onChange: (next: AbModel) => void;
}

export function RoadmapEditor({ model, onChange }: Props) {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const layerTypes = React.useMemo(() => elementsByLayer(LAYER), []);
  const layerElements = model.elements.filter(
    (e) => ELEMENTS[e.type].layer === LAYER
  );
  const selected = layerElements.find((e) => e.id === selectedId) ?? null;

  // Which conventions this element type actually carries. Declared in the
  // overlay ontology beside each term, so the editor, the Blockly palette and
  // the MCP server all get the same answer from one place.
  const applicable = React.useMemo(
    () =>
      new Set(
        selected ? conventionsFor(selected.type).map((c) => c.propertyKey) : []
      ),
    [selected]
  );

  // A plateau stores no date; it is reached when the work realising it
  // finishes. Computed for every plateau at once rather than per selection,
  // because the model is already in memory and the map is cheap.
  const plateauDates = React.useMemo(() => derivePlateauDates(model), [model]);
  const derived =
    selected?.type === "Plateau" ? plateauDates.get(selected.id) : undefined;

  const setElement = (id: string, patch: Partial<AbElement>) => {
    onChange({
      ...model,
      elements: model.elements.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    });
  };

  const setProperty = (id: string, key: string, value: string) => {
    const element = model.elements.find((e) => e.id === id);
    if (!element) return;
    const properties = { ...element.properties };
    if (value) properties[key] = value;
    else delete properties[key];
    setElement(id, { properties });
  };

  const addElement = (type: ElementTypeId) => {
    const name = `New ${ELEMENTS[type].label}`;
    const id = uniqueId(name, model.elements.map((e) => e.id));
    onChange({
      ...model,
      elements: [...model.elements, { id, type, name, properties: {} }],
    });
    setSelectedId(id);
  };

  const removeElement = (id: string) => {
    onChange({
      ...model,
      elements: model.elements.filter((e) => e.id !== id),
      // Relationships to a removed element would dangle, which validation
      // reports as an error and the writer silently drops. Removing them here
      // keeps the model coherent at every step rather than only after a save.
      relationships: model.relationships.filter(
        (r) => r.source !== id && r.target !== id
      ),
    });
    if (selectedId === id) setSelectedId(null);
  };

  return (
    <div className="bp-editor">
      <div className="bp-editor__list">
        <div className="bp-editor__add">
          {layerTypes.map((t) => (
            <button
              key={t.id}
              type="button"
              className="bp-linkbutton"
              onClick={() => addElement(t.id as ElementTypeId)}
              title={t.comment}
            >
              + {t.label}
            </button>
          ))}
        </div>

        <ul className="bp-editor__elements">
          {layerElements.map((el) => (
            <li key={el.id}>
              <button
                type="button"
                className={`bp-editor__item${
                  el.id === selectedId ? " bp-editor__item--selected" : ""
                }`}
                onClick={() => setSelectedId(el.id)}
              >
                <span className="bp-editor__item-type">
                  {ELEMENTS[el.type].label}
                </span>
                <span>{el.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="bp-editor__detail">
        {!selected && (
          <p className="bp-muted">
            Select an element to edit it, or add one above.
          </p>
        )}

        {selected && (
          <>
            <label className="bp-field">
              <span>Name</span>
              <input
                value={selected.name}
                onChange={(e) => setElement(selected.id, { name: e.target.value })}
              />
            </label>

            <label className="bp-field">
              <span>Documentation</span>
              <textarea
                rows={3}
                value={selected.documentation ?? ""}
                onChange={(e) =>
                  setElement(selected.id, {
                    documentation: e.target.value || undefined,
                  })
                }
              />
            </label>

            <div className="bp-field-row">
              {applicable.has("startDate") && (
                <label className="bp-field">
                  <span>Start date</span>
                  <input
                    type="date"
                    value={selected.properties.startDate ?? ""}
                    onChange={(e) =>
                      setProperty(selected.id, "startDate", e.target.value)
                    }
                  />
                </label>
              )}
              {applicable.has("endDate") && (
                <label className="bp-field">
                  <span>End date</span>
                  <input
                    type="date"
                    value={selected.properties.endDate ?? ""}
                    onChange={(e) =>
                      setProperty(selected.id, "endDate", e.target.value)
                    }
                  />
                </label>
              )}
              {applicable.has("cost") && (
                <label className="bp-field">
                  <span>Cost</span>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={selected.properties.cost ?? ""}
                    onChange={(e) =>
                      setProperty(selected.id, "cost", e.target.value)
                    }
                  />
                </label>
              )}
              {applicable.has("status") && (
                <label className="bp-field">
                  <span>Status</span>
                  <select
                    value={selected.properties.status ?? ""}
                    onChange={(e) =>
                      setProperty(selected.id, "status", e.target.value)
                    }
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s || "—"}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            {selected.type === "Plateau" && (
              <div className="bp-field bp-field--derived">
                <span>Reached</span>
                {derived && derived.from > 0 ? (
                  <p className="bp-derived">
                    <strong>{derived.end}</strong>
                    <span className="bp-muted">
                      {" "}
                      · from {derived.from} work package
                      {derived.from === 1 ? "" : "s"}
                      {derived.start && derived.start !== derived.end
                        ? `, starting ${derived.start}`
                        : ""}
                    </span>
                  </p>
                ) : (
                  <p className="bp-muted bp-derived">
                    {derived && derived.realisedBy > 0
                      ? `Not yet scheduled — ${derived.realisedBy} work package${
                          derived.realisedBy === 1 ? "" : "s"
                        } realise${derived.realisedBy === 1 ? "s" : ""} this plateau, none of them dated.`
                      : "Nothing realises this plateau yet, so there is no date to derive. This is how a starting state looks."}
                  </p>
                )}
              </div>
            )}

            <p className="bp-muted bp-editor__hint">
              These are ArchiMate Properties, which is what round-trips into
              Archi; ArchiMate has no native schedule fields. Which of them a
              type carries is declared in the overlay ontology, not here — an
              Implementation Event is a moment and so has no end date, and a
              Plateau is a state reached when the work realising it finishes,
              so its date is derived rather than typed.
            </p>

            <RelationshipEditor
              model={model}
              element={selected}
              onChange={onChange}
              onSelect={setSelectedId}
            />

            <button
              type="button"
              className="bp-linkbutton bp-linkbutton--danger"
              onClick={() => removeElement(selected.id)}
            >
              Delete {ELEMENTS[selected.type].label}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function RelationshipEditor({
  model,
  element,
  onChange,
  onSelect,
}: {
  model: AbModel;
  element: AbElement;
  onChange: (next: AbModel) => void;
  /** Jump to another element — an incoming relationship is edited at its source. */
  onSelect: (id: string) => void;
}) {
  const [targetId, setTargetId] = React.useState("");

  const outgoing = model.relationships.filter((r) => r.source === element.id);
  const incoming = model.relationships.filter((r) => r.target === element.id);

  // Only elements this one can legally connect to at all. Everything else
  // would only be offered so it could be refused.
  const candidates = model.elements.filter(
    (other) =>
      other.id !== element.id &&
      allowedRelationships(element.type, other.type).length > 0
  );

  const target = model.elements.find((e) => e.id === targetId);
  const options: RelationshipTypeId[] = target
    ? allowedRelationships(element.type, target.type)
    : [];

  const add = (type: RelationshipTypeId) => {
    if (!target) return;
    const id = uniqueId(
      `${element.id}-${type}-${target.id}`,
      model.relationships.map((r) => r.id)
    );
    onChange({
      ...model,
      relationships: [
        ...model.relationships,
        { id, type, source: element.id, target: target.id, properties: {} },
      ],
    });
    setTargetId("");
  };

  const remove = (id: string) => {
    onChange({
      ...model,
      relationships: model.relationships.filter((r) => r.id !== id),
    });
  };

  return (
    <div className="bp-rels">
      <h3>Outgoing relationships</h3>

      {outgoing.length === 0 && <p className="bp-muted">None.</p>}

      <ul>
        {outgoing.map((rel) => {
          const to = model.elements.find((e) => e.id === rel.target);
          return (
            <li key={rel.id}>
              <span className="bp-rels__type">{rel.type}</span>
              <span>{to ? to.name : `? ${rel.target}`}</span>
              <button
                type="button"
                className="bp-linkbutton"
                onClick={() => remove(rel.id)}
                aria-label={`Remove ${rel.type} to ${to?.name ?? rel.target}`}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>

      <h3>Incoming relationships</h3>

      {/* Read-only, deliberately. An incoming relationship belongs to the
          element it starts from — that is where it was created and where its
          type was chosen against that element's own allowed set. Offering a
          delete here would let two screens remove the same thing, and it would
          not be obvious from this one which element had changed. Selecting the
          source is one click away. */}
      {incoming.length === 0 && <p className="bp-muted">None.</p>}

      <ul>
        {incoming.map((rel) => {
          const from = model.elements.find((e) => e.id === rel.source);
          return (
            <li key={rel.id}>
              <span className="bp-rels__type">{rel.type}</span>
              <span>{from ? from.name : `? ${rel.source}`}</span>
              {from && (
                <button
                  type="button"
                  className="bp-linkbutton"
                  onClick={() => onSelect(from.id)}
                  aria-label={`Go to ${from.name}`}
                >
                  edit
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <h3>Add a relationship</h3>

      <div className="bp-rels__add">
        <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
          <option value="">Connect to…</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({ELEMENTS[c.type].label})
            </option>
          ))}
        </select>

        {target && (
          <div className="bp-rels__types">
            {options.map((type) => (
              <button
                key={type}
                type="button"
                className="bp-linkbutton"
                onClick={() => add(type)}
                title={
                  isDerived(element.type, type, target.type)
                    ? "Derived: implied by a chain of other relationships"
                    : "Direct relationship"
                }
              >
                {type}
                {isDerived(element.type, type, target.type) && " ·"}
              </button>
            ))}
          </div>
        )}
      </div>
      {target && (
        <p className="bp-muted bp-editor__hint">
          Only relationships ArchiMate 3.2 permits between{" "}
          {ELEMENTS[element.type].label} and {ELEMENTS[target.type].label} are
          offered. A trailing · marks a derived one.
        </p>
      )}
    </div>
  );
}
