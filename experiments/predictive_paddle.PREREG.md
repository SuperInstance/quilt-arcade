# PRE-REGISTRATION — predictive paddle via fruitfly-CX ring attractor (estimation loops as cells)

**Status: SEALED before any measured run (R1). Seed 20261001. Kill criterion R8 (15 min).**
**Cross-repo port: model constants ported 1:1 from `SuperInstance/chiaroscuro` PR #6
(`tools/fly_cx.py`, model `flycx-v2-certainty-gated`, measured PASS 4/4 on 2026-10-01).**
On merge this citation is load-bearing per the fleet weight law → referral edge
candidate `chiaroscuro-flycx → arcade-predictive-paddle`.

## The idea (Pattern 6 — estimation loops as cells)

Pong's paddles are reactive: `ai.track` aims at `ball.y` *now*. The ball's
*arrival-y* at the paddle face is computable from any post-event state by ray
projection, but only at events (serve / wall reflection / paddle return) — the
trajectory is piecewise-linear. A fruitfly central-complex ring attractor is
the natural cell-native estimator: a 32-cell activity ring over arrival-y
∈ [0,60], updated only at events, read every tick. Between events the bump
holds (the fly holds heading between landmarks). Ternary ψ dynamics gate
plasticity exactly as the sealed chiaroscuro model does.

## Port mapping (chiaroscuro flycx v2 → this sheet)

| flycx v2 constant            | value | this sheet                         |
|------------------------------|-------|------------------------------------|
| bins (ring size)             | 16    | 32 cells (`sense.ring`, finer 1D)  |
| A0 (certainty gate)          | 0.5   | `sense.state.A`, same 0.5          |
| commit_gain                  | 0.15  | activity + certainty gain, same    |
| reject_shrink                | 0.7   | ring shrink on ψ=−1, same          |
| motion decay (τ=0.35)        | —     | ring ×0.85 per commit event        |
| certainty decay              | ~0.98 | A_eff = A·0.98^(ticks since event) |
| conflict pull BLEND·(1−A)·err| —     | identical: inject taper scaled by (1−A) |

Ring coordinate: φ = arrival_y / 60 · 2π. Inject profile: cos²(Δ/2) taper,
zero beyond π/2. Readout: circular mean → ŷ. All state is plain cell values
(`sense.ring`, `sense.state`, `sense.receipts`) — inspectable, receipitable.

## Events (sparse sensor contract)

The harness feeds exactly one event per occurring game event, post-tick:
`{kind:'serve'|'wall'|'return', side?}`. The cell reads post-event ball state
from the sheet and projects arrival-y itself (closed-form wall folding:
walls at y=1/y=59, L=58). It never sees the live ball between events.

ψ per event (pre-registered):
- **commit (ψ=1)**: serve, wall, return by *right* (opponent). Ring ×0.85,
  inject cos² bump at projected φ with magnitude 0.15·(1−A_eff); A rises.
- **reject/abstain (ψ=−1)**: return by *left* (own paddle). Own return
  contradicts the stale bump (anti-thrash, flycx v2 reject semantics):
  ring ×0.7, A ×0.5, NO capture this event.
- **abstain (ψ=0)**: degenerate projection (|vx| < 1e-6). Nothing written
  but a receipt row.

## Hypotheses (measured in `experiments/predictive_paddle.mjs`)

- **H1 (capture)**: across seeds 1..50, ≥90% of serves reach readout error
  ≤1.5 (the paddle deadzone) within ≤12 ticks of the serve event.
- **H2 (re-capture)**: after every left-return ψ=−1 event, error ≤1.5 within
  ≤2 subsequent events.
- **H3 (value, non-inferiority)**: attractor-advisory left paddle (uses ŷ
  when A_eff≥0.5, honest fallback to reactive `ai.track` otherwise, every
  fallback logged) vs reactive right, seeds 1..50: win-rate ≥ reactive-left
  control (0.85 speed vs 0.70) win-rate on the same seeds.
- **H4 (value, strength)**: advisory win-rate ≥ 55%.
- **H5 (honesty)**: advisory fired on ≥1% of ticks (else vacuous) and 100%
  of fallbacks carry a log line; receipt chain re-derives from GENESIS.

## Honesty limits (pre-registered)

- The oracle for error measurement is the same closed-form projection from
  the *live continuous* ball state — the estimator itself only ever sees
  post-event states. Oracle ≠ estimator input; formula identical, documented.
- Everything in pong is deterministic and fully observable; the ML content
  is the **event-gated dynamics under a sparse sensor contract**, not
  hidden-state inference. Ablative value = convergence speed + match value,
  not mystery.
- If H3 fails, the attractor is an honest estimator and a worse policy —
  receipt says so. No goalpost moves; iteration = new pre-registration.

## Deliverables

1. This file (committed before any run).
2. `experiments/predictive_paddle.mjs` — runner + FAIL-first pins + receipt.
3. `experiments/predictive_paddle_receipt.json` — chained fnv1a-64 rows +
   hypothesis verdicts + determinism pin (seeds 1..3 run twice, byte-equal).
