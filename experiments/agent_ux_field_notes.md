# Agent UX field notes — what the arcade agents actually do, narrate, and learn

This file documents the *experience* of the agents in the arcade — their
decision traces, their learning telemetry, and the referee interactions —
so the next round of systems can be designed against what actually happened,
not what we hoped would happen. Every quote below is copied verbatim from a
real run's cells (`experiments/holdem.json`, `experiments/reversi.json`).

---

## 1. The narration seam: every decision leaves a readable trace

Each agent decision writes a structured line into `ai.thoughts.pN` (hold'em)
or `ai.move_log` / the verdict trace (grid games). The format was tuned while
playtesting until it answered the three questions a researcher actually asks
("what did it see, what did it do, why") in one line:

```
P2 [turn] eq 0.95, pot 10 -> RAISE 8 | eq 0.95 vs value line 0.48 -> bet 8 (aggro 2.50, roll 0.22 < 0.94)
P2 [turn] eq 0.26, pot 11, facing 5 -> FOLD | eq 0.26 < needed 0.28 -> fold 5
```

Reading notes:
- **eq** is the cell-computed Monte-Carlo equity (`ai.equity`, 60 rollouts).
- **value line / needed** are the policy's thresholds *with the current weight
  values inline* (`aggro 2.50`) — so the trace doubles as a policy dump. When
  θ changes, the same situation narrates differently; you can watch the
  policy's reasons evolve without touching a debugger.
- **roll** is the sampled random threshold — it explains variance honestly
  ("why did it check two-pair? roll 0.49 ≥ p(bet) 0.06" — no, wait: 0.49 <
  0.94 would bet; the trace keeps the direction explicit so a reader never
  has to reverse-engineer the RNG).

The grid games narrate through the referee instead: the arbiter's verdict
(`rules.verdict.text`) quotes the clause that fired *in the context of the
exact square/move* — "Placing at A1 brackets no enemy line in any of the 8
directions (R3 needs own...enemy...own with no gaps)". The agent UX and the
human UX are the same surface, which is the point.

## 2. The learning telemetry: nudges with reasons, pinned by receipts

Hold'em's `learn.update` runs after every hand and produces, per learner, a
list of **reason-tagged nudges** on separate visible weight cells:

```
hand 148 P2: aggro +0.072 (flop raise paid off (hand net 10.5bb))
             aggro +0.072 (turn raise paid off (hand net 10.5bb))
             aggro +0.072 (river raise paid off (hand net 10.5bb))
hand 148 P1: sticky −0.046 (preflop chase lost -> call less)
             tight +0.023 (loose call taxed)
```

Each line is one weight cell changing by a stated amount for a stated reason.
The viewer renders them under the θ bars, so "watching the opponents get
better" is literally reading their homework. Every hand also books an
`fnv1a64` witness receipt (`learn.receipts.pN`) pinning `{hand, net_bb, stack,
theta_hash}` into a hash chain — the harness re-derives both chains from
GENESIS every run, so a doctored learning curve breaks visibly.

Observed dynamics over the recorded 150-hand run (α=0.12, fish = frozen
call-station control):

| block | fish | P1 | P2 | θ1.aggro | θ1.tight | θ1.sticky |
|---|---|---|---|---|---|---|
| 25 | 90 | 112 | 98 | 0.70 | 0.02 | 0.18 |
| 75 | 67 | 259 | 155 | 1.74 | 0.14 | 0.01 |
| 150 | 81 | 545 | 323 | **2.50** (clamped) | 0.45 | **−0.54** |

The story the numbers tell: raising against a station keeps getting paid, so
`aggro` climbs until it saturates its clamp; chasing loses money, so `sticky`
crosses zero and the learner becomes genuinely fold-disciplined. The fish
bleeds blinds and small bets throughout — combined learner stacks 205 → 868.
That is the "GAN before your eyes" moment, with the honest caveat that this
is a credit-assignment loop against a stationary control, not adversarial
co-training (the two learners DO compete for the same fish, so their
improvement is partly zero-sum between them).

For the grid games, the equivalent observation is corner discovery in
reversi: win rate 63% → 75% across 24 generations with θ.corner 0.28 → 5.48 —
the weight curve is the *explanation* of the win-rate curve, visible cell by
cell.

## 3. What watching a run actually feels like (browser)

- **You ↔ AI** (hold'em): your cards render; the AI seats render `?? ??`.
  The mask is `rule.C10.check` — when the showdown fires, every projection
  flips open at once and the ledger prints the show. After an uncontested
  win nothing is revealed — the referee says "hole cards stay hidden (C10)".
- **AI ↔ AI**: every half-second another action lands in the ledger, another
  thought line in the trace panel; between hands the nudge lines scroll and
  the θ bars twitch. Over a few minutes the fish's stack visibly separates
  from the learners'.
- Illegal human actions (out-of-turn, below-min-raise) are refused by the C5
  bubble with the exact arithmetic quoted: "raise to 3 is below the minimum
  raise to 4 (C5: raise >= current bet 2 + last raise size 2)". The refusal
  is the tutorial.

## 4. Design guidance extracted (for the next agent systems)

1. **Narrate with the weights inline.** A trace that quotes `aggro 2.50`
   turns every decision into a policy snapshot; researchers stop needing
   breakpoints.
2. **Every nudge needs a reason string, and the reason needs numbers.**
   "preflop chase lost → call less (hand net −8.5bb)" is auditable; "sticky
   adjusted" is not.
3. **Credit where the hindsight is.** Move-level loops only see moves made;
   the grade came from features like `missedFive` (gomoku) and
   "folded 0.7 equity" (hold'em). Ask what the agent failed to *see*, not
   just what it did.
4. **A stationary control group makes improvement measurable.** The fish is
   the fixed ruler the learners are measured against; without it "better" is
   unfalsifiable.
5. **The referee is part of the agent UX.** Agents enter through the same
   arbiter as humans (`match.step` → `action.arbiter`), so an agent cannot
   drift outside the rules, and its failures read as rule-bubble refusals —
   the same artifact a human would see.
6. **Cache nothing stateful.** The one freeze this program produced (patch
   12) was invisible from the cells — everything looked fine while the
   arbiter silently never ran. Traces + conservation asserts + reference
   cross-checks are what surfaced it; keep all three in any port.
