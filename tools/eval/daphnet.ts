// Leave-one-subject-out evaluation of the freeze-index detector (Core/FreezeIndex.ts) on the
// Daphnet Freezing of Gait dataset (UCI ML repository id 245, CC BY 4.0).
// Deterministic: no randomness anywhere.
//
// Run from tools/:   npx tsx eval/daphnet.ts
// Input:             eval/data/dataset_fog_release/dataset/S??R??.txt (zip extracted into eval/data/)
// Output:            eval/RESULTS.md, also printed to stdout.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as FreezeIndexNs from "../../Assets/Scripts/Core/FreezeIndex";

// Core/FreezeIndex.ts has no package.json above it, so tsx loads it as CommonJS and Node exposes its
// named exports only through `default`. Take the named export when it is there, else the CJS object.
type FreezeIndexFn = typeof FreezeIndexNs.freezeIndex;
const freezeIndex: FreezeIndexFn =
  (FreezeIndexNs as unknown as { freezeIndex?: FreezeIndexFn }).freezeIndex ??
  (FreezeIndexNs as unknown as { default: { freezeIndex: FreezeIndexFn } }).default.freezeIndex;

const EVAL_DIR = fileURLToPath(new URL(".", import.meta.url));
const DATA_DIR = join(EVAL_DIR, "data", "dataset_fog_release", "dataset");
const RESULTS_PATH = join(EVAL_DIR, "RESULTS.md");
const RESULTS_DATE = "2026-10-15";

const FS = 64; // Hz
const WIN = 256; // 4 s window
const HOP = 32; // 0.5 s hop
const TOL = 2 * FS; // 2 s tolerance, in samples
const STOP_LAG = 4 * FS; // stop gate compares with the window ending 4 s (256 samples) earlier
const MG_TO_MS2 = 0.00980665;
const FA_WEIGHT = 0.02;
const REFERENCE_EPISODES = 237; // count the task brief attributes to Bachlin et al. 2010

// Variants. "FI alone" keeps the original grids; the other two use the wide grids.
const FI_GRID_BASE = [1, 1.5, 2, 2.5, 3, 4, 5];
const POW_Q_BASE = [0.1, 0.25, 0.5];
const FI_GRID_WIDE = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 15];
const POW_Q_WIDE = [0.1, 0.25, 0.5, 0.75, 0.9];
const G_GRID = [0.25, 0.5, 0.75];

interface Variant {
  name: string;
  fiGrid: number[];
  powQ: number[];
  gGrid: number[] | null; // null: no stop gate
}
const VARIANTS: Variant[] = [
  { name: "FI alone", fiGrid: FI_GRID_BASE, powQ: POW_Q_BASE, gGrid: null },
  { name: "FI alone, wide grid", fiGrid: FI_GRID_WIDE, powQ: POW_Q_WIDE, gGrid: null },
  { name: "FI + stop gate", fiGrid: FI_GRID_WIDE, powQ: POW_Q_WIDE, gGrid: G_GRID },
];

type SignalKey = "trunk" | "ankle";
// Column indices are 0-based; file column 1 is the time stamp, so trunk vertical is file column 9.
const SIGNALS: { key: SignalKey; title: string; column: number }[] = [
  { key: "trunk", title: "TRUNK vertical (file column 9)", column: 8 },
  { key: "ankle", title: "ANKLE vertical (file column 3, reference row)", column: 2 },
];
const COL_ANN = 10; // file column 11

interface Run {
  name: string;
  subject: string;
  ann: Uint8Array;
  acc: Record<SignalKey, Float64Array>; // m/s^2
  ann1Samples: number;
  timeDeviating: number; // rows whose time stamp is off the 64 Hz grid by more than 1 ms
}

interface Win {
  run: number; // index into the subject's runs
  seg: number; // contiguous annotation != 0 segment, unique within the subject
  end: number; // sample index of the window's last sample, within its run
  fi: number;
  pow: number; // totalPower
  loco: number; // 0.5-3 Hz band power = totalPower / (1 + FI); NaN for the FI = 99 sentinel
  prev: number; // index of the window ending 4 s earlier in the same segment, or -1
  label: 1 | 2; // annotation at the window end (the window's label time)
  away: boolean; // end time is at least 2 s from every freeze episode of its run
}

interface Episode {
  run: number;
  start: number; // first freeze sample, within its run
  end: number; // last freeze sample, within its run
  wins: number[]; // indices into SubjectSig.wins with end in [start, end + 2 s]
}

interface SubjectSig {
  id: string;
  wins: Win[];
  eps: Episode[];
  ann1Hours: number;
}

interface EvalResult {
  episodes: number;
  detected: number;
  latencies: number[];
  faRuns: number;
  ann1Hours: number;
}

interface Choice {
  fiThr: number;
  powQ: number;
  powThr: number;
  g: number | null;
  trainSens: number;
  trainFaPerH: number;
  trainScore: number;
}

interface FoldResult {
  subject: string;
  choice: Choice;
  r: EvalResult;
}

function loadRuns(): Run[] {
  if (!existsSync(DATA_DIR)) {
    throw new Error(
      `Dataset not found at ${DATA_DIR}. Download https://archive.ics.uci.edu/static/public/245/daphnet+freezing+of+gait.zip and unzip it into eval/data/.`,
    );
  }
  const files = readdirSync(DATA_DIR)
    .filter((f) => /^S\d{2}R\d{2}\.txt$/.test(f))
    .sort();
  if (files.length === 0) throw new Error(`No S??R??.txt files in ${DATA_DIR}`);

  return files.map((file) => {
    const text = readFileSync(join(DATA_DIR, file), "utf8");
    const rows: number[][] = [];
    for (const line of text.split(/\r?\n/)) {
      if (line.trim() === "") continue;
      const vals = line.trim().split(/\s+/).map(Number);
      if (vals.length !== 11 || vals.some((v) => !Number.isFinite(v))) {
        throw new Error(`${file}: malformed row ${rows.length + 1}: "${line}"`);
      }
      rows.push(vals);
    }
    const n = rows.length;
    const ann = new Uint8Array(n);
    const acc = { trunk: new Float64Array(n), ankle: new Float64Array(n) };
    let ann1Samples = 0;
    let timeDeviating = 0;
    const t0 = rows[0][0];
    for (let i = 0; i < n; i++) {
      const r = rows[i];
      const a = r[COL_ANN];
      if (a !== 0 && a !== 1 && a !== 2) throw new Error(`${file}: annotation ${a} at row ${i + 1}`);
      ann[i] = a;
      if (a === 1) ann1Samples++;
      for (const s of SIGNALS) acc[s.key][i] = r[s.column] * MG_TO_MS2;
      if (Math.abs(r[0] - t0 - (i * 1000) / FS) > 1) timeDeviating++;
    }
    return {
      name: file.replace(/\.txt$/, ""),
      subject: file.slice(0, 3),
      ann,
      acc,
      ann1Samples,
      timeDeviating,
    };
  });
}

/** Windows, episodes and the no-freeze distance flags for one subject and one signal. */
function buildSubject(id: string, runs: Run[], key: SignalKey): SubjectSig {
  const wins: Win[] = [];
  const eps: Episode[] = [];
  let ann1Samples = 0;
  let segId = 0;

  runs.forEach((run, r) => {
    const { ann } = run;
    const x = run.acc[key];
    const n = ann.length;
    ann1Samples += run.ann1Samples;
    let i = 0;
    while (i < n) {
      if (ann[i] === 0) {
        i++;
        continue;
      }
      // contiguous segment [i, j) with no annotation 0; windows never cross its edges
      let j = i;
      while (j < n && ann[j] !== 0) j++;

      for (let s = i; s + WIN <= j; s += HOP) {
        const e = s + WIN - 1;
        const fi = freezeIndex(x.subarray(s, s + WIN), FS);
        // freezeIndex = freeze / loco and totalPower = loco + freeze, so loco = totalPower / (1 + FI).
        // The FI = 99 sentinel (loco band empty) breaks this identity, so loco is left NaN there.
        const loco = fi.freezeIndex === 99 ? NaN : fi.totalPower / (1 + fi.freezeIndex);
        wins.push({
          run: r,
          seg: segId,
          end: e,
          fi: fi.freezeIndex,
          pow: fi.totalPower,
          loco,
          prev: -1,
          label: ann[e] === 2 ? 2 : 1,
          away: true,
        });
      }

      let k = i;
      while (k < j) {
        if (ann[k] !== 2) {
          k++;
          continue;
        }
        let m = k;
        while (m + 1 < j && ann[m + 1] === 2) m++;
        eps.push({ run: r, start: k, end: m, wins: [] });
        k = m + 1;
      }
      segId++;
      i = j;
    }
  });

  // Windows of one segment are consecutive with a hop of HOP samples, so the window ending
  // STOP_LAG samples earlier sits STOP_LAG / HOP positions back in the same segment.
  const hopsBack = STOP_LAG / HOP;
  wins.forEach((w, idx) => {
    const p = idx - hopsBack;
    if (p >= 0 && wins[p].seg === w.seg && wins[p].end === w.end - STOP_LAG) w.prev = p;
  });

  for (const w of wins) {
    // "at least 2 s away": distance from end time to the episode interval is >= TOL samples
    w.away = !eps.some((ep) => ep.run === w.run && w.end > ep.start - TOL && w.end < ep.end + TOL);
  }
  for (const ep of eps) {
    wins.forEach((w, idx) => {
      if (w.run === ep.run && w.end >= ep.start && w.end <= ep.end + TOL) ep.wins.push(idx);
    });
  }
  const ann1Hours = ann1Samples / FS / 3600;
  return { id, wins, eps, ann1Hours };
}

/** Detection, latency and false-alarm runs for fixed thresholds (g = null: no stop gate). */
function evaluate(s: SubjectSig, fiThr: number, powThr: number, g: number | null): EvalResult {
  const pos = s.wins.map((w) => {
    let ok = w.fi >= fiThr && w.pow >= powThr;
    if (ok && g !== null) {
      // stop gate: forward progress must have stopped, i.e. loco now <= g x loco 4 s earlier
      ok = w.prev >= 0 && w.loco <= g * s.wins[w.prev].loco;
    }
    return ok;
  });

  let detected = 0;
  const latencies: number[] = [];
  for (const ep of s.eps) {
    const first = ep.wins.find((idx) => pos[idx]);
    if (first !== undefined) {
      detected++;
      latencies.push((s.wins[first].end - ep.start) / FS);
    }
  }

  // A false-alarm run is a maximal block of consecutive positive windows (same segment) in which
  // every window end is at least 2 s from every freeze episode.
  let faRuns = 0;
  let inBlock = false;
  let allAway = true;
  for (let i = 0; i < s.wins.length; i++) {
    const w = s.wins[i];
    if (!pos[i]) {
      if (inBlock && allAway) faRuns++;
      inBlock = false;
      continue;
    }
    const continues = inBlock && i > 0 && pos[i - 1] && s.wins[i - 1].seg === w.seg;
    if (!continues) {
      if (inBlock && allAway) faRuns++;
      inBlock = true;
      allAway = true;
    }
    allAway = allAway && w.away;
  }
  if (inBlock && allAway) faRuns++;

  return { episodes: s.eps.length, detected, latencies, faRuns, ann1Hours: s.ann1Hours };
}

/** Linear-interpolation quantile (type 7) of an ascending-sorted array. */
function quantile(sorted: number[], q: number): number {
  const p = (sorted.length - 1) * q;
  const lo = Math.floor(p);
  const hi = Math.ceil(p);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (p - lo);
}

/** Grid search on the training subjects; ties keep the first combination in grid order. */
function chooseThresholds(train: SubjectSig[], variant: Variant): Choice {
  const pows = train
    .flatMap((s) => s.wins.filter((w) => w.label === 1).map((w) => w.pow))
    .sort((a, b) => a - b);
  const gs: (number | null)[] = variant.gGrid ?? [null];
  let best: Choice | undefined;
  for (const fiThr of variant.fiGrid) {
    for (const powQ of variant.powQ) {
      const powThr = quantile(pows, powQ);
      for (const g of gs) {
        let det = 0;
        let tot = 0;
        let fa = 0;
        let hrs = 0;
        for (const s of train) {
          const r = evaluate(s, fiThr, powThr, g);
          det += r.detected;
          tot += r.episodes;
          fa += r.faRuns;
          hrs += r.ann1Hours;
        }
        const sens = tot > 0 ? det / tot : 0;
        const faPerH = hrs > 0 ? fa / hrs : 0;
        const score = sens - FA_WEIGHT * faPerH;
        if (best === undefined || score > best.trainScore) {
          best = { fiThr, powQ, powThr, g, trainSens: sens, trainFaPerH: faPerH, trainScore: score };
        }
      }
    }
  }
  if (best === undefined) throw new Error("empty threshold grid");
  return best;
}

function leaveOneSubjectOut(subjects: SubjectSig[], variant: Variant): FoldResult[] {
  return subjects.map((held, h) => {
    const train = subjects.filter((_, k) => k !== h);
    const choice = chooseThresholds(train, variant);
    return { subject: held.id, choice, r: evaluate(held, choice.fiThr, choice.powThr, choice.g) };
  });
}

/** Rank-based (Mann-Whitney) AUC with average ranks for ties. */
function rocAuc(scores: number[], positive: boolean[]): number {
  const order = scores.map((_, i) => i).sort((a, b) => scores[a] - scores[b]);
  let rankSumPos = 0;
  let nPos = 0;
  let nNeg = 0;
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && scores[order[j + 1]] === scores[order[i]]) j++;
    const avgRank = (i + j) / 2 + 1; // 1-based ranks
    for (let k = i; k <= j; k++) {
      if (positive[order[k]]) rankSumPos += avgRank;
    }
    i = j + 1;
  }
  for (const p of positive) {
    if (p) nPos++;
    else nNeg++;
  }
  const u = rankSumPos - (nPos * (nPos + 1)) / 2;
  return u / (nPos * nNeg);
}

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function fmt(x: number, digits = 2): string {
  return Number.isFinite(x) ? x.toFixed(digits) : "n/a";
}

function pct(x: number): string {
  return Number.isFinite(x) ? `${(100 * x).toFixed(1)}%` : "n/a";
}

interface Pooled {
  episodes: number;
  detected: number;
  sens: number;
  medianLatency: number;
  fa: number;
  hrs: number;
  faPerH: number;
  objective: number;
}

function pool(folds: FoldResult[]): Pooled {
  const episodes = folds.reduce((a, f) => a + f.r.episodes, 0);
  const detected = folds.reduce((a, f) => a + f.r.detected, 0);
  const fa = folds.reduce((a, f) => a + f.r.faRuns, 0);
  const hrs = folds.reduce((a, f) => a + f.r.ann1Hours, 0);
  const sens = episodes > 0 ? detected / episodes : 0;
  const faPerH = fa / hrs;
  return {
    episodes,
    detected,
    sens,
    medianLatency: median(folds.flatMap((f) => f.r.latencies)),
    fa,
    hrs,
    faPerH,
    objective: sens - FA_WEIGHT * faPerH,
  };
}

/** "5 x9, 1 x1" style count of chosen values, in ascending numeric order. */
function countBy(values: number[]): string {
  const m = new Map<number, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([k, c]) => `${k} x${c}`)
    .join(", ");
}

function thresholdSummary(folds: FoldResult[], gated: boolean): string {
  const fi = countBy(folds.map((f) => f.choice.fiThr));
  const q = countBy(folds.map((f) => f.choice.powQ));
  let s = `thrFI ${fi}; thrPow q ${q}`;
  if (gated) s += `; g ${countBy(folds.map((f) => f.choice.g as number))}`;
  return s;
}

function renderPerSubject(folds: FoldResult[], gated: boolean): string[] {
  const lines: string[] = [];
  lines.push(
    "| Held-out subject | Episodes | Detected | Median latency (s) | FA runs | Ann-1 hours | FA/h | thrFI | thrPow (quantile, value) | g |",
    "|---|---|---|---|---|---|---|---|---|---|",
  );
  for (const f of folds) {
    const c = f.choice;
    lines.push(
      `| ${f.subject} | ${f.r.episodes} | ${f.r.detected} | ${fmt(median(f.r.latencies))} | ${f.r.faRuns} | ${fmt(f.r.ann1Hours, 2)} | ${fmt(f.r.faRuns / f.r.ann1Hours)} | ${c.fiThr} | q${c.powQ} (${c.powThr.toPrecision(3)}) | ${gated ? String(c.g) : "-"} |`,
    );
  }
  const p = pool(folds);
  lines.push(
    `| **Pooled** | **${p.episodes}** | **${p.detected}** | **${fmt(p.medianLatency)}** | **${p.fa}** | **${fmt(p.hrs)}** | **${fmt(p.faPerH)}** | | | |`,
    "",
  );
  return lines;
}

function main(): void {
  const runs = loadRuns();
  const ids = [...new Set(runs.map((r) => r.subject))].sort();
  const totalSamples = runs.reduce((a, r) => a + r.ann.length, 0);
  const ann2Samples = runs.reduce((a, r) => a + r.ann.reduce((b, v) => b + (v === 2 ? 1 : 0), 0), 0);
  const ann1Hours = runs.reduce((a, r) => a + r.ann1Samples, 0) / FS / 3600;
  const timeDeviating = runs.reduce((a, r) => a + r.timeDeviating, 0);
  const subjectRuns = (id: string) => runs.filter((r) => r.subject === id);

  const perSignal = SIGNALS.map((sig) => {
    const subjects = ids.map((id) => buildSubject(id, subjectRuns(id), sig.key));
    const allWins = subjects.flatMap((s) => s.wins);
    const auc = rocAuc(
      allWins.map((w) => w.fi),
      allWins.map((w) => w.label === 2),
    );
    const variants = VARIANTS.map((variant) => {
      const folds = leaveOneSubjectOut(subjects, variant);
      return { variant, folds, pooled: pool(folds) };
    });
    // Best variant for this signal: highest pooled held-out objective (first one on ties).
    const best = variants.reduce((b, v) => (v.pooled.objective > b.pooled.objective ? v : b));
    return {
      sig,
      subjects,
      auc,
      sentinel: allWins.filter((w) => Number.isNaN(w.loco)).length,
      noPrev: allWins.filter((w) => w.prev < 0).length,
      variants,
      best,
    };
  });

  const subjectsRef = perSignal[0].subjects;
  const episodes = subjectsRef.reduce((a, s) => a + s.eps.length, 0);
  const zeroEpisodeSubjects = subjectsRef.filter((s) => s.eps.length === 0).map((s) => s.id);
  const windowsTotal = subjectsRef.reduce((a, s) => a + s.wins.length, 0);

  const L: string[] = [];
  L.push(
    "# Freeze-of-gait detector on the Daphnet dataset: leave-one-subject-out evaluation",
    "",
    `Date: ${RESULTS_DATE}`,
    "",
    "Detector: `freezeIndex()` from `Core/FreezeIndex.ts` (FI = power 3-8 Hz / power 0.5-3 Hz of a mean-removed, Hann-tapered window; totalPower = power 0.5-8 Hz). Windows: 4 s (256 samples) at 64 Hz, 0.5 s hop.",
    "",
    "Dataset: Daphnet Freezing of Gait, UCI ML repository id 245, CC BY 4.0, DOI 10.24432/C56K78. Download: https://archive.ics.uci.edu/static/public/245/daphnet+freezing+of+gait.zip (extracted to `eval/data/dataset_fog_release/`, gitignored).",
    "",
    "Citation: Bachlin et al. 2010, \"Wearable assistant for Parkinson's disease patients with the freezing of gait symptom\", IEEE Transactions on Information Technology in Biomedicine (TITB).",
    "",
    "## Dataset check",
    "",
    `- Runs: ${runs.length} files across ${ids.length} subjects (${ids.join(", ")}); samples: ${totalSamples}; annotation-1 time: ${fmt(ann1Hours)} h; annotation-2 samples: ${ann2Samples}.`,
    `- Freeze episodes (maximal runs of annotation 2 within a run): **${episodes}**. Reference count: ${REFERENCE_EPISODES}. Difference: ${episodes - REFERENCE_EPISODES}.`,
    `- Subjects with zero freeze episodes: ${zeroEpisodeSubjects.join(", ") || "none"} (counted in false alarms only).`,
    `- Rows whose time stamp is more than 1 ms off the 64 Hz grid: ${timeDeviating}. Timing uses sample index / 64 Hz.`,
    `- Windows per signal: ${windowsTotal}. Windows with no window 4 s earlier in the segment (stop gate cannot pass): ${perSignal[0].noPrev}. FI = 99 sentinel windows (loco band empty): ${perSignal.map((p) => `${p.sig.key} ${p.sentinel}`).join(", ")}.`,
    "",
    "## Pooled results (leave-one-subject-out, all variants)",
    "",
    "| Signal | Variant | Episodes | Detected | Sensitivity | Median latency (s) | FA runs | Ann-1 hours | FA/h | Objective (sens - 0.02 FA/h) | Window AUC (FI) | Chosen thresholds (per held-out fold) | Best for signal |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  );
  for (const p of perSignal) {
    for (const v of p.variants) {
      const pl = v.pooled;
      const isBest = v === p.best ? "yes" : "";
      L.push(
        `| ${p.sig.title} | ${v.variant.name} | ${pl.episodes} | ${pl.detected} | ${pct(pl.sens)} | ${fmt(pl.medianLatency)} | ${pl.fa} | ${fmt(pl.hrs)} | ${fmt(pl.faPerH)} | ${fmt(pl.objective, 3)} | ${p.auc.toFixed(3)} | ${thresholdSummary(v.folds, v.variant.gGrid !== null)} | ${isBest} |`,
      );
    }
  }
  L.push(
    "",
    "Best variant per signal = highest pooled held-out objective in this table. Window AUC uses raw FI and does not depend on the variant.",
    "",
    "## Per held-out subject (best variant per signal)",
    "",
  );
  for (const p of perSignal) {
    L.push(
      `### ${p.sig.title}: variant "${p.best.variant.name}"`,
      "",
      ...renderPerSubject(p.best.folds, p.best.variant.gGrid !== null),
      `Pooled sensitivity ${pct(p.best.pooled.sens)} (${p.best.pooled.detected}/${p.best.pooled.episodes}); window-level AUC of FI, freeze vs non-freeze windows, pooled over all ${p.subjects.length} subjects: ${p.auc.toFixed(3)}.`,
      "",
    );
  }

  L.push(
    "## Method notes",
    "",
    "- Signal: vertical acceleration in mg converted to m/s^2 (x 0.00980665). Trunk is the primary signal; ankle vertical is a reference row run through the identical pipeline.",
    "- Annotation 0 samples are dropped; each run is split into contiguous segments and no window crosses a gap. Windows are labelled by the annotation at their last sample (window end). Windows ending on annotation 2 are freeze windows, on annotation 1 non-freeze windows.",
    "- Episode: maximal run of annotation-2 samples within one recording. Detected if any window whose end lies in [episode start, episode end + 2 s] is positive. Latency = first such positive window end minus episode start.",
    "- Positive window, FI alone: FI >= thrFI and totalPower >= thrPow. thrPow is the type-7 quantile of totalPower over annotation-1 windows pooled across the training subjects.",
    "- Variant \"FI alone\": thrFI in {1, 1.5, 2, 2.5, 3, 4, 5}, q in {0.1, 0.25, 0.5}.",
    "- Variant \"FI alone, wide grid\": thrFI in {1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 15}, q in {0.1, 0.25, 0.5, 0.75, 0.9}.",
    "- Variant \"FI + stop gate\": wide grids as above, plus a positive window must also satisfy loco(window) <= g x loco(window ending 4 s earlier, same segment), g in {0.25, 0.5, 0.75}. loco is the 0.5-3 Hz band power, computed as totalPower / (1 + FI), which is exact because FI = freeze / loco and totalPower = loco + freeze. A window with no window 4 s earlier in its segment cannot pass the gate. Windows with the FI = 99 sentinel have loco set to NaN and cannot pass the gate.",
    "- Threshold choice (all variants): maximise pooled training sensitivity - 0.02 x pooled training FA/h over the variant's grid; ties keep the first combination in grid order (thrFI, then q, then g). The chosen combination is applied to the held-out subject.",
    "- Best variant per signal: highest pooled held-out objective (sensitivity - 0.02 x FA/h) over the 10 folds. Per-subject tables are shown for that variant only.",
    "- False alarm: maximal block of consecutive positive windows (same segment) in which every window end is at least 2 s from every freeze episode of its recording (distance < 2 s counts as near; exactly 2 s counts as away). A block that contains any near window is not counted. Ann-1 hours = annotation-1 sample count / 64 / 3600.",
    "- AUC: rank-based (Mann-Whitney) AUC of raw FI for annotation-2 windows vs annotation-1 windows, pooled over all subjects; no threshold involved.",
    "- Subjects with zero freeze episodes are used as test folds: they add to pooled FA counts and ann-1 hours but not to episodes.",
    "",
  );

  const markdown = L.join("\n");
  writeFileSync(RESULTS_PATH, markdown + "\n", "utf8");
  console.log(markdown);
}

main();
