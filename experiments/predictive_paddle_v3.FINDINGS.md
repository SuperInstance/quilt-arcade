# PREDICTIVE PADDLE v3 — FINDINGS (measured run, sealed FAIL, LANE CLOSED — third strike)

**Runner:** `experiments/predictive_paddle_v3.mjs` · **Receipt:** `experiments/predictive_paddle_v2_receipt.json`→ v3 receipt: `experiments/predictive_paddle_v3_receipt.json`
**Spec:** `experiments/predictive_paddle_v3.PREREG.md` (sealed; deltas: linear err metric + sense-local clock, everything else frozen)
**Verdict: FAIL** — H1 ✗ 20.83% (identical to v1, n=24), H2 ✗ 15.5%, H3 ✗ **advisory 72% < control 86%** (honest negative), H4 ✓ (72%≥55%), H5 ✓ (19.8% share, real census), determinism ✓ (head c445d1950942cc8a, twice).
Between-event sampling FULLY restored (n=18,375 — cross-match explosion closed; psi {commit 1320, reject 357, abstain 1858} healthy). Both sealed defects stayed closed: no wrap-collapse, no A_eff explosion. **H1/H2 failed on a clean spec — the sealed third-strike clause fired: this lane closes permanently.**

## The measured mechanism: certainty-gate pinning (third distinct mechanism)

Per-event aging works exactly as sealed — and that is the finding. `A_eff = A·0.98^Δ`
with Δ = update-calls since the last event = **1–4 per approach phase** (events are
~30–70 wall-ticks apart; the clock only ticks at events). Commits monotonically
raise A (`min(1, A_eff+(1−A_eff)·0.15)` → A→1 within ~15 commits ≈ one match), and
nothing pulls it back: rejects (357 fired) halve A but commits re-raise it within
1–2 events. So across the 50-match census A sits pinned at ≈1, and the pull gate
`w = max(0.15, min(0.85, errU/30))·(1−A_eff)` → w ≈ 0.003–0.05: **the ring freezes
~15 units from truth** (between mean_err 15.23, max 58.4 — full n, no explosion).

H1 = 20.83%, the SAME 5/24 serves as v1: capture only when a serve cue lands near
the frozen bump by chance. The dilution diagnosis (v1) was real but incomplete —
the deeper invariant is the gate: **(1−A_eff) throttles the pull exactly when the
sensor hands out exact cues separated by 30–70 ticks.** The flycx constants
(cert_decay 0.98, event-gated A) are tuned for dense noisy event streams where
cues are frequent and wrong; here cues are sparse and exact, so certainty should
gate *nothing*.

## The honest advisory verdict (corrects the record)

v1's H3 (94% vs 86%) was measured under pollution (v2 FINDINGS §Defect 2). With a
clean spec: advisory **72% < 86%** — the estimator family has NEGATIVE game value.
Mechanism: the certain gate (A_eff≥0.5 && mass≥0.5) fires on *stale frozen*
estimates — certainty, not accuracy — so the attractor paddle aims ~15 units off
for 19.8% of ticks. Certainty ≠ correctness, measured.

## Arc summary (three strikes, three distinct mechanisms, one conclusion)

| rev | defect class | mechanism | H1 |
|---|---|---|---|
| v1 | standing-mass dilution | mass≈12 vs 0.15/commit → ~9 events to converge vs 1–4 available | 20.8% |
| v2 | spec + infrastructure | circular err on linear coordinate (wrap-collapse); tick.count reset × persistent cells → A_eff≈1e44 → ring explosion | 12.5% |
| v3 | certainty-gate pinning | per-event 0.98^Δ with Δ=1–4 → A→1 pinned → w≈0 → ring frozen | 20.8% |

**Program conclusion (reusable, cross-repo):** porting flycx to exact-cue sparse
sensors requires dropping the (1−A_eff) pull gate or aging certainty in wall-time —
the gate's assumptions (dense noisy events) are the port casualty, not the ring
representation. A v4 would be a different estimator contract, not a constant
retune — per the sealed clause, this lane is closed; new evidence would need a
different sensor model, not new constants (KC-geo/CAST precedent).

## Honest notes

- The extra cross-match unit pin drafted for v3 did not make the final file (edit
  provenance); the receipt itself is the cross-match evidence: between n=18,375
  (full sampling, vs v2's explosion-collapsed 2,613) with healthy psi census.
- H4 (72% ≥ 55%) passes on paper and is recorded without celebration: the arm was
  net-negative vs control, which is the number that matters.
