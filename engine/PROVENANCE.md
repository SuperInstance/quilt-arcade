# Engine provenance

`engine/` is the compiled `@quilt/core` package (ESM dist) vendored so this
folder is fully self-contained — no install step, no network.

- Source repo: https://github.com/SuperInstance/quilt @ `fdfed69` (upstream main)
- **Plus playtest patches 1–12** developed during the quilt play-test program:
  1. listener `watch` lists wired into the dependency graph (upstream listeners never fired on sensors)
  2. `propagate()` cycle guard (visited set — cycles no longer stack-overflow)
  3. `eager` engine option (stale formulas recompute during propagation; listeners see true prev/current)
  4. listener actions get fresh event context per fire (caller.metadata visible)
  5. set/push thread real prev into propagate
  6. value-cell stale-read fix for pulls
  7. `contains` sugar on dotted paths (evalWhen)
  8. effectful program/router invalidation (programs stop serving cached results after upstream set)
  9. evaluateFormula persists cell.value (pulls seed the graph; first-crossing listeners work)
  10. `call()` memo key includes `stableJson(input)` — programs are honest functions of their arguments
  11. programs receive context-bound runtime (nested runtime.call threads caller ctx)
  12. **effectful evaluation is fresh by default; memoization is opt-in (`memo: true`)**. Found by
      the hold'em sheet: `callKey` = caller + input cannot see SHEET STATE, so a repeated
      `(caller, input)` pair (the fish calling `{seq:1}` after `match.seq` was reset) was served a
      stale cached verdict and the arbiter never re-ran — a permanently frozen table. A program is
      a function of its arguments *and* of the cells it reads; the engine no longer pretends
      otherwise. Mirrored in `packages/core/src/{engine,types}.ts`; all 36 core tests updated & green.

Cumulative diff: see `../quilt-playtest/patches/playtest-patches.diff` in the
companion play-test deliverable. All 36 upstream core tests pass with these
patches applied.

The patches matter for the games: the rule-bubble architecture depends on
watch-triggered listeners (1), on programs being re-invoked when their inputs
change (8), on `runtime.call` honoring distinct inputs (10), and — the newest
lesson, from the first non-grid game — on effectful cells being re-evaluated
even when their arguments look identical (12).
