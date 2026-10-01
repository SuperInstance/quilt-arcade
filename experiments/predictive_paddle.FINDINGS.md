# PREDICTIVE PADDLE — FINDINGS (measured run, sealed FAIL)

**Runner:** `experiments/predictive_paddle.mjs` · **Receipt:** `experiments/predictive_paddle_receipt.json`
**Pre-registration:** `experiments/predictive_paddle.PREREG.md` (commit `c3deef2`, sealed before run)
**Verdict: FAIL** — H1 ✗, H2 ✗, H3 ✓, H4 ✓, H5 ✓, determinism ✓. No goalpost moves; this file explains the measured mechanisms with trace excerpts.

## What was measured

50 seeded matches per arm (seeds 1..50), reactive control game for M1 estimation
quality; M2 = advisory A/B (attractor advises left paddle when certain AND ball
approaching; honest reactive fallback otherwise). Receipt chain: 3,585 rows,
re-derived from GENESIS (fnv1a-64, kit canon).

## Headline numbers

| Metric | Value |
|---|---|
| H1 capture ≤12 ticks (left-bound serves) | **20.8%** (5/24) — gate ≥90% FAIL |
| H1 all-serve rate (transparency) | 11.4% (5/44) |
| H2 re-capture ≤2 events after own-return | **14.0%** (8/57) — gate 100% FAIL |
| Between-event hold error | mean **17.46**, max 58.10 (n=18,375) |
| ψ census (50 matches) | commit 1,605 / reject 72 / abstain 1,858 |
| Events per match | min 28 / med 70 / max 148 |
| M2 control win-rate (reactive 0.85 vs 0.70) | 86.0% |
| M2 advisory win-rate | **94.0%** — H3 ✓ (non-inferiority), H4 ✓ (≥55%) |
| Advisory mode share / fallback share | 3.2% / 9.7% (H5 ✓ ≥1%, census complete) |
| Determinism (M1 seeds 1–3 twice) | identical chain head ✓ |

## Root cause of H1/H2: standing-mass dilution under sparse events

Trace excerpt (seed 1), the first right-return commit of the match:

```json
{"tick":155,"feed":{"kind":"return","side":"right"},"psi":1,"y_at":26.13,
 "readout":0.53,"err2":25.60,"mass":5.05}
```

The ring had accumulated standing mass ≈5 from prior commits. The sealed flycx
v2 constants inject `GAIN=0.15` per commit while `EVENT_DECAY=0.85` removes only
15% of standing mass — steady-state mass ≈ Σtaper/(1−DECAY) ≈ 12. Each commit
therefore moves the circular mean by only ≈ `GAIN·err/mass ≈ 0.15·25/5 ≈ 0.8`
units, and measured decay per commit on mass ≈11 is a factor ~0.75/err
(ticks 876→903→941: readout 34.79→30.84→27.38 toward true 18.83).

**Convergence arithmetic:** from a 25-unit error at 0.75/event, reaching the
1.5 deadzone takes ≈ `ln(1.5/25)/ln(0.75)` ≈ **9 commit events**. A pong
approach phase contains **1–4 events** (walls are not guaranteed — a shallow
vy crosses the field without touching y=1/y=59; tick 155→253 is a 98-tick
approach with zero events). H1's ≤12-tick window and H2's ≤2-event window are
structurally unreachable under the sealed constants. The between-event hold
error mean of 17.46 is the same mechanism: the estimator holds a diluted,
stale estimate across whole approach phases.

This is a **port-cadence mismatch, not a flycx defect**: in the sealed
chiaroscuro model, ring decay ran per PING (per-step, τ=0.35) while cues were
comparatively dense; ported 1:1 to event cadence, history outweighs evidence.

## Why the advisory still wins (H3/H4) despite non-convergence

When `certain` fires (right after commits, before `A_eff = A·0.98^Δ` collapses
— events are 40–100 ticks apart, so 0.98^Δ ≈ 0.13–0.36), the readout is a
*recent projection* — roughly the intercept region, ±5–10 units. Aiming at the
intercept even imprecely beats chasing `ball.y` when the ball moves up to
2.6/tick against a 0.85/tick paddle: the paddle pre-positions instead of
following. Value came from **predictive aim**, not estimator accuracy — the
receipt separates these honestly. At 3.2% advisory share the lift was +8 pts;
a convergent estimator with higher certain-share is the v2 promise.

## Honest limits

- **Prereg errata (no goalpost moves):** H1 reported on left-bound serves
  (right-bound serves are away-abstains by the projection contract; both rates
  in receipt). Own-return events arrive with vx>0, so they take the abstain
  branch; ψ=−1 fires only on >45°-conflict-with-certainty (72 events did).
- **Oracle = same closed-form projection from live state** (identical formula,
  documented in prereg); the estimator only sees post-event states.
- Wall detection uses the reflection invariant (vy flips, |vy| preserved);
  `rules.fired` is a cumulative ledger (W2 reads it as history) and cannot
  detect per-tick wall hits — documented in the runner header.
- Pin 3 bounds discretization (half-bin = 60/32/2 = 0.9375), not convergence.

## Next: v2 (new pre-registration required)

Sealed proposal in `experiments/predictive_paddle_v2.PREREG.md`: error-scaled
pull — on commit, `w = max(GAIN, err/halfField)·(1−A_eff)`, `ring = ring·(1−w)
+ w·bump(target)` — dilution-proof by construction (a 25-unit error pulls
≥0.42/event), ternary ψ and anti-thrash preserved, H1–H5 bars unchanged.
This v1 receipt rides along as failure history.
