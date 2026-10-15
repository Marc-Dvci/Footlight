// Freeze index (Moore et al. 2008; Bachlin et al. 2010).
// During a freeze the legs tremble at 3-8 Hz while forward progress stops, so power in the
// "freeze band" rises against the "locomotor band" (0.5-3 Hz) of vertical acceleration.
// The same function scores body-worn accelerometer data in tools/eval and head motion in the Lens.

export interface FreezeIndexResult {
  freezeIndex: number; // power(3-8 Hz) / power(0.5-3 Hz)
  totalPower: number; // power(0.5-8 Hz), gates out standing still
}

export const FREEZE_BAND: [number, number] = [3, 8];
export const LOCO_BAND: [number, number] = [0.5, 3];

/**
 * Band powers of a uniformly sampled window by direct DFT over the bins inside 0.5-8 Hz.
 * `window` is any length; a Hann taper is applied after removing the mean.
 */
export function freezeIndex(window: ArrayLike<number>, fs: number): FreezeIndexResult {
  const n = window.length;
  if (n < 8) {
    return { freezeIndex: 0, totalPower: 0 };
  }
  let mean = 0;
  for (let i = 0; i < n; i++) {
    mean += window[i];
  }
  mean /= n;
  const tapered = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    tapered[i] = (window[i] - mean) * w;
  }
  const df = fs / n;
  const kMin = Math.max(1, Math.ceil(LOCO_BAND[0] / df));
  const kMax = Math.min(Math.floor(n / 2), Math.floor(FREEZE_BAND[1] / df));
  let loco = 0;
  let freeze = 0;
  for (let k = kMin; k <= kMax; k++) {
    let re = 0;
    let im = 0;
    const w = (2 * Math.PI * k) / n;
    for (let i = 0; i < n; i++) {
      re += tapered[i] * Math.cos(w * i);
      im -= tapered[i] * Math.sin(w * i);
    }
    const p = (re * re + im * im) / n;
    const f = k * df;
    if (f < LOCO_BAND[1]) {
      loco += p;
    } else {
      freeze += p;
    }
  }
  return {
    freezeIndex: loco > 1e-12 ? freeze / loco : freeze > 1e-12 ? 99 : 0,
    totalPower: loco + freeze,
  };
}

/** Second difference of a position trace: acceleration in the trace's units per s^2. */
export function secondDifference(positions: ArrayLike<number>, fs: number): number[] {
  const out: number[] = [];
  for (let i = 1; i < positions.length - 1; i++) {
    out.push((positions[i + 1] - 2 * positions[i] + positions[i - 1]) * fs * fs);
  }
  return out;
}
