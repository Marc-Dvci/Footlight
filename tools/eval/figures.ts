// Data for the README figures, computed by the same Core code the Lens runs.
// Writes docs/figures/figures.json; tools/eval/figures.py draws the PNGs from it.
//   npx tsx eval/figures.ts && python eval/figures.py

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as EngineNs from "../../Assets/Scripts/Core/FootlightEngine";
import * as GeometryNs from "../../Assets/Scripts/Core/CueGeometry";
import * as MathNs from "../../Assets/Scripts/Core/FootlightMath";
import type { FreezeSpot } from "../../Assets/Scripts/Core/CueGeometry";
import { script } from "../test/walks";

// Core compiles as CommonJS; under tsx its exports arrive on `default` (same as eval/daphnet.ts).
const cjs = <T>(ns: T): T => ((ns as unknown as { default?: T }).default ?? ns);
const { FootlightEngine } = cjs(EngineNs);
const { DEFAULT_CUES, doorwayCues, turnCues } = cjs(GeometryNs);
const { dirOfYaw } = cjs(MathNs);

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../../docs/figures/figures.json");

// A doorway 3 m ahead of the start, crossed walking toward -z (the LEAF c1 layout).
const DOOR: FreezeSpot = { id: "bath", label: "Bathroom door", kind: "doorway", center: { x: 0, z: -300 }, yaw: 0, radiusCm: 120 };
const TURN: FreezeSpot = { id: "bed", label: "Turn by the bed", kind: "turn", center: { x: 0, z: -300 }, yaw: 0, radiusCm: 100, turnDeg: 90 };

// 1. One freeze in the doorway, frame by frame: walk in, freeze for 3 s, walk on.
const engine = new FootlightEngine();
engine.setSpots([DOOR]);
const walk = script([
  { kind: "walk", seconds: 2.6, speedCmS: 70 },
  { kind: "stop", seconds: 3 },
  { kind: "walk", seconds: 6, speedCmS: 45 },
]);
const frames = walk.map((s) => {
  const f = engine.step(s.pose, s.yaw);
  return {
    t: s.pose.t,
    z: s.pose.z,
    speed: f.speedCmS,
    gait: f.gait,
    state: f.state,
    beat: f.beat,
    newPlan: f.newPlan,
    lines: f.lines.map((l) => l.opacity),
  };
});
const shown = frames.find((f) => f.newPlan)!;

// 2. Where the lines go: a stop 20 cm off-centre before the door, and a 90 degree left turn.
const stopAt = { x: 20, z: -205 };
const door = doorwayCues(stopAt, dirOfYaw(0), DOOR, DEFAULT_CUES);
const turnAt = { x: 0, z: 0 };
const turn = turnCues(turnAt, dirOfYaw(0), TURN, DEFAULT_CUES);
const pts = (p: { lines: { center: { x: number; z: number }; yaw: number; widthCm: number }[] }) =>
  p.lines.map((l) => ({ x: l.center.x, z: l.center.z, yaw: l.yaw, width: l.widthCm }));

mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  JSON.stringify(
    {
      cues: DEFAULT_CUES,
      timeline: { stopT: 2.6, resumeT: 5.6, shownT: shown.t, frames: frames },
      doorway: { door: DOOR, at: stopAt, lines: pts(door) },
      turn: { at: turnAt, lines: pts(turn) },
    },
    null,
    1,
  ),
);
console.log(`lines shown ${(shown.t - 2.6).toFixed(2)} s after the stop; wrote ${out}`);
