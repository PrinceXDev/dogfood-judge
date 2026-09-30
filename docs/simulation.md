# Monte Carlo validation on the fixture's review graph

Every trial draws true project quality, judge leniency, judge scale use and noise; generates integer criterion scores through the *exact* judge-project graph of fixtures.json (126 reviews, same unfinished batches); then asks each method to recover the true ranking. 1000 trials per scenario, fixed seeds.

## Baseline (leniency SD 0.45, scale SD 0.35, 1 in 30 judges flat, noise 0.6)

| Method | Kendall tau vs truth (mean ± SD) | True top-5 recovered | Mean abs rank error | Beats raw mean in |
|---|---:|---:|---:|---:|
| raw | 0.677 ± 0.068 | 61.6% | 4.97 | 0% of trials |
| zscore | 0.629 ± 0.064 | 55.6% | 5.50 | 24% of trials |
| bias | 0.707 ± 0.059 | 64.7% | 4.41 | 81% of trials |
| biasscale | 0.713 ± 0.059 | 66.0% | 4.31 | 83% of trials |
| pairwise | 0.635 ± 0.067 | 56.8% | 5.42 | 27% of trials |

## No judge effects at all (the null case: does normalizing hurt?)

| Method | Kendall tau vs truth (mean ± SD) | True top-5 recovered | Mean abs rank error | Beats raw mean in |
|---|---:|---:|---:|---:|
| raw | 0.781 ± 0.043 | 73.3% | 3.53 | 0% of trials |
| zscore | 0.642 ± 0.062 | 58.9% | 5.32 | 0% of trials |
| bias | 0.769 ± 0.044 | 73.5% | 3.52 | 5% of trials |
| biasscale | 0.765 ± 0.044 | 72.7% | 3.58 | 9% of trials |
| pairwise | 0.659 ± 0.062 | 61.0% | 5.10 | 0% of trials |

## Strong leniency differences (SD 0.8)

| Method | Kendall tau vs truth (mean ± SD) | True top-5 recovered | Mean abs rank error | Beats raw mean in |
|---|---:|---:|---:|---:|
| raw | 0.567 ± 0.090 | 51.5% | 6.50 | 0% of trials |
| zscore | 0.622 ± 0.062 | 52.9% | 5.60 | 72% of trials |
| bias | 0.676 ± 0.066 | 61.2% | 4.85 | 98% of trials |
| biasscale | 0.683 ± 0.066 | 61.8% | 4.75 | 98% of trials |
| pairwise | 0.631 ± 0.067 | 54.8% | 5.49 | 76% of trials |

## Heavy scale differences (SD 0.6) and 10% flat judges

| Method | Kendall tau vs truth (mean ± SD) | True top-5 recovered | Mean abs rank error | Beats raw mean in |
|---|---:|---:|---:|---:|
| raw | 0.650 ± 0.076 | 57.6% | 5.33 | 0% of trials |
| zscore | 0.602 ± 0.069 | 51.5% | 5.88 | 25% of trials |
| bias | 0.677 ± 0.067 | 59.2% | 4.83 | 79% of trials |
| biasscale | 0.695 ± 0.066 | 62.5% | 4.57 | 87% of trials |
| pairwise | 0.599 ± 0.080 | 52.6% | 5.92 | 25% of trials |

## Very noisy judges (noise 1.0)

| Method | Kendall tau vs truth (mean ± SD) | True top-5 recovered | Mean abs rank error | Beats raw mean in |
|---|---:|---:|---:|---:|
| raw | 0.603 ± 0.074 | 55.1% | 5.99 | 0% of trials |
| zscore | 0.545 ± 0.073 | 49.4% | 6.66 | 18% of trials |
| bias | 0.614 ± 0.072 | 57.0% | 5.73 | 65% of trials |
| biasscale | 0.615 ± 0.072 | 57.3% | 5.69 | 63% of trials |
| pairwise | 0.534 ± 0.078 | 49.5% | 6.81 | 15% of trials |

## Pairwise mode: adaptive vs random pair selection

40 projects, 30 judges, Bradley-Terry ground truth (strength SD 1.2). *Adaptive* is the live rule (outcome uncertainty p(1-p), damped by comparison counts; a judge's previous projects are kept out of their next pair). *Variance* picks the pair with the largest expected drop in SE_a² + SE_b². It ships only if it matches or beats adaptive at every budget.

| Comparisons | Adaptive tau | Variance tau | Random tau | Adaptive top-5 | Variance top-5 | Random top-5 |
|---:|---:|---:|---:|---:|---:|---:|
| 80 | 0.481 | 0.446 | 0.466 | 47.0% | 45.8% | 43.8% |
| 160 | 0.623 | 0.584 | 0.583 | 60.4% | 60.2% | 56.6% |
| 320 | 0.731 | 0.708 | 0.702 | 67.6% | 70.2% | 67.0% |
| 640 | 0.804 | 0.806 | 0.779 | 75.6% | 80.2% | 73.6% |

Variance-based selection does not match the live rule at every budget, so the live rule stays the default.

## Pairwise ties: half a win vs the Davidson model vs Elo

20 projects, random pairs, Davidson ground truth with nu = 0.8 (evenly matched projects tie 29% of the time). *Half-win* is the live ranking; *Davidson* models ties; *Elo* (K = 32) is averaged over random orders of the same verdicts. The last column is how often Davidson's 90% interval for nu covers the truth.

| Comparisons | Ties | Half-win tau | Davidson tau | Elo tau | Mean nu | nu covered |
|---:|---:|---:|---:|---:|---:|---:|
| 60 | 24% | 0.511 | 0.512 | 0.510 | 0.81 | 94% |
| 120 | 24% | 0.619 | 0.619 | 0.610 | 0.80 | 93% |
| 240 | 24% | 0.731 | 0.730 | 0.727 | 0.80 | 91% |
| 480 | 24% | 0.803 | 0.803 | 0.801 | 0.80 | 90% |

## Judge fatigue: drift check

40 projects, 12 judges writing their reviews in random order. In every world one judge gives a constant score for their second half (flattening) and one triples their noise for it (erratic); the rest never change. Each check is a permutation test at 2.5% per tail.

| Reviews per judge | Honest judges | False flags | Flattening caught | Erratic caught |
|---:|---:|---:|---:|---:|
| 8 | 2000 | 3.6% | 98% | 8% |
| 10 | 2000 | 3.8% | 99% | 14% |
| 16 | 2000 | 4.8% | 100% | 46% |
| 24 | 2000 | 4.7% | 100% | 67% |

## Review-count learning curve: is "settled" calibrated?

48 synthetic events: 20 projects, 12 judges (leniency SD 0.4, quality SD 0.8), 2, 4 or 8 reviews per project, noise 0.3 or 1.0, 8 events per cell. "Settled" means that with 20% of reviews removed, top-10 tau >= 0.9 and the same top 3 in >= 80% of 40 refits. *Right* means the full-data top 3 equals the planted top 3.

| Verdict | Events | Top 3 right |
|---|---:|---:|
| Settled | 6 | 100% |
| Still moving | 42 | 43% |

The verdict is conservative: it seldom says settled, and when it does it is right. Reproduce with `go test ./src/judging -run ConvergenceVerdictIsCalibrated -v`.
