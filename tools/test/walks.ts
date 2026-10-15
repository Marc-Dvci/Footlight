// Scripted head paths for the tests: walk, stop, tremble, turn.
import { Pose } from "../../Assets/Scripts/Core/FootlightMath";

export interface Segment {
  kind: "walk" | "stop" | "tremble" | "turn";
  seconds: number;
  speedCmS?: number; // walk
  turnDeg?: number; // turn, positive = left, applied while walking slowly
}

export interface Sample {
  pose: Pose;
  yaw: number;
}

const FS = 60;
const EYE = 160;

/** Head poses at 60 Hz. Starts at (x0,z0) facing yaw0 (0 = toward -z). */
export function script(segments: Segment[], x0 = 0, z0 = 0, yaw0 = 0): Sample[] {
  const out: Sample[] = [];
  let x = x0;
  let z = z0;
  let yaw = yaw0;
  let t = 0;
  for (const s of segments) {
    const n = Math.round(s.seconds * FS);
    for (let i = 0; i < n; i++) {
      const dt = 1 / FS;
      let y = EYE;
      if (s.kind === "walk" || s.kind === "turn") {
        const v = s.kind === "turn" ? 25 : (s.speedCmS ?? 70);
        if (s.kind === "turn") {
          yaw += ((s.turnDeg ?? 90) * Math.PI) / 180 / n;
        }
        x += -Math.sin(yaw) * v * dt;
        z += -Math.cos(yaw) * v * dt;
        y += 2.0 * Math.sin(2 * Math.PI * 1.8 * t); // head bob at step frequency
      } else if (s.kind === "tremble") {
        y += 0.6 * Math.sin(2 * Math.PI * 5.5 * t); // knee trembling reaching the head
        x += 0.05 * Math.sin(2 * Math.PI * 5.5 * t);
      }
      out.push({ pose: { t: t, x: x, y: y, z: z }, yaw: yaw });
      t += dt;
    }
  }
  return out;
}
