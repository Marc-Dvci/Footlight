// Decides when a walk has turned into a freeze, from head position alone.
//
// A freeze is forward progress stopping after walking had started. Inside a freeze spot (a place
// the carer marked: a doorway, a turn, a narrow gap) a short stop is enough, because a false cue
// there costs nothing and a late cue costs a fall risk. On open floor a stop also needs trembling
// in the 3-8 Hz band of head height, so stopping to look at something does not draw lines.

import { Pose, Vec2, floorOf, length, sub } from "./FootlightMath";
import { freezeIndex, secondDifference } from "./FreezeIndex";

export type FreezeCause = "spot" | "tremble" | "pinch";
export type GaitState = "standing" | "walking" | "frozen";

export interface DetectorConfig {
  walkSpeedCmS: number; // above this, the person is moving
  walkHoldS: number; // how long movement must last before a stop can be a freeze
  stopSpeedCmS: number; // below this, the person has stopped
  stopHoldSpotS: number; // stop duration that counts as a freeze inside a freeze spot
  stopHoldOpenS: number; // stop duration before the tremble test applies on open floor
  resumeHoldS: number; // movement duration that ends a freeze
  speedWindowS: number; // window for the speed estimate
  trembleWindowS: number; // window for the freeze index
  trembleSampleHz: number; // resampling rate for the freeze index
  trembleIndex: number; // freeze index threshold
  tremblePower: number; // minimum 0.5-8 Hz power, in (cm/s^2)^2, to call it trembling
}

export const DEFAULT_DETECTOR: DetectorConfig = {
  walkSpeedCmS: 18,
  walkHoldS: 0.8,
  stopSpeedCmS: 6,
  stopHoldSpotS: 0.4,
  stopHoldOpenS: 1.3,
  resumeHoldS: 0.5,
  speedWindowS: 0.3,
  trembleWindowS: 1.0,
  trembleSampleHz: 32,
  trembleIndex: 3,
  tremblePower: 40,
};

export interface FreezeEvent {
  t: number;
  at: Vec2;
  cause: FreezeCause;
  spotId: string | null;
}

export interface ResumeEvent {
  t: number;
  freezeStartedAt: number;
  durationS: number;
}

export interface DetectorUpdate {
  state: GaitState;
  speedCmS: number;
  freeze: FreezeEvent | null; // set on the update where a freeze begins
  resume: ResumeEvent | null; // set on the update where walking resumes after a freeze
}

export class FreezeDetector {
  private cfg: DetectorConfig;
  private history: Pose[] = [];
  private state: GaitState = "standing";
  private movingSince = -1;
  private stoppedSince = -1;
  private walkedRecently = false;
  private freezeStart = -1;

  constructor(cfg?: Partial<DetectorConfig>) {
    this.cfg = Object.assign({}, DEFAULT_DETECTOR, cfg || {});
  }

  getState(): GaitState {
    return this.state;
  }

  getConfig(): DetectorConfig {
    return this.cfg;
  }

  reset(): void {
    this.history = [];
    this.state = "standing";
    this.movingSince = -1;
    this.stoppedSince = -1;
    this.walkedRecently = false;
    this.freezeStart = -1;
  }

  /** A manual freeze (the pinch). Starts a freeze at once, whatever the gait state. */
  forceFreeze(t: number, at: Vec2, spotId: string | null): FreezeEvent {
    this.state = "frozen";
    this.freezeStart = t;
    this.movingSince = -1;
    return { t: t, at: at, cause: "pinch", spotId: spotId };
  }

  /**
   * Feeds one head pose. `spotId` is the freeze spot the head is inside, or null.
   */
  update(p: Pose, spotId: string | null): DetectorUpdate {
    this.history.push(p);
    const keep = Math.max(this.cfg.trembleWindowS, this.cfg.speedWindowS) + 0.5;
    while (this.history.length > 2 && p.t - this.history[0].t > keep) {
      this.history.shift();
    }
    const speed = this.speed(p.t);
    const out: DetectorUpdate = { state: this.state, speedCmS: speed, freeze: null, resume: null };

    const moving = speed >= this.cfg.walkSpeedCmS;
    const stopped = speed <= this.cfg.stopSpeedCmS;

    if (moving) {
      if (this.movingSince < 0) {
        this.movingSince = p.t;
      }
      this.stoppedSince = -1;
    } else {
      this.movingSince = -1;
      if (stopped && this.stoppedSince < 0) {
        this.stoppedSince = p.t;
      }
      if (!stopped) {
        this.stoppedSince = -1;
      }
    }
    const movingFor = this.movingSince >= 0 ? p.t - this.movingSince : 0;
    const stoppedFor = this.stoppedSince >= 0 ? p.t - this.stoppedSince : 0;

    if (this.state === "frozen") {
      if (movingFor >= this.cfg.resumeHoldS) {
        const started = this.freezeStart;
        this.state = "walking";
        this.walkedRecently = true;
        this.freezeStart = -1;
        out.resume = { t: p.t, freezeStartedAt: started, durationS: Math.max(0, p.t - started - movingFor) };
      }
    } else {
      if (movingFor >= this.cfg.walkHoldS) {
        this.state = "walking";
        this.walkedRecently = true;
      }
      if (this.walkedRecently && stopped) {
        let cause: FreezeCause | null = null;
        if (spotId !== null && stoppedFor >= this.cfg.stopHoldSpotS) {
          cause = "spot";
        } else if (
          stoppedFor >= this.cfg.stopHoldOpenS &&
          stoppedFor >= this.cfg.trembleWindowS + 0.2 && // the window holds only the stop, not the last steps
          this.trembling(p.t)
        ) {
          cause = "tremble";
        }
        if (cause !== null) {
          this.state = "frozen";
          this.freezeStart = this.stoppedSince;
          out.freeze = { t: p.t, at: floorOf(p), cause: cause, spotId: spotId };
        } else if (stoppedFor > 4 * this.cfg.stopHoldOpenS) {
          // A long calm stop on open floor is a rest, not a freeze. A new walk is needed.
          this.state = "standing";
          this.walkedRecently = false;
        }
      }
    }
    out.state = this.state;
    return out;
  }

  /** Horizontal speed over the last speedWindowS, cm/s. */
  speed(now: number): number {
    const h = this.history;
    if (h.length < 2) {
      return 0;
    }
    let i = h.length - 1;
    while (i > 0 && now - h[i - 1].t <= this.cfg.speedWindowS) {
      i--;
    }
    if (i === h.length - 1) {
      i = h.length - 2;
    }
    const a = h[i];
    const b = h[h.length - 1];
    const dt = b.t - a.t;
    return dt > 1e-6 ? length(sub(floorOf(b), floorOf(a))) / dt : 0;
  }

  /** Freeze-band test on head height over the last trembleWindowS. */
  trembling(now: number): boolean {
    const series = this.resampledHeight(now);
    if (series.length < 16) {
      return false;
    }
    const acc = secondDifference(series, this.cfg.trembleSampleHz);
    const r = freezeIndex(acc, this.cfg.trembleSampleHz);
    return r.freezeIndex >= this.cfg.trembleIndex && r.totalPower >= this.cfg.tremblePower;
  }

  private resampledHeight(now: number): number[] {
    const h = this.history;
    const fs = this.cfg.trembleSampleHz;
    const n = Math.floor(this.cfg.trembleWindowS * fs);
    if (h.length < 2 || now - h[0].t < this.cfg.trembleWindowS * 0.9) {
      return [];
    }
    const out: number[] = [];
    let j = 0;
    for (let k = 0; k < n; k++) {
      const t = now - this.cfg.trembleWindowS + k / fs;
      while (j < h.length - 2 && h[j + 1].t < t) {
        j++;
      }
      const a = h[j];
      const b = h[j + 1];
      const u = b.t - a.t > 1e-9 ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0;
      out.push(a.y + (b.y - a.y) * u);
    }
    return out;
  }
}
