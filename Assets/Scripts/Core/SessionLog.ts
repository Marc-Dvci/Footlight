// The day's freezes, for the next appointment. Kept for the session only.

import { FreezeCause } from "./FreezeDetector";

export interface FreezeRecord {
  startedAt: number; // seconds since the session started
  durationS: number; // -1 while the freeze is still going
  cause: FreezeCause;
  spotId: string | null;
  spotLabel: string; // "Bathroom door" or "Open floor"
}

export interface SpotSummary {
  label: string;
  count: number;
  longestS: number;
}

export interface SessionSummary {
  freezes: number;
  longestS: number;
  medianS: number;
  bySpot: SpotSummary[]; // most freezes first
  pinches: number;
}

export class SessionLog {
  private records: FreezeRecord[] = [];

  begin(startedAt: number, cause: FreezeCause, spotId: string | null, spotLabel: string): void {
    this.records.push({ startedAt: startedAt, durationS: -1, cause: cause, spotId: spotId, spotLabel: spotLabel });
  }

  /** Closes the open freeze, if any. */
  end(durationS: number): void {
    for (let i = this.records.length - 1; i >= 0; i--) {
      if (this.records[i].durationS < 0) {
        this.records[i].durationS = durationS;
        return;
      }
    }
  }

  all(): FreezeRecord[] {
    return this.records.slice();
  }

  clear(): void {
    this.records = [];
  }

  summary(): SessionSummary {
    const done = this.records.filter((r) => r.durationS >= 0);
    const durations = done.map((r) => r.durationS).sort((a, b) => a - b);
    const median =
      durations.length === 0
        ? 0
        : durations.length % 2 === 1
          ? durations[(durations.length - 1) / 2]
          : (durations[durations.length / 2 - 1] + durations[durations.length / 2]) / 2;
    const map: { [label: string]: SpotSummary } = {};
    for (const r of this.records) {
      if (!map[r.spotLabel]) {
        map[r.spotLabel] = { label: r.spotLabel, count: 0, longestS: 0 };
      }
      map[r.spotLabel].count++;
      map[r.spotLabel].longestS = Math.max(map[r.spotLabel].longestS, Math.max(0, r.durationS));
    }
    const bySpot = Object.keys(map)
      .map((k) => map[k])
      .sort((a, b) => b.count - a.count || b.longestS - a.longestS);
    return {
      freezes: this.records.length,
      longestS: durations.length ? durations[durations.length - 1] : 0,
      medianS: median,
      bySpot: bySpot,
      pinches: this.records.filter((r) => r.cause === "pinch").length,
    };
  }
}

/** "3 freezes today. Longest 4.2 s, at the bathroom door." */
export function summarySentence(s: SessionSummary): string {
  if (s.freezes === 0) {
    return "No freezes this session.";
  }
  const top = s.bySpot[0];
  const noun = s.freezes === 1 ? "freeze" : "freezes";
  return s.freezes + " " + noun + " this session. Longest " + s.longestS.toFixed(1) + " s. Most at: " + top.label + ".";
}
