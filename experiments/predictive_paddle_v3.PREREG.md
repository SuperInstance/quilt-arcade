# PRE-REGISTRATION — predictive paddle v3: linear metric + sense-local clock

**Status: SEALED before any v3 measured run. Seed 20261001. Kill R8 (15 min).**
**Failure history:** v1 (`predictive_paddle.FINDINGS.md`) sealed FAIL — standing-mass
dilution; v2 (`predictive_paddle_v2.FINDINGS.md`) sealed FAIL — (1) circular err
metric on a linear coordinate (wrap-collapse, spec defect), (2) cross-match
A_eff explosion via `tick.count` reset on a persistent engine (infrastructure
defect; retroactively contaminated v1's certainty gating). v3 closes BOTH.

## Exactly two deltas vs sealed v2 — everything else byte-frozen

1. **Linear error metric.** All readout↔cue distances become plain absolute
   differences on the arrival-y coordinate: `errU = |y_at − readY|` (no circular
   `min(d, H−d)`). Pull weight `w = max(0.15, min(0.85, errU/30))·(1−A_eff)`.
   Reject trigger `errU > 7.5 && A_eff > 0.5` — IDENTICAL threshold to v1/v2's
   45° rule (45/360·60 = 7.5), recorded as an equivalence, not a change.
   Rationale: arrival-y is linear; the paddle pays linear travel. The ring
   coordinate stays circular (wrap-correct injection/readout for unimodal
   bumps); only the ERROR MEASUREMENT is linear.

2. **Sense-local clock.** Replace the global-tick age with a sense-owned
   counter: `st.clock` (increments by 1 per `sense.update` call);
   `A_eff = A·0.98^(st.clock − st.lastClock)`; `st.lastClock = st.clock` on
   every update. Immune to `new_game` resets by construction; matches the
   sparse-event semantics (certainty ages per missed event, not per wall tick).

Frozen: abstain contract (away-abstain, own-return abstain), reject write
(×0.7 ring, A×0.5), A rise rule (min(1, A_eff+(1−A_eff)·0.15)), projection cell,
ring size 32, all constants, receipt schema, event detection (reflection
invariant), seeds (1..50), arms, H1–H5 bars, determinism pin.

## Hypotheses (unchanged bars — no goalpost moves)

- **H1**: ≥90% of left-bound serves reach err ≤1.5 within ≤12 ticks of the serve.
- **H2**: 100% of own-return episodes re-capture within ≤2 subsequent events.
- **H3**: advisory win-rate ≥ reactive control (same seeds).
- **H4**: advisory win-rate ≥ 55%.
- **H5**: advisory fired ≥1% of ticks; per-tick mode census complete.
- **Determinism**: M1 seeds 1..3 twice → identical chain head.

## Predictions that would falsify the combined diagnosis

With dilution, wrap-metric, and clock pollution all closed: H1 ≥90% is
predicted by the convergence arithmetic (w ≥ 0.15 pulls ≥ err/30·(1−A) per
event → ≤3 events from any 30-unit error). If H1/H2 still fail on a clean
spec, the ring attractor itself is the wrong estimator for this sensor
contract and **the lane closes permanently** (third strike). If H1/H2 pass
but H3/H4 regress vs v1's polluted 94%, the v1 value signal was pollution
artifact — recorded honestly either way.

## Deliverables

1. This file (sealed before any v3 run).
2. `experiments/predictive_paddle_v3.mjs` + receipt (next pulse, R8 budget).
