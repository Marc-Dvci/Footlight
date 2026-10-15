// One object the Lens calls every frame. Pure logic: the Lens component feeds it the head pose
// and draws what it returns, and the Node tests drive it with scripted walks.

import { Pose, Vec2, dirOfYaw, floorOf } from "./FootlightMath";
import { CueConfig, CuePlan, DEFAULT_CUES, FreezeSpot, planCues, spotAt } from "./CueGeometry";
import { DetectorConfig, FreezeDetector, FreezeEvent, GaitState, ResumeEvent } from "./FreezeDetector";
import { CueSequencer, SequencerConfig, SequencerFrame } from "./CueSequencer";
import { SessionLog } from "./SessionLog";

export interface EngineFrame extends SequencerFrame {
  gait: GaitState;
  speedCmS: number;
  spot: FreezeSpot | null;
  plan: CuePlan | null;
  freeze: FreezeEvent | null;
  resume: ResumeEvent | null;
  newPlan: boolean; // a cue plan was created on this frame
}

export interface EngineOptions {
  detector?: Partial<DetectorConfig>;
  cues?: Partial<CueConfig>;
  sequencer?: Partial<SequencerConfig>;
}

export class FootlightEngine {
  readonly detector: FreezeDetector;
  readonly sequencer: CueSequencer;
  readonly log = new SessionLog();
  private cues: CueConfig;
  private spots: FreezeSpot[] = [];
  private t0 = -1;
  private lastPose: Pose | null = null;
  private lastFacing: Vec2 = { x: 0, z: -1 };
  private lastHeadDir: Vec2 = { x: 0, z: -1 };
  private hasWalkDir = false;
  private lastCueSpotId: string | null = null;

  constructor(opts?: EngineOptions) {
    const o = opts || {};
    this.detector = new FreezeDetector(o.detector);
    this.sequencer = new CueSequencer(o.sequencer);
    this.cues = Object.assign({}, DEFAULT_CUES, o.cues || {});
  }

  setSpots(spots: FreezeSpot[]): void {
    this.spots = spots.slice();
  }

  getSpots(): FreezeSpot[] {
    return this.spots.slice();
  }

  setStepCm(cm: number): void {
    this.cues.stepCm = cm;
  }

  getCueConfig(): CueConfig {
    return this.cues;
  }

  setCadence(bpm: number): void {
    this.sequencer.setCadence(bpm);
  }

  /** Seconds since the first pose. */
  sessionTime(t: number): number {
    return this.t0 < 0 ? 0 : t - this.t0;
  }

  /** The pinch: cues at once from wherever the person stands, toward where the head points. */
  pinch(t: number): EngineFrame {
    const at = this.lastPose ? floorOf(this.lastPose) : { x: 0, z: 0 };
    const spot = spotAt(at, this.spots);
    const ev = this.detector.forceFreeze(t, at, spot ? spot.id : null);
    this.startCue(ev, this.lastHeadDir, spot, t);
    const frame = this.sequencer.update(at, t, false);
    return this.wrap(frame, "frozen", 0, spot, ev, null, true);
  }

  /**
   * One frame. `facingYaw` is the head yaw (rotation about +y, radians); the cue heading uses the
   * recent walking direction when there is one, and the head direction otherwise.
   */
  step(p: Pose, facingYaw: number): EngineFrame {
    if (this.t0 < 0) {
      this.t0 = p.t;
    }
    const at = floorOf(p);
    const spot = spotAt(at, this.spots);
    const facing = this.walkingDirection(p, dirOfYaw(facingYaw));
    this.lastHeadDir = dirOfYaw(facingYaw);
    this.lastPose = p;
    this.lastFacing = facing;

    const d = this.detector.update(p, spot ? spot.id : null);
    let newPlan = false;
    // The cooldown stops repeat cues in the same place; a freeze at another spot always gets lines.
    const newSpot = spot !== null && spot.id !== this.lastCueSpotId;
    if (d.freeze && (this.sequencer.canAutoCue(p.t) || this.sequencer.getState() === "fading" || newSpot)) {
      this.startCue(d.freeze, facing, spot, p.t);
      newPlan = true;
    } else if (d.freeze) {
      // A freeze during the cooldown is still logged; the floor stays clear.
      this.log.begin(this.sessionTime(p.t), d.freeze.cause, d.freeze.spotId, spot ? spot.label : "Open floor");
    }
    if (d.resume) {
      this.log.end(d.resume.durationS);
    }
    const frame = this.sequencer.update(at, p.t, d.state === "walking");
    return this.wrap(frame, d.state, d.speedCmS, spot, d.freeze, d.resume, newPlan);
  }

  private startCue(ev: FreezeEvent, facing: Vec2, spot: FreezeSpot | null, t: number): void {
    this.lastCueSpotId = spot ? spot.id : null;
    const plan = planCues(ev.at, facing, spot, this.cues);
    this.sequencer.show(plan, t);
    this.log.begin(this.sessionTime(t), ev.cause, ev.spotId, spot ? spot.label : "Open floor");
  }

  private walkingDirection(p: Pose, headDir: Vec2): Vec2 {
    const prev = this.lastPose;
    if (prev !== null) {
      const dx = p.x - prev.x;
      const dz = p.z - prev.z;
      const dt = p.t - prev.t;
      if (dt > 0 && Math.sqrt(dx * dx + dz * dz) / dt > 15) {
        const l = Math.sqrt(dx * dx + dz * dz);
        // Blend toward the movement direction; keep it when the person stops.
        const mx = dx / l;
        const mz = dz / l;
        const bx = this.lastFacing.x * 0.8 + mx * 0.2;
        const bz = this.lastFacing.z * 0.8 + mz * 0.2;
        const bl = Math.sqrt(bx * bx + bz * bz) || 1;
        if (!this.hasWalkDir) {
          this.hasWalkDir = true;
          return { x: mx, z: mz };
        }
        return { x: bx / bl, z: bz / bl };
      }
    }
    return this.hasWalkDir ? this.lastFacing : headDir;
  }

  private wrap(
    f: SequencerFrame,
    gait: GaitState,
    speed: number,
    spot: FreezeSpot | null,
    freeze: FreezeEvent | null,
    resume: ResumeEvent | null,
    newPlan: boolean,
  ): EngineFrame {
    return {
      state: f.state,
      lines: f.lines,
      beat: f.beat,
      beatActive: f.beatActive,
      changed: f.changed,
      gait: gait,
      speedCmS: speed,
      spot: spot,
      plan: this.sequencer.getPlan(),
      freeze: freeze,
      resume: resume,
      newPlan: newPlan,
    };
  }
}
