import { RADAR_RINGS } from "../radar.js";
import type { RadarEntry, RadarQuadrant } from "../radar.js";

/**
 * Positions for a Technology Radar, computed from the model.
 *
 * Geometry only — no rendering, no React. The same reasoning as the Gantt and
 * D2 generators: the maths is worth testing on its own, and the MCP server or
 * a static export may want positions without a browser.
 *
 * The approach follows the Thoughtworks radar and `d-lab-5/gatsby-techradar`:
 * a sector per quadrant, concentric bands per adoption ring, a blip placed
 * inside its band. This is not a dependency on that package — it is not
 * published, and its data model is a flat CSV rather than an ArchiMate graph —
 * but the layout is a well-known one and there is no reason to invent another.
 *
 * Placement is **deterministic**. A blip derives its position from a hash of
 * its element id, so the same model always draws the same radar. A random
 * layout would make every re-render a visual diff and every screenshot
 * useless for comparison.
 */

export interface RadarBlip extends RadarEntry {
  /** Position in a unit circle centred on (0, 0), radius 1. */
  x: number;
  y: number;
  /** 1-based, in reading order across the whole radar. */
  number: number;
  quadrantIndex: number;
  ringIndex: number;
}

export interface RadarSector {
  name: string;
  index: number;
  /** Radians, measured clockwise from twelve o'clock. */
  startAngle: number;
  endAngle: number;
}

export interface RadarLayout {
  blips: RadarBlip[];
  sectors: RadarSector[];
  /** Outer radius of each ring, as a fraction of the radar radius. */
  ringRadii: number[];
  rings: readonly string[];
}

export interface RadarLayoutOptions {
  /** Fraction of the radius the innermost ring occupies. */
  innerRadius?: number;
  /** How hard blips are pushed apart. 0 disables relaxation. */
  separation?: number;
}

/**
 * A small deterministic hash. Not cryptographic — it only has to spread ids
 * evenly and give the same answer every time.
 */
function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

export function toRadarLayout(
  quadrants: RadarQuadrant[],
  options: RadarLayoutOptions = {}
): RadarLayout {
  const { innerRadius = 0.28, separation = 0.045 } = options;

  const rings = RADAR_RINGS;
  // Bands of equal area rather than equal width, so the outer rings — which
  // hold the most entries on a real radar — do not end up cramped.
  const ringRadii = rings.map((_, i) => {
    const t = (i + 1) / rings.length;
    return innerRadius + (1 - innerRadius) * Math.sqrt(t);
  });

  const sectors: RadarSector[] = quadrants.map((q, index) => ({
    name: q.name,
    index,
    startAngle: (index / quadrants.length) * Math.PI * 2,
    endAngle: ((index + 1) / quadrants.length) * Math.PI * 2,
  }));

  const blips: RadarBlip[] = [];
  let number = 0;

  quadrants.forEach((quadrant, quadrantIndex) => {
    const sector = sectors[quadrantIndex];
    for (const entry of quadrant.entries) {
      const ringIndex = Math.max(0, rings.indexOf(entry.ring));
      const inner = ringIndex === 0 ? innerRadius : ringRadii[ringIndex - 1];
      const outer = ringRadii[ringIndex];

      // Inset from both edges so a blip never sits on a ring line, where it
      // would read as belonging to either.
      const rSeed = hash(`${entry.id}:r`);
      const aSeed = hash(`${entry.id}:a`);
      const radius = inner + (outer - inner) * (0.18 + 0.64 * rSeed);
      const angle =
        sector.startAngle +
        (sector.endAngle - sector.startAngle) * (0.1 + 0.8 * aSeed);

      blips.push({
        ...entry,
        quadrantIndex,
        ringIndex,
        number: ++number,
        // Clockwise from twelve o'clock, and y down, which is SVG's
        // convention — so the caller does not have to flip anything.
        x: Math.sin(angle) * radius,
        y: -Math.cos(angle) * radius,
      });
    }
  });

  if (separation > 0) relax(blips, separation, innerRadius, ringRadii);

  return { blips, sectors, ringRadii, rings };
}

/**
 * Pushes overlapping blips apart, keeping each inside its own ring band.
 *
 * A hash spreads entries evenly on average but says nothing about any
 * particular pair, and two blips on top of each other are unreadable. A few
 * fixed passes is enough and keeps the result deterministic — an iterative
 * solver run to convergence would not be.
 */
function relax(
  blips: RadarBlip[],
  separation: number,
  innerRadius: number,
  ringRadii: number[]
): void {
  const PASSES = 24;
  for (let pass = 0; pass < PASSES; pass++) {
    let moved = false;
    for (let i = 0; i < blips.length; i++) {
      for (let j = i + 1; j < blips.length; j++) {
        const a = blips[i];
        const b = blips[j];
        // Only within the same band: pushing a blip across a ring line would
        // change what it means.
        if (a.quadrantIndex !== b.quadrantIndex || a.ringIndex !== b.ringIndex) {
          continue;
        }
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.hypot(dx, dy) || 1e-6;
        if (distance >= separation) continue;

        const push = (separation - distance) / 2;
        const ux = dx / distance;
        const uy = dy / distance;
        a.x -= ux * push;
        a.y -= uy * push;
        b.x += ux * push;
        b.y += uy * push;
        moved = true;
      }
    }
    if (!moved) break;
    for (const blip of blips) clampToBand(blip, innerRadius, ringRadii);
  }
}

/** Returns a blip to its own ring band after being pushed. */
function clampToBand(
  blip: RadarBlip,
  innerRadius: number,
  ringRadii: number[]
): void {
  const inner = blip.ringIndex === 0 ? innerRadius : ringRadii[blip.ringIndex - 1];
  const outer = ringRadii[blip.ringIndex];
  const radius = Math.hypot(blip.x, blip.y) || 1e-6;
  const clamped = Math.min(outer * 0.96, Math.max(inner * 1.04, radius));
  blip.x = (blip.x / radius) * clamped;
  blip.y = (blip.y / radius) * clamped;
}
