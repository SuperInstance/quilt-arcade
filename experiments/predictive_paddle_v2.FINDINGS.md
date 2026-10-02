# PREDICTIVE PADDLE v2 — FINDINGS (measured run, sealed FAIL)

**Runner:** `experiments/predictive_paddle_v2.mjs` · **Receipt:** `experiments/predictive_paddle_v2_receipt.json`
**Pre-registration:** `experiments/predictive_paddle_v2.PREREG.md` (sealed before run; sole delta vs v1 = error-scaled pull)
**Verdict: FAIL** — H1 ✗ 12.5% (worse than v1's 20.8%), H2 ✗ 13.6%, H3 ✓ (100% vs 86.0% control), H4 ✓, H5 ✗ (advisory share 0.3% < 1% bar), determinism ✓.
The run exposed **two defect classes**, one in the sealed v2 spec, one in the
experiment/engine interface — and the second retroactively re-interpretes v1.

## Defect 1 (spec, KC-geo-G2 class): circular error metric on a linear coordinate

The sealed v2 formula weighted pulls by the CIRCULAR readout↔cue distance.
Arrival-y is a LINEAR coordinate on [1,59] — the paddle must travel 51 units
between y=7 and y=58, but the circular metric reports that separation as 9.
Consequences (unit pin, deterministic): a 50-unit conflict got w≈0.26 instead
of 0.85, the ring blended two far bumps through the 0/60 wrap, and the readout
landed mid-arc at 4.29 against a true cue of 57.89. H1 fell BELOW v1 because
wrap-crossing conflicts now actively move the estimate to wrong midpoints,
whereas v1's weak injections merely drifted.

## Defect 2 (infrastructure, NEW): cross-match A_eff explosion via tick.count reset

Probe across 8 seeds (shared engine, ring persists across new_game):

```
seed=4 leftTicks=1968 samples=7  nullPred=1915 minMass=-1.47e+54
seed=5 leftTicks=3692 samples=128 nullPred=2781 minMass=-5.27e+23
seed=1,2,3,6,7 healthy: minMass ≈ 11–13
```

`A_eff = A·0.98^(tick − st.lastTick)` ages by the engine-global `tick.count`,
which **new_game resets per match** while registered `sense.*` cells persist.
Match N ends at tick T; match N+1's first update computes 0.98^(0−T) ≈ e^(T/50)
— for T=5000, ≈1e44. In v2's commit branch w = …·(1−A_eff) ≈ −8e43: the ring
update `ring = ring(1−w) + w·taper` explodes geometrically (measured −1e54).
Reject-only first cues (true >45° conflict) shrink instead of exploding —
which is why only some seeds blow up.

**Retroactive re-interpretation of v1:** v1's injection was NOT A-gated, but
its certainty was: after match 1, v1's A pinned to 1.0 via the same astronomic
A_eff, making the certain gate (A_eff≥0.5) permanently true from match 2 on.
v1's H3/H4 (94% vs 86%) were therefore measured under polluted gating, and its
72 rejects were inflated by fake-certain routing. Both v1 and v2 receipts stand
as measured; the clean value read must wait for v3. **Engine-hazard note for
experiment authors (receipts > claims):** any experiment cell that ages by
`tick.count` on a persistent engine silently corrupts across new_game matches.

## Prereg errata + honest limits

- Taper column sums to ≈8, not ≈1 as the v2 prereg parenthetical guessed
  (cosmetic; formula as sealed was run).
- H5's ≥1% bar failed honestly at 0.3%: converged estimator + collapsed
  certain windows (A dynamics polluted per Defect 2). 100% win-rate at 0.3%
  share is recorded with its mechanism, not celebrated.
- Between-event n collapsed (2,613 vs v1's 18,375) purely because exploded
  rings return null readouts (mass ≤ 1e-9 gate) — sampling code identical.

## Lane status + v3 (sealed in predictive_paddle_v3.PREREG.md)

The v2 falsification clause fired: H1/H2 still failed after dilution-proofing.
Per the KC-geo precedent, the two named defect classes constitute fresh
evidence, so v3 is a correction spec (both defects closed, everything else
frozen, H1–H5 bars unchanged): LINEAR err metric + sense-local clock. If v3
fails H1/H2 with a clean spec, the lane closes for real (third strike).
