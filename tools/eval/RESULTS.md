# Freeze-of-gait detector on the Daphnet dataset: leave-one-subject-out evaluation

Date: 2026-10-15

Detector: `freezeIndex()` from `Core/FreezeIndex.ts` (FI = power 3-8 Hz / power 0.5-3 Hz of a mean-removed, Hann-tapered window; totalPower = power 0.5-8 Hz). Windows: 4 s (256 samples) at 64 Hz, 0.5 s hop.

Dataset: Daphnet Freezing of Gait, UCI ML repository id 245, CC BY 4.0, DOI 10.24432/C56K78. Download: https://archive.ics.uci.edu/static/public/245/daphnet+freezing+of+gait.zip (extracted to `eval/data/dataset_fog_release/`, gitignored).

Citation: Bachlin et al. 2010, "Wearable assistant for Parkinson's disease patients with the freezing of gait symptom", IEEE Transactions on Information Technology in Biomedicine (TITB).

## Dataset check

- Runs: 17 files across 10 subjects (S01, S02, S03, S04, S05, S06, S07, S08, S09, S10); samples: 1917887; annotation-1 time: 4.47 h; annotation-2 samples: 110785.
- Freeze episodes (maximal runs of annotation 2 within a run): **237**. Reference count: 237. Difference: 0.
- Subjects with zero freeze episodes: S04, S10 (counted in false alarms only).
- Rows whose time stamp is more than 1 ms off the 64 Hz grid: 0. Timing uses sample index / 64 Hz.
- Windows per signal: 35405. Windows with no window 4 s earlier in the segment (stop gate cannot pass): 280. FI = 99 sentinel windows (loco band empty): trunk 0, ankle 0.

## Pooled results (leave-one-subject-out, all variants)

| Signal | Variant | Episodes | Detected | Sensitivity | Median latency (s) | FA runs | Ann-1 hours | FA/h | Objective (sens - 0.02 FA/h) | Window AUC (FI) | Chosen thresholds (per held-out fold) | Best for signal |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TRUNK vertical (file column 9) | FI alone | 237 | 175 | 73.8% | 0.48 | 511 | 4.47 | 114.30 | -1.548 | 0.684 | thrFI 1 x1, 5 x9; thrPow q 0.5 x10 |  |
| TRUNK vertical (file column 9) | FI alone, wide grid | 237 | 45 | 19.0% | 2.22 | 26 | 4.47 | 5.82 | 0.074 | 0.684 | thrFI 15 x10; thrPow q 0.75 x1, 0.9 x9 | yes |
| TRUNK vertical (file column 9) | FI + stop gate | 237 | 32 | 13.5% | 3.02 | 20 | 4.47 | 4.47 | 0.046 | 0.684 | thrFI 15 x10; thrPow q 0.75 x8, 0.9 x2; g 0.5 x1, 0.75 x9 |  |
| ANKLE vertical (file column 3, reference row) | FI alone | 237 | 137 | 57.8% | 1.98 | 118 | 4.47 | 26.39 | 0.050 | 0.742 | thrFI 5 x10; thrPow q 0.5 x10 |  |
| ANKLE vertical (file column 3, reference row) | FI alone, wide grid | 237 | 82 | 34.6% | 1.63 | 31 | 4.47 | 6.93 | 0.207 | 0.742 | thrFI 2.5 x1, 3 x8, 4 x1; thrPow q 0.75 x10 | yes |
| ANKLE vertical (file column 3, reference row) | FI + stop gate | 237 | 77 | 32.5% | 3.64 | 33 | 4.47 | 7.38 | 0.177 | 0.742 | thrFI 8 x2, 10 x8; thrPow q 0.5 x10; g 0.5 x9, 0.75 x1 |  |

Best variant per signal = highest pooled held-out objective in this table. Window AUC uses raw FI and does not depend on the variant.

## Per held-out subject (best variant per signal)

### TRUNK vertical (file column 9): variant "FI alone, wide grid"

| Held-out subject | Episodes | Detected | Median latency (s) | FA runs | Ann-1 hours | FA/h | thrFI | thrPow (quantile, value) | g |
|---|---|---|---|---|---|---|---|---|---|
| S01 | 23 | 13 | 2.14 | 11 | 0.50 | 22.06 | 15 | q0.9 (92.5) | - |
| S02 | 24 | 8 | 4.38 | 0 | 0.34 | 0.00 | 15 | q0.9 (102) | - |
| S03 | 49 | 24 | 1.39 | 6 | 0.48 | 12.53 | 15 | q0.9 (120) | - |
| S04 | 0 | 0 | n/a | 0 | 0.58 | 0.00 | 15 | q0.9 (133) | - |
| S05 | 66 | 0 | n/a | 1 | 0.45 | 2.23 | 15 | q0.9 (128) | - |
| S06 | 10 | 0 | n/a | 8 | 0.52 | 15.50 | 15 | q0.75 (53.5) | - |
| S07 | 24 | 0 | n/a | 0 | 0.42 | 0.00 | 15 | q0.9 (126) | - |
| S08 | 14 | 0 | n/a | 0 | 0.16 | 0.00 | 15 | q0.9 (122) | - |
| S09 | 27 | 0 | n/a | 0 | 0.41 | 0.00 | 15 | q0.9 (129) | - |
| S10 | 0 | 0 | n/a | 0 | 0.62 | 0.00 | 15 | q0.9 (133) | - |
| **Pooled** | **237** | **45** | **2.22** | **26** | **4.47** | **5.82** | | | |

Pooled sensitivity 19.0% (45/237); window-level AUC of FI, freeze vs non-freeze windows, pooled over all 10 subjects: 0.684.

### ANKLE vertical (file column 3, reference row): variant "FI alone, wide grid"

| Held-out subject | Episodes | Detected | Median latency (s) | FA runs | Ann-1 hours | FA/h | thrFI | thrPow (quantile, value) | g |
|---|---|---|---|---|---|---|---|---|---|
| S01 | 23 | 9 | 1.83 | 5 | 0.50 | 10.03 | 3 | q0.75 (466) | - |
| S02 | 24 | 9 | 3.66 | 1 | 0.34 | 2.92 | 3 | q0.75 (475) | - |
| S03 | 49 | 36 | 0.42 | 10 | 0.48 | 20.89 | 3 | q0.75 (539) | - |
| S04 | 0 | 0 | n/a | 1 | 0.58 | 1.74 | 3 | q0.75 (561) | - |
| S05 | 66 | 17 | 3.17 | 2 | 0.45 | 4.46 | 4 | q0.75 (508) | - |
| S06 | 10 | 0 | n/a | 1 | 0.52 | 1.94 | 3 | q0.75 (509) | - |
| S07 | 24 | 1 | 3.41 | 0 | 0.42 | 0.00 | 3 | q0.75 (565) | - |
| S08 | 14 | 0 | n/a | 0 | 0.16 | 0.00 | 3 | q0.75 (542) | - |
| S09 | 27 | 10 | 2.38 | 1 | 0.41 | 2.45 | 3 | q0.75 (511) | - |
| S10 | 0 | 0 | n/a | 10 | 0.62 | 16.14 | 2.5 | q0.75 (483) | - |
| **Pooled** | **237** | **82** | **1.63** | **31** | **4.47** | **6.93** | | | |

Pooled sensitivity 34.6% (82/237); window-level AUC of FI, freeze vs non-freeze windows, pooled over all 10 subjects: 0.742.

## Method notes

- Signal: vertical acceleration in mg converted to m/s^2 (x 0.00980665). Trunk is the primary signal; ankle vertical is a reference row run through the identical pipeline.
- Annotation 0 samples are dropped; each run is split into contiguous segments and no window crosses a gap. Windows are labelled by the annotation at their last sample (window end). Windows ending on annotation 2 are freeze windows, on annotation 1 non-freeze windows.
- Episode: maximal run of annotation-2 samples within one recording. Detected if any window whose end lies in [episode start, episode end + 2 s] is positive. Latency = first such positive window end minus episode start.
- Positive window, FI alone: FI >= thrFI and totalPower >= thrPow. thrPow is the type-7 quantile of totalPower over annotation-1 windows pooled across the training subjects.
- Variant "FI alone": thrFI in {1, 1.5, 2, 2.5, 3, 4, 5}, q in {0.1, 0.25, 0.5}.
- Variant "FI alone, wide grid": thrFI in {1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 15}, q in {0.1, 0.25, 0.5, 0.75, 0.9}.
- Variant "FI + stop gate": wide grids as above, plus a positive window must also satisfy loco(window) <= g x loco(window ending 4 s earlier, same segment), g in {0.25, 0.5, 0.75}. loco is the 0.5-3 Hz band power, computed as totalPower / (1 + FI), which is exact because FI = freeze / loco and totalPower = loco + freeze. A window with no window 4 s earlier in its segment cannot pass the gate. Windows with the FI = 99 sentinel have loco set to NaN and cannot pass the gate.
- Threshold choice (all variants): maximise pooled training sensitivity - 0.02 x pooled training FA/h over the variant's grid; ties keep the first combination in grid order (thrFI, then q, then g). The chosen combination is applied to the held-out subject.
- Best variant per signal: highest pooled held-out objective (sensitivity - 0.02 x FA/h) over the 10 folds. Per-subject tables are shown for that variant only.
- False alarm: maximal block of consecutive positive windows (same segment) in which every window end is at least 2 s from every freeze episode of its recording (distance < 2 s counts as near; exactly 2 s counts as away). A block that contains any near window is not counted. Ann-1 hours = annotation-1 sample count / 64 / 3600.
- AUC: rank-based (Mann-Whitney) AUC of raw FI for annotation-2 windows vs annotation-1 windows, pooled over all subjects; no threshold involved.
- Subjects with zero freeze episodes are used as test folds: they add to pooled FA counts and ann-1 hours but not to episodes.

