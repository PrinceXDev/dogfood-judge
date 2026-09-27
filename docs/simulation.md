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

40 projects, 30 judges, Bradley-Terry ground truth (strength SD 1.2).

| Comparisons | Adaptive tau | Random tau | Adaptive top-5 | Random top-5 |
|---:|---:|---:|---:|---:|
| 80 | 0.498 | 0.461 | 46.6% | 45.8% |
| 160 | 0.624 | 0.571 | 59.0% | 54.0% |
| 320 | 0.735 | 0.702 | 68.8% | 67.8% |
| 640 | 0.805 | 0.784 | 77.6% | 73.6% |
