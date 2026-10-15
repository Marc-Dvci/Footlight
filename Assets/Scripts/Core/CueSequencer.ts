// What is on the floor right now, and when it leaves.
//
// hidden -> cueing        on a freeze (spot, tremble or pinch)
// cueing -> fading        once every line is crossed, or after steady walking past the last crossing
// fading -> hidden        after the fade and the last beats
// Lines that have been crossed dim one by one. The beat runs while cueing and for a few beats
// into the fade, so the rhythm outlasts the picture. Cues that stay on stop working, so nothing
// stays on the floor once the walk is steady.

import { Vec2, dot, sub } from "./FootlightMath";
import { CuePlan } from "./CueGeometry";

export type CueState = "hidden" | "cueing" | "fading";

export interface SequencerConfig {
  crossSlackCm: number; // a line counts as crossed when the head is this close behind it
  steadyAfterS: number; // steady walking after the last crossing that ends the cue
  fadeS: number; // fade duration
  beatsAfterFade: number; // beats that keep playing after the lines start to fade
  cooldownS: number; // automatic cues are ignored this long after hiding (the pinch always works)
  cadenceBpm: number; // beat tempo
}

export const DEFAULT_SEQUENCER: SequencerConfig = {
  crossSlackCm: 5,
  steadyAfterS: 1.5,
  fadeS: 0.8,
  beatsAfterFade: 2,
  cooldownS: 2.0,
  cadenceBpm: 100,
};

export interface LineView {
  index: number;
  crossed: boolean;
  opacity: number; // 0..1
}

export interface SequencerFrame {
  state: CueState;
  lines: LineView[];
  beat: boolean; // true on the frame a beat should sound
  beatActive: boolean;
  changed: boolean; // state changed on this frame
}

export class CueSequencer {
  private cfg: SequencerConfig;
  private plan: CuePlan | null = null;
  private state: CueState = "hidden";
  private crossed: boolean[] = [];
  private crossedAt: number[] = [];
  private lastCrossT = -1;
  private fadeStart = -1;
  private hiddenAt = -1e9;
  private nextBeatT = -1;
  private beatsLeftAfterFade = 0;
  private shownAt = -1;

  constructor(cfg?: Partial<SequencerConfig>) {
    this.cfg = Object.assign({}, DEFAULT_SEQUENCER, cfg || {});
  }

  getState(): CueState {
    return this.state;
  }

  getPlan(): CuePlan | null {
    return this.plan;
  }

  setCadence(bpm: number): void {
    this.cfg.cadenceBpm = bpm;
  }

  getConfig(): SequencerConfig {
    return this.cfg;
  }

  /** True when an automatic (non-pinch) cue may start at time t. */
  canAutoCue(t: number): boolean {
    return this.state === "hidden" && t - this.hiddenAt >= this.cfg.cooldownS;
  }

  show(plan: CuePlan, t: number): void {
    this.plan = plan;
    this.state = "cueing";
    this.crossed = plan.lines.map(() => false);
    this.crossedAt = plan.lines.map(() => -1);
    this.lastCrossT = -1;
    this.fadeStart = -1;
    this.shownAt = t;
    this.nextBeatT = t; // first beat at once
    this.beatsLeftAfterFade = this.cfg.beatsAfterFade;
  }

  hideNow(t: number): void {
    this.state = "hidden";
    this.plan = null;
    this.hiddenAt = t;
  }

  /** `walking` is the detector's verdict for this frame. */
  update(headFloor: Vec2, t: number, walking: boolean): SequencerFrame {
    const before = this.state;
    let beat = false;
    if (this.plan !== null && this.state !== "hidden") {
      const lines = this.plan.lines;
      if (this.state === "cueing") {
        // Crossing test along each line's own heading, so arcs work too.
        for (let i = 0; i < lines.length; i++) {
          if (this.crossed[i]) {
            continue;
          }
          const h = { x: -Math.sin(lines[i].yaw), z: -Math.cos(lines[i].yaw) };
          if (dot(sub(headFloor, lines[i].center), h) >= -this.cfg.crossSlackCm) {
            // Lines are walked in order: crossing line i also crosses the ones before it.
            for (let j = 0; j <= i; j++) {
              if (!this.crossed[j]) {
                this.crossed[j] = true;
                this.crossedAt[j] = t;
              }
            }
            this.lastCrossT = t;
          }
        }
        const all = this.crossed.every((c) => c);
        const steady = this.lastCrossT >= 0 && walking && t - this.lastCrossT >= this.cfg.steadyAfterS;
        if (all || steady) {
          this.state = "fading";
          this.fadeStart = t;
        }
      }
      if (this.state === "fading" && t - this.fadeStart >= this.cfg.fadeS && this.beatsLeftAfterFade <= 0) {
        this.state = "hidden";
        this.plan = null;
        this.hiddenAt = t;
      }
    }

    // Beat clock.
    const beatActive = this.state === "cueing" || (this.state === "fading" && this.beatsLeftAfterFade > 0);
    if (beatActive && this.nextBeatT >= 0 && t >= this.nextBeatT) {
      beat = true;
      this.nextBeatT += 60 / this.cfg.cadenceBpm;
      if (this.nextBeatT < t) {
        this.nextBeatT = t + 60 / this.cfg.cadenceBpm;
      }
      if (this.state === "fading") {
        this.beatsLeftAfterFade--;
      }
    }

    return {
      state: this.state,
      lines: this.views(t),
      beat: beat,
      beatActive: beatActive,
      changed: before !== this.state,
    };
  }

  private views(t: number): LineView[] {
    if (this.plan === null || this.state === "hidden") {
      return [];
    }
    const out: LineView[] = [];
    for (let i = 0; i < this.plan.lines.length; i++) {
      let o = 1;
      if (this.crossed[i]) {
        o = Math.max(0.15, 1 - (t - this.crossedAt[i]) / 0.6); // crossed lines dim behind the walker
      }
      if (this.state === "fading") {
        o *= Math.max(0, 1 - (t - this.fadeStart) / this.cfg.fadeS);
      }
      const appear = Math.min(1, (t - this.shownAt) / 0.15 - i * 0.35); // lines roll out from the toes
      out.push({ index: i, crossed: this.crossed[i], opacity: Math.max(0, Math.min(o, appear < 0 ? 0 : appear)) });
    }
    return out;
  }
}
