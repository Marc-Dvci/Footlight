// Where the lines go. Every number on the floor comes from here.
//
// Straight cues: transverse lines across the walking direction, the first one a short gap ahead
// of the toes, then one per target step. Doorway and gap cues run along the doorway axis and
// carry on past the opening. Turn cues lay stepping marks along a wide arc, so the person walks
// the turn instead of pivoting on the spot ("turn like a clock").

import { Vec2, add, dirOfYaw, dot, normalize, rotate, scale, sub, yawOf } from "./FootlightMath";

export type SpotKind = "doorway" | "turn" | "gap";

export interface FreezeSpot {
  id: string;
  label: string; // "Bathroom door"
  kind: SpotKind;
  center: Vec2; // on the floor, cm
  yaw: number; // doorway / gap: direction through the opening. turn: heading on arrival
  radiusCm: number; // the spot is active inside this radius
  turnDeg?: number; // turn spots: signed turn, positive = left
}

export interface CueConfig {
  stepCm: number; // target step length set by the carer or physiotherapist
  toeOffsetCm: number; // toes sit this far ahead of the head's floor point when standing
  firstGapCm: number; // gap between the toes and the first line
  lineCount: number; // lines on open floor
  lineWidthCm: number;
  pastDoorCm: number; // doorway cues continue this far beyond the opening
  turnRadiusCm: number;
  maxLines: number;
}

export const DEFAULT_CUES: CueConfig = {
  stepCm: 45,
  toeOffsetCm: 12,
  firstGapCm: 10,
  lineCount: 4,
  lineWidthCm: 60,
  pastDoorCm: 60,
  turnRadiusCm: 55,
  maxLines: 7,
};

export interface CueLine {
  index: number;
  center: Vec2;
  yaw: number; // the line lies across this heading
  widthCm: number;
  along: number; // distance from the head's floor point along the path, cm
}

export interface CuePlan {
  mode: "straight" | "doorway" | "turn";
  lines: CueLine[];
  heading: Vec2; // initial walking direction
  spotId: string | null;
}

/** Lines straight ahead along `heading`, starting from the head's floor point `at`. */
export function straightCues(at: Vec2, heading: Vec2, cfg: CueConfig, count?: number): CuePlan {
  const dir = normalize(heading);
  const n = Math.min(cfg.maxLines, count !== undefined ? count : cfg.lineCount);
  const first = cfg.toeOffsetCm + cfg.firstGapCm;
  const lines: CueLine[] = [];
  for (let i = 0; i < n; i++) {
    const along = first + i * cfg.stepCm;
    lines.push({ index: i, center: add(at, scale(dir, along)), yaw: yawOf(dir), widthCm: cfg.lineWidthCm, along: along });
  }
  return { mode: "straight", lines: lines, heading: dir, spotId: null };
}

/**
 * Doorway or gap: lines across the doorway axis, from just ahead of the toes through the
 * opening and `pastDoorCm` beyond it. The axis is flipped to match the side the person faces.
 */
export function doorwayCues(at: Vec2, facing: Vec2, spot: FreezeSpot, cfg: CueConfig): CuePlan {
  let axis = dirOfYaw(spot.yaw);
  if (dot(axis, normalize(facing)) < 0) {
    axis = scale(axis, -1);
  }
  // Lines are placed along the axis line through the spot centre, so they sit square in the door
  // even when the person stops off-centre.
  const head = dot(sub(at, spot.center), axis); // signed distance of the head to the door plane
  const start = head + cfg.toeOffsetCm + cfg.firstGapCm;
  const end = Math.max(start, cfg.pastDoorCm);
  const lines: CueLine[] = [];
  let i = 0;
  for (let d = start; d <= end + 1e-6 && i < cfg.maxLines; d += cfg.stepCm) {
    lines.push({
      index: i,
      center: add(spot.center, scale(axis, d)),
      yaw: yawOf(axis),
      widthCm: cfg.lineWidthCm,
      along: d - head,
    });
    i++;
  }
  // A stop right after the door still gets at least two lines to walk on.
  while (lines.length < 2 && i < cfg.maxLines) {
    const d = start + i * cfg.stepCm;
    lines.push({ index: i, center: add(spot.center, scale(axis, d)), yaw: yawOf(axis), widthCm: cfg.lineWidthCm, along: d - head });
    i++;
  }
  return { mode: "doorway", lines: lines, heading: axis, spotId: spot.id };
}

/**
 * Turn: stepping marks on an arc of radius turnRadiusCm, starting ahead of the toes and
 * sweeping the spot's turn angle, then two straight lines on the new heading.
 */
export function turnCues(at: Vec2, facing: Vec2, spot: FreezeSpot, cfg: CueConfig): CuePlan {
  const dir = normalize(facing);
  const turn = ((spot.turnDeg !== undefined ? spot.turnDeg : 90) * Math.PI) / 180;
  const side = turn >= 0 ? 1 : -1; // +1 turns left
  const r = cfg.turnRadiusCm;
  const startPoint = add(at, scale(dir, cfg.toeOffsetCm + cfg.firstGapCm));
  // Centre of the arc sits to the turning side of the start point.
  const leftOf = rotate(dir, Math.PI / 2);
  const centre = add(startPoint, scale(leftOf, side * r));
  const arcLen = Math.abs(turn) * r;
  const spacing = cfg.stepCm * 0.8; // shorter steps on a curve
  const marks = Math.max(2, Math.min(cfg.maxLines - 2, Math.round(arcLen / spacing) + 1));
  const lines: CueLine[] = [];
  const radial0 = sub(startPoint, centre);
  for (let i = 0; i < marks; i++) {
    const a = (turn * i) / (marks - 1);
    const p = add(centre, rotate(radial0, a));
    const tangent = rotate(dir, a);
    lines.push({ index: i, center: p, yaw: yawOf(tangent), widthCm: cfg.lineWidthCm * 0.75, along: cfg.toeOffsetCm + cfg.firstGapCm + Math.abs(a) * r });
  }
  const endDir = rotate(dir, turn);
  const endPoint = lines[lines.length - 1].center;
  for (let k = 1; k <= 2; k++) {
    const p = add(endPoint, scale(endDir, k * cfg.stepCm));
    lines.push({ index: lines.length, center: p, yaw: yawOf(endDir), widthCm: cfg.lineWidthCm, along: lines[lines.length - 1].along + cfg.stepCm });
  }
  return { mode: "turn", lines: lines, heading: dir, spotId: spot.id };
}

/** Picks the cue plan for a freeze at `at`, facing `facing`, inside `spot` (or open floor). */
export function planCues(at: Vec2, facing: Vec2, spot: FreezeSpot | null, cfg: CueConfig): CuePlan {
  if (spot === null) {
    return straightCues(at, facing, cfg);
  }
  if (spot.kind === "turn") {
    return turnCues(at, facing, spot, cfg);
  }
  return doorwayCues(at, facing, spot, cfg);
}

/** The spot whose radius contains `at`, nearest first, or null. */
export function spotAt(at: Vec2, spots: FreezeSpot[]): FreezeSpot | null {
  let best: FreezeSpot | null = null;
  let bestD = Infinity;
  for (const s of spots) {
    const d = Math.sqrt((at.x - s.center.x) * (at.x - s.center.x) + (at.z - s.center.z) * (at.z - s.center.z));
    if (d <= s.radiusCm && d < bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}
