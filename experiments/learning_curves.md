# Learning curves — quilt-arcade

Every number below was produced by cells: `ai.choose` (policy), `ai.move_log`
(features of each learner move), `learn.update` (averaged perceptron + witness
receipt). The control group is each learner's own frozen generation-1 policy.
Receipt chains re-derive from GENESIS (see each harness).

## reversi

- setup: 24 generations × 8 games, α=0.04, baseline: [object Object]
- training win rate: first-4-gen avg **47%** → last-4-gen avg **47%**
- weight discoveries: `corner`: 0.00 → 5.48, `x`: 0.00 → -3.04, `mobility`: -1.00 → -1.84, `frontier`: 0.00 → 1.54

## connect4

- setup: 40 generations × 12 games, α=0.1, baseline: frozen theta0 (the learner's own generation-1 policy)
- training win rate: first-4-gen avg **63%** → last-4-gen avg **65%**
- **held-out eval vs generation-1: 72%** over 60 games (30 per colour)
- weight discoveries: `win`: 6.00 → 8.00, `mine3`: 0.00 → 7.90, `theirs3`: 0.00 → -7.20, `center`: 0.40 → 7.60, `giveAway`: 0.00 → -6.60

## gomoku

- setup: 24 generations × 8 games, α=0.08, baseline: frozen theta0 (the learner's own generation-1 policy)
- training win rate: first-4-gen avg **69%** → last-4-gen avg **78%**
- **held-out eval vs generation-1: 78%** over 40 games (30 per colour)
- weight discoveries: `five`: 8.00 → 12.00, `open4`: 2.00 → 2.56, `four`: 1.00 → 10.36, `open3`: 0.50 → 1.78, `blockFive`: 0.00 → 1.60, `blockFour`: 0.00 → 3.84, `tookFive`: 0.00 → 1.60, `missedFive`: 0.00 → 1.52

## holdem (Texas Hold'em — hidden information + ML strategy cells)

- setup: 150 hands, 3-max (frozen fish + two learners), α=0.12, nudge rate visible per hand
- combined learner stacks: **210 → 868** chips vs the frozen fish at **81** — the table hardens around a stationary opponent
- P1 weight refinement: `aggro`: 0.60 → 2.50, `tight`: 0.00 → 0.45, `bluff`: 0.30 → 0.30, `sticky`: 0.20 → -0.54, `adapt`: 0.20 → 0.20
- agent decision traces: 40 entries captured (see `ai.thoughts.pN` cells and agent_ux_field_notes.md)

What "learning" means here: the score cells stay honest (the referee validates every move),
the weights are plain cell values you can watch move in the viewer's learning strip, and every
generation is pinned into an fnv1a64 witness chain — tampering with history breaks the chain.
