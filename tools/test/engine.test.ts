import { describe, expect, it } from "vitest";
import { FootlightEngine, EngineFrame } from "../../Assets/Scripts/Core/FootlightEngine";
import { FreezeSpot, doorwayCues, straightCues, turnCues, DEFAULT_CUES } from "../../Assets/Scripts/Core/CueGeometry";
import { dirOfYaw, dot, length, sub, yawOf } from "../../Assets/Scripts/Core/FootlightMath";
import { freezeIndex } from "../../Assets/Scripts/Core/FreezeIndex";
import { SessionLog, summarySentence } from "../../Assets/Scripts/Core/SessionLog";
import { script, Segment } from "./walks";

// A doorway 3 m ahead of the start, crossed walking toward -z.
const DOOR: FreezeSpot = { id: "bath", label: "Bathroom door", kind: "doorway", center: { x: 0, z: -300 }, yaw: 0, radiusCm: 120 };
const TURN: FreezeSpot = { id: "bed", label: "Turn by the bed", kind: "turn", center: { x: 0, z: -300 }, yaw: 0, radiusCm: 100, turnDeg: 90 };

function run(engine: FootlightEngine, segs: Segment[]): EngineFrame[] {
  return script(segs).map((s) => engine.step(s.pose, s.yaw));
}

describe("freeze detection", () => {
  it("cues within one second of stopping in a doorway spot", () => {
    const e = new FootlightEngine();
    e.setSpots([DOOR]);
    // 70 cm/s for 2.6 s reaches z = -182, inside the 120 cm spot radius.
    const frames = run(e, [{ kind: "walk", seconds: 2.6, speedCmS: 70 }, { kind: "stop", seconds: 2 }]);
    const stopT = 2.6;
    const first = frames.find((f) => f.newPlan)!;
    expect(first).toBeTruthy();
    expect(first.freeze!.cause).toBe("spot");
    const t = frames.indexOf(first) / 60;
    expect(t - stopT).toBeGreaterThan(0);
    expect(t - stopT).toBeLessThan(1.0);
    expect(first.plan!.mode).toBe("doorway");
  });

  it("does not cue a calm stop on open floor", () => {
    const e = new FootlightEngine();
    const frames = run(e, [{ kind: "walk", seconds: 3 }, { kind: "stop", seconds: 5 }]);
    expect(frames.some((f) => f.newPlan)).toBe(false);
  });

  it("cues a trembling stop on open floor", () => {
    const e = new FootlightEngine();
    const frames = run(e, [{ kind: "walk", seconds: 3 }, { kind: "tremble", seconds: 4 }]);
    const first = frames.find((f) => f.newPlan);
    expect(first).toBeTruthy();
    expect(first!.freeze!.cause).toBe("tremble");
    expect(first!.plan!.mode).toBe("straight");
  });

  it("does not treat the start of a walk as a freeze", () => {
    const e = new FootlightEngine();
    e.setSpots([DOOR]);
    const frames = script([{ kind: "stop", seconds: 2 }], 0, -300).map((s) => e.step(s.pose, s.yaw));
    expect(frames.some((f) => f.newPlan)).toBe(false);
  });

  it("logs the freeze duration when walking resumes", () => {
    const e = new FootlightEngine();
    e.setSpots([DOOR]);
    run(e, [{ kind: "walk", seconds: 2.6 }, { kind: "stop", seconds: 3 }, { kind: "walk", seconds: 3 }]);
    const s = e.log.summary();
    expect(s.freezes).toBe(1);
    expect(s.bySpot[0].label).toBe("Bathroom door");
    // Stop lasted 3.0 s; the detector needs a short time to see the stop and the restart.
    expect(s.longestS).toBeGreaterThan(2.5);
    expect(s.longestS).toBeLessThan(3.6);
  });
});

describe("cue geometry", () => {
  it("spaces doorway lines at the target step and runs them through the door", () => {
    const at = { x: 0, z: -200 };
    const plan = doorwayCues(at, dirOfYaw(0), DOOR, { ...DEFAULT_CUES, stepCm: 50 });
    const first = plan.lines[0];
    // First line: toes (12 cm) plus a 10 cm gap ahead of the head's floor point.
    expect(length(sub(first.center, at))).toBeCloseTo(22, 5);
    for (let i = 1; i < plan.lines.length; i++) {
      expect(length(sub(plan.lines[i].center, plan.lines[i - 1].center))).toBeCloseTo(50, 5);
    }
    const last = plan.lines[plan.lines.length - 1];
    expect(-(last.center.z - DOOR.center.z)).toBeGreaterThan(0); // beyond the door plane
  });

  it("follows the walker's side of the door", () => {
    const at = { x: 0, z: -400 }; // on the far side, walking back toward +z
    const plan = doorwayCues(at, dirOfYaw(Math.PI), DOOR, DEFAULT_CUES);
    expect(plan.lines[0].center.z).toBeGreaterThan(at.z);
    expect(plan.lines[plan.lines.length - 1].center.z).toBeGreaterThan(DOOR.center.z);
  });

  it("squares doorway lines to the door when the person stops off-centre", () => {
    const plan = doorwayCues({ x: 25, z: -220 }, dirOfYaw(0.3), DOOR, DEFAULT_CUES);
    for (const l of plan.lines) {
      expect(l.center.x).toBeCloseTo(0, 5);
      expect(l.yaw).toBeCloseTo(0, 5);
    }
  });

  it("lays straight lines across the walking direction", () => {
    const dir = dirOfYaw(0.7);
    const plan = straightCues({ x: 10, z: 10 }, dir, DEFAULT_CUES);
    expect(plan.lines.length).toBe(DEFAULT_CUES.lineCount);
    for (const l of plan.lines) {
      expect(l.yaw).toBeCloseTo(yawOf(dir), 6);
    }
  });

  it("sweeps a left turn on a wide arc and ends on the new heading", () => {
    const plan = turnCues({ x: 0, z: -300 }, dirOfYaw(0), TURN, DEFAULT_CUES);
    const arc = plan.lines.slice(0, plan.lines.length - 2);
    expect(arc.length).toBeGreaterThanOrEqual(2);
    // Every arc mark sits on the arc radius around a centre to the left (-x) of the start.
    const centre = { x: -DEFAULT_CUES.turnRadiusCm, z: -300 - 22 };
    for (const l of arc) {
      expect(length(sub(l.center, centre))).toBeCloseTo(DEFAULT_CUES.turnRadiusCm, 4);
    }
    const end = plan.lines[plan.lines.length - 1];
    expect(end.yaw).toBeCloseTo(Math.PI / 2, 5); // facing -x after a 90 degree left turn
  });
});

describe("cue sequencing", () => {
  it("dims crossed lines, then fades and stops the beat once the walk is steady", () => {
    const e = new FootlightEngine();
    e.setSpots([DOOR]);
    const frames = run(e, [{ kind: "walk", seconds: 2.6 }, { kind: "stop", seconds: 1.5 }, { kind: "walk", seconds: 6 }]);
    const cueing = frames.filter((f) => f.state === "cueing");
    expect(cueing.length).toBeGreaterThan(0);
    expect(frames.some((f) => f.lines.some((l) => l.crossed))).toBe(true);
    const last = frames[frames.length - 1];
    expect(last.state).toBe("hidden");
    expect(last.beatActive).toBe(false);
    // Beats are at the cadence (100 bpm = 0.6 s).
    const beats = frames.map((f, i) => (f.beat ? i / 60 : -1)).filter((t) => t >= 0);
    expect(beats.length).toBeGreaterThan(2);
    expect(beats[2] - beats[1]).toBeCloseTo(0.6, 1);
  });

  it("keeps the lines while the person stays frozen", () => {
    const e = new FootlightEngine();
    e.setSpots([DOOR]);
    const frames = run(e, [{ kind: "walk", seconds: 2.6 }, { kind: "stop", seconds: 20 }]);
    expect(frames[frames.length - 1].state).toBe("cueing");
  });

  it("pinch brings lines up at once, anywhere", () => {
    const e = new FootlightEngine();
    run(e, [{ kind: "stop", seconds: 1 }]);
    const f = e.pinch(1.0);
    expect(f.state).toBe("cueing");
    expect(f.plan!.lines.length).toBe(DEFAULT_CUES.lineCount);
    expect(f.freeze!.cause).toBe("pinch");
  });

  it("changing the step target changes the spacing", () => {
    const e = new FootlightEngine();
    e.setStepCm(60);
    run(e, [{ kind: "stop", seconds: 0.5 }]);
    const f = e.pinch(0.5);
    const ls = f.plan!.lines;
    expect(length(sub(ls[1].center, ls[0].center))).toBeCloseTo(60, 5);
    expect(dot(sub(ls[1].center, ls[0].center), f.plan!.heading)).toBeCloseTo(60, 5);
  });
});

describe("freeze index", () => {
  it("is high for 5 Hz trembling and low for 1.8 Hz walking", () => {
    const fs = 64;
    const tremble = Array.from({ length: 256 }, (_, i) => Math.sin(2 * Math.PI * 5 * (i / fs)));
    const walk = Array.from({ length: 256 }, (_, i) => Math.sin(2 * Math.PI * 1.8 * (i / fs)));
    expect(freezeIndex(tremble, fs).freezeIndex).toBeGreaterThan(10);
    expect(freezeIndex(walk, fs).freezeIndex).toBeLessThan(0.1);
  });
});

describe("session summary", () => {
  it("names the spot with the most freezes", () => {
    const log = new SessionLog();
    log.begin(1, "spot", "bath", "Bathroom door");
    log.end(4.2);
    log.begin(9, "spot", "bath", "Bathroom door");
    log.end(1.1);
    log.begin(20, "pinch", null, "Open floor");
    log.end(2.0);
    const s = log.summary();
    expect(s.freezes).toBe(3);
    expect(s.medianS).toBeCloseTo(2.0, 6);
    expect(summarySentence(s)).toBe("3 freezes this session. Longest 4.2 s. Most at: Bathroom door.");
  });
});
