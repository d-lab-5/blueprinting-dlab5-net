import { ELEMENTS } from "@dlab5/archimate-metamodel";
import type { AbModel, AbElement } from "../types.js";

/**
 * Renders process flow as a Mermaid sequence diagram.
 *
 * This is the Layer 3 view the spec asks for — "human and AI agent process
 * workflows" — and it reads the graph completely differently from the
 * structural D2 view. A sequence diagram is about *behaviour over time*, so
 * only two things matter: who does something, and what happens next.
 *
 *   Participant   an active structure element — an actor, role, component,
 *                 node. Who the behaviour is assigned to.
 *   Message       a triggering or flow relationship between behaviours, drawn
 *                 between the participants those behaviours are assigned to.
 *
 * The assignment relationship is what connects the two, and it is why a
 * sequence diagram can be derived at all rather than drawn: ArchiMate already
 * records who performs each step.
 */

export interface SequenceOptions {
  title?: string;
  /**
   * Start from this element id, and draw ONLY what it reaches.
   *
   * Defaults to every behaviour with no predecessor, which draws everything.
   * A model that holds two unrelated flows — a roadmap and a runtime
   * sequence, say — is unreadable that way, and this is how one is isolated.
   */
  from?: string;
  emptyMessage?: string;
}

/** Mermaid sequence participants: no colons, semicolons or newlines. */
function label(text: string): string {
  return text.replace(/[:;#]/g, " ").replace(/\s+/g, " ").trim();
}

/** Participant aliases must be word characters. */
function alias(id: string): string {
  return `p_${id.replace(/[^A-Za-z0-9_]/g, "_")}`;
}

const isBehaviour = (el: AbElement) =>
  (ELEMENTS[el.type].aspect ?? "").includes("Behavior") ||
  (ELEMENTS[el.type].aspect ?? "").includes("Behaviour");

const isActiveStructure = (el: AbElement) =>
  (ELEMENTS[el.type].aspect ?? "").includes("ActiveStructure");

export function toMermaidSequence(
  model: AbModel,
  options: SequenceOptions = {}
): string {
  const {
    title = "Process flow",
    emptyMessage = "No process flow in this model yet.",
  } = options;

  const byId = new Map(model.elements.map((e) => [e.id, e]));

  // Who performs what. ArchiMate's assignment relationship goes from active
  // structure to behaviour, which is exactly the participant/message split a
  // sequence diagram needs.
  const performerOf = new Map<string, AbElement>();
  for (const rel of model.relationships) {
    if (rel.type !== "assignment") continue;
    const performer = byId.get(rel.source);
    const behaviour = byId.get(rel.target);
    if (!performer || !behaviour) continue;
    if (isActiveStructure(performer) && isBehaviour(behaviour)) {
      if (!performerOf.has(behaviour.id)) performerOf.set(behaviour.id, performer);
    }
  }

  // The steps: triggering and flow between two behaviours.
  const steps = model.relationships.filter((rel) => {
    if (rel.type !== "triggering" && rel.type !== "flow") return false;
    const from = byId.get(rel.source);
    const to = byId.get(rel.target);
    return Boolean(from && to && isBehaviour(from) && isBehaviour(to));
  });

  if (steps.length === 0) {
    return (
      `%% ${label(emptyMessage)}\n` +
      `sequenceDiagram\n` +
      `    autonumber\n` +
      `    participant None as ${label(emptyMessage)}\n`
    );
  }

  /* -- order the steps ---------------------------------------------------- */

  const successors = new Map<string, string[]>();
  const hasPredecessor = new Set<string>();
  for (const s of steps) {
    successors.set(s.source, [...(successors.get(s.source) ?? []), s.target]);
    hasPredecessor.add(s.target);
  }

  const roots = options.from
    ? [options.from]
    : [...new Set(steps.map((s) => s.source))].filter(
        (id) => !hasPredecessor.has(id)
      );

  // A depth-first walk, so a branch is followed to its end before the next is
  // started — which is how a reader follows a sequence diagram.
  const ordered: Array<{ from: string; to: string; type: string; name?: string }> = [];
  const seen = new Set<string>();
  const walk = (id: string) => {
    for (const step of steps.filter((s) => s.source === id)) {
      const key = `${step.source}->${step.target}:${step.type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ordered.push({
        from: step.source,
        to: step.target,
        type: step.type,
        name: step.name,
      });
      walk(step.target);
    }
  };
  for (const root of roots.length ? roots : [steps[0].source]) walk(root);

  // A cycle would leave steps unvisited, so anything unreached is appended
  // rather than silently dropped — but ONLY when no start was asked for.
  //
  // With `from`, unreached steps are not part of the flow the caller asked
  // about, and appending them made the option do nothing: a model holding two
  // unrelated flows drew both however it was called.
  if (!options.from) for (const step of steps) {
    const key = `${step.source}->${step.target}:${step.type}`;
    if (!seen.has(key)) {
      seen.add(key);
      ordered.push({
        from: step.source,
        to: step.target,
        type: step.type,
        name: step.name,
      });
    }
  }

  /* -- emit ---------------------------------------------------------------- */

  // A behaviour with no assigned performer stands for itself, so an
  // unassigned process still appears rather than vanishing from the diagram.
  const participantOf = (behaviourId: string): AbElement =>
    performerOf.get(behaviourId) ?? byId.get(behaviourId)!;

  const participants: AbElement[] = [];
  const addParticipant = (el: AbElement) => {
    if (!participants.some((p) => p.id === el.id)) participants.push(el);
  };
  for (const step of ordered) {
    addParticipant(participantOf(step.from));
    addParticipant(participantOf(step.to));
  }

  const lines = ["sequenceDiagram", "    autonumber", `    title ${label(title)}`];

  for (const p of participants) {
    const kind = isActiveStructure(p) ? "actor" : "participant";
    lines.push(`    ${kind} ${alias(p.id)} as ${label(p.name)}`);
  }

  for (const step of ordered) {
    const from = participantOf(step.from);
    const to = participantOf(step.to);
    // Dashed for flow, solid for triggering: flow carries something, a trigger
    // only starts something.
    const arrow = step.type === "flow" ? "-->>" : "->>";
    const behaviour = byId.get(step.to)!;
    // When nothing is assigned to a behaviour it stands as its own
    // participant, and naming the message after it would just repeat the
    // lifeline it points at — "A ->> B: B". Name the step by what the
    // relationship says instead.
    const text =
      to.id === behaviour.id
        ? step.name ?? step.type
        : step.name
          ? `${behaviour.name} (${step.name})`
          : behaviour.name;
    lines.push(`    ${alias(from.id)}${arrow}${alias(to.id)}: ${label(text)}`);
  }

  return lines.join("\n") + "\n";
}
