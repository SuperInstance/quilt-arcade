# PRE-REGISTRATION — predictive paddle v2: error-scaled pull (sparse-cadence fix)

**Status: SEALED before any v2 measured run. Seed 20261001. Kill R8 (15 min).**
**Failure history:** v1 (`predictive_paddle.FINDINGS.md`, same PR) sealed FAIL on
H1/H2 with the dilution mechanism measured: standing mass ≈12 vs per-event
injection 0.15 → ~0.75 err factor/commit → 9 events to converge, while pong
approach phases carry 1–4 events. v2 changes ONLY the commit write rule.

## The one-line delta vs sealed v1

v1 commit write: `ring[i] = ring[i]·0.85 + 0.15·taper_i`  (history outweighs evidence)

v2 commit write: `w = max(0.15, err/halfField)·(1−A_eff);  ring = ring·(1−w) + w·bump(target)`

where `err` = circular readout-to-cue distance in field units, `halfField` = 30,
`bump(target)` = the cos² taper column (sums to ≈1 across bins), everything else
byte-identical: abstain/reject branches, A dynamics, projection cell, ring size,
constants A0/GAIN/SHRINK/CERT_DECAY, receipt schema, event contract.

## Why this is the faithful flycx repair, not a new model

The fly's PING-decay cadence hid the dilution: frequent decay kept standing mass
low relative to cue injections. At event cadence the same guarantee must come
from the pull weight itself. `w` is exactly the certainty-gated capture the v1
prereg intended ("magnitude 0.15·(1−A_eff)") with the missing term restored:
capture strength scales with **evidence conflict** (err/halfField), so a
strongly contradicting cue re-weights the ring in O(1) events instead of O(10).
`w` is clamped to [0.15, 0.85] — a certain bump (A→1) still holds (w→0.15
floor preserves the anti-thrash bias; hard conflict still routes to ψ=−1
reject before this branch).

## Hypotheses (unchanged bars — no goalpost moves)

- **H1**: ≥90% of left-bound serves reach err ≤1.5 within ≤12 ticks of the serve.
- **H2**: 100% of own-return episodes re-capture (err ≤1.5) within ≤2 subsequent events.
- **H3**: advisory win-rate ≥ reactive control (same seeds, same control arm).
- **H4**: advisory win-rate ≥ 55%.
- **H5**: advisory fired ≥1% of ticks; per-tick mode census complete.
- **Determinism**: M1 seeds 1..3 twice → identical chain head.

## Predictions that would falsify the dilution diagnosis

If H1/H2 still fail after dilution-proofing, the binding constraint is NOT
constants cadence and this lane closes per R8 (three strikes: v0-implicit, v1,
v2). If H1/H2 pass but H3 regresses, predictive-aim value was an artifact of
v1's slow drift — recorded honestly either way.

## Deliverables

1. This file (sealed before any v2 run).
2. `experiments/predictive_paddle_v2.mjs` + receipt (next pulse, R8 budget).
